import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { applyContext } from "../../distorters/context.js";
import { applyLogit, logitStatus } from "../../distorters/logit.js";
import { applyParams, type DistortionCaps } from "../../distorters/params.js";
import { jitterDelayMs } from "../../distorters/streaming.js";
import { computeFactors, type Factors } from "../../engine/metabolism.js";
import type { SubstanceRegistry } from "../../engine/registry.js";
import type { SessionStore } from "../../engine/session.js";
import type { Substance } from "../../engine/substance.js";
import type { ProvidersConfig } from "../../providers/config.js";
import { createProviderClient, resolveModel } from "../../providers/index.js";
import { AppError } from "../../shared/errors.js";
import type { ChatCompletionRequest } from "../../shared/types.js";
import { effectPhase } from "../../telemetry/trip-report.js";

const ChatMessageSchema = z.looseObject({
  role: z.enum(["system", "user", "assistant", "tool", "developer"]),
  content: z.union([z.string(), z.null()]).optional(),
});

const ChatRequestSchema = z.looseObject({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
});

export interface ChatRouteDeps {
  providers: ProvidersConfig;
  registry: SubstanceRegistry;
  sessions: SessionStore;
  caps: DistortionCaps;
  env: Record<string, string | undefined>;
  /** Iniettabile nei test: nessuna attesa reale. */
  sleep?: (ms: number) => Promise<void>;
}

interface DosingInput {
  substanceId?: string;
  dose: number;
  sessionKey: string;
  elapsedOverride?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.length > 0 ? first : undefined;
  }
  return undefined;
}

function readDosing(request: FastifyRequest): DosingInput {
  const doseHeader = firstHeader(request.headers["x-dose"]);
  let dose = 1;

  if (doseHeader !== undefined) {
    const parsed = Number(doseHeader);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      throw new AppError("Header x-dose non valido: usare un numero tra 0 e 1", {
        statusCode: 400,
        type: "invalid_request_error",
        code: "invalid_dose",
        param: "x-dose",
      });
    }
    dose = parsed;
  }

  const elapsedHeader = firstHeader(request.headers["x-substance-elapsed"]);
  let elapsedOverride: number | undefined;

  if (elapsedHeader !== undefined) {
    const parsed = Number(elapsedHeader);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new AppError("Header x-substance-elapsed non valido: secondi >= 0", {
        statusCode: 400,
        type: "invalid_request_error",
        code: "invalid_elapsed",
        param: "x-substance-elapsed",
      });
    }
    elapsedOverride = parsed;
  }

  const substanceId = firstHeader(request.headers["x-substance-id"]);

  return {
    ...(substanceId !== undefined ? { substanceId } : {}),
    dose,
    sessionKey: firstHeader(request.headers["x-session-id"]) ?? "default",
    ...(elapsedOverride !== undefined ? { elapsedOverride } : {}),
  };
}

export function registerChatCompletionsRoute(app: FastifyInstance, deps: ChatRouteDeps): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`)
        .join("; ");
      throw new AppError(`Richiesta non valida: ${details}`, {
        statusCode: 400,
        type: "invalid_request_error",
        code: "invalid_body",
      });
    }

    const body = parsed.data as ChatCompletionRequest;
    const target = resolveModel(deps.providers, body.model);
    const dosing = readDosing(request);

    let outgoing = body;
    let active: { substance: Substance; factors: Factors; elapsed: number } | undefined;
    const responseHeaders: Record<string, string> = {};

    if (dosing.substanceId !== undefined) {
      const substance = deps.registry.get(dosing.substanceId);

      if (!substance) {
        throw new AppError(`Sostanza sconosciuta: ${dosing.substanceId}`, {
          statusCode: 404,
          type: "invalid_request_error",
          code: "substance_not_found",
          param: "x-substance-id",
        });
      }

      const elapsed =
        dosing.elapsedOverride ??
        deps.sessions.resolve(dosing.sessionKey, substance.id, dosing.dose).elapsedSeconds;
      const factors = computeFactors(substance, dosing.dose, elapsed);

      outgoing = applyContext(applyParams(body, factors, substance, deps.caps), factors, substance);

      const logitGate = logitStatus(substance, target.provider.tokenizer);
      if (logitGate === "applied") {
        outgoing = applyLogit(outgoing, factors, substance, deps.caps);
      }

      active = { substance, factors, elapsed };
      responseHeaders["x-substance-id"] = substance.id;
      responseHeaders["x-dose"] = String(dosing.dose);
      responseHeaders["x-substance-elapsed"] = String(Math.round(elapsed));
      responseHeaders["x-effect-envelope"] = factors.envelope.toFixed(3);
      responseHeaders["x-effect-phase"] = effectPhase(substance, elapsed);
      if (logitGate !== "off") {
        responseHeaders["x-logit-status"] = logitGate;
      }
    }

    const client = createProviderClient(target.provider);
    const controller = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) {
        controller.abort();
      }
    };
    // Node emette "close" sull'IncomingMessage appena il body è letto:
    // per annullare l'upstream serve la chiusura della RISPOSTA.
    reply.raw.on("close", onClose);

    let upstream: Response;

    try {
      upstream = await client.forward(
        { ...outgoing, model: target.model },
        { signal: controller.signal, env: deps.env },
      );
    } catch (error) {
      reply.raw.off("close", onClose);
      const cause = (error as { cause?: { message?: string } }).cause?.message;
      throw new AppError(`Upstream non raggiungibile: ${cause ?? (error as Error).message}`, {
        statusCode: 502,
        type: "upstream_error",
        code: "upstream_unreachable",
      });
    }

    if (!outgoing.stream) {
      const text = await upstream.text();
      reply.raw.off("close", onClose);

      return reply
        .status(upstream.status)
        .headers({
          ...responseHeaders,
          "content-type": upstream.headers.get("content-type") ?? "application/json",
        })
        .send(text);
    }

    // Streaming: nessun buffering, i chunk SSE vengono inoltrati appena arrivano.
    reply.hijack();
    reply.raw.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...responseHeaders,
    });

    if (!upstream.body) {
      reply.raw.end();
      reply.raw.off("close", onClose);
      return reply;
    }

    const sleep = deps.sleep ?? defaultSleep;
    const jitter = active?.factors.streaming.jitter ?? 0;
    const jitterSeed = active?.substance.distortions.streaming?.seed ?? 1;
    const decoder = new TextDecoder();
    let chunkIndex = 0;

    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        if (chunk.value) {
          // Il jitter cambia il ritmo dell'uscita, mai il contenuto: [DONE] non si tocca.
          if (jitter > 0 && !decoder.decode(chunk.value).includes("[DONE]")) {
            const delay = jitterDelayMs(jitter, jitterSeed, chunkIndex);
            chunkIndex += 1;
            if (delay > 0) {
              await sleep(delay);
            }
          }
          reply.raw.write(chunk.value);
        }
      }
    } catch (error) {
      request.log.warn({ err: error }, "stream upstream interrotto");
    } finally {
      reply.raw.off("close", onClose);
      reply.raw.end();
    }

    return reply;
  });
}
