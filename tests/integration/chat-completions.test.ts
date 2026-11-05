import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { loadSubstances, type SubstanceRegistry } from "../../src/engine/registry.js";
import { SessionStore } from "../../src/engine/session.js";
import { parseProvidersConfig } from "../../src/providers/config.js";
import { buildApp } from "../../src/server/app.js";
import type { ChatCompletionRequest } from "../../src/shared/types.js";

const providers = parseProvidersConfig(`
version: 1
default: ollama-local
providers:
  - id: ollama-local
    kind: ollama
    baseUrl: http://127.0.0.1:11434
    models:
      - llama3.1:8b
`);

const payload = {
  model: "ollama-local/llama3.1:8b",
  messages: [{ role: "user", content: "ciao" }],
};

let app: FastifyInstance;
let registry: SubstanceRegistry;
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function forwardedBody(callIndex = 0): ChatCompletionRequest {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as ChatCompletionRequest;
}

beforeAll(async () => {
  registry = await loadSubstances("tests/fixtures/substances");
});

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  app = await buildApp({
    config: loadConfig({}),
    providers,
    registry,
    sessions: new SessionStore(() => 1_000_000),
    logger: false,
    env: {},
  });
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

describe("POST /v1/chat/completions", () => {
  it("inoltra la richiesta senza alterazioni se non c'è sostanza", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chatcmpl-1", choices: [] }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...payload, temperature: 0.2 },
    });

    expect(response.statusCode).toBe(200);
    const forwarded = forwardedBody();
    expect(forwarded.model).toBe("llama3.1:8b");
    expect(forwarded.temperature).toBe(0.2);
    expect(forwarded.logit_bias).toBeUndefined();
    expect(response.headers["x-substance-id"]).toBeUndefined();

    const url = fetchMock.mock.calls[0]?.[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
  });

  it("applica la sostanza e dichiara l'inviluppo raggiunto", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chatcmpl-1", choices: [] }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-substance-id": "test-lite", "x-dose": "1" },
      payload: { ...payload, temperature: 0.2 },
    });

    expect(response.statusCode).toBe(200);
    const forwarded = forwardedBody();
    expect(forwarded.temperature).toBe(0.8);
    expect(forwarded.presence_penalty).toBe(0.5);
    expect(Object.keys(forwarded.logit_bias ?? {})).toHaveLength(2);
    expect(response.headers["x-substance-id"]).toBe("test-lite");
    expect(response.headers["x-effect-envelope"]).toBe("1.000");
  });

  it("rispetta il tetto di temperature della sostanza", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chatcmpl-1", choices: [] }));

    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-substance-id": "test-lite" },
      payload: { ...payload, temperature: 1.3 },
    });

    expect(forwardedBody().temperature).toBe(1.4);
  });

  it("inoltra i chunk SSE senza bufferizzare", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    fetchMock.mockResolvedValue(sseResponse(chunks));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-substance-id": "test-lite" },
      payload: { ...payload, stream: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.body).toBe(chunks.join(""));
    expect(forwardedBody().stream).toBe(true);
  });

  it("propaga gli errori dell'upstream senza alterarli", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "invalid api key", type: "auth_error" } }, 401),
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { message: "invalid api key", type: "auth_error" } });
  });

  it("rifiuta una sostanza sconosciuta", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-substance-id": "non-esiste" },
      payload,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: "substance_not_found", type: "invalid_request_error" },
    });
  });

  it("rifiuta una dose fuori scala", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-substance-id": "test-lite", "x-dose": "2" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_dose" } });
  });

  it("rifiuta un body malformato con errore in formato OpenAI", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_body", type: "invalid_request_error" },
    });
  });

  it("risponde 502 se l'upstream non è raggiungibile", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: { code: "upstream_unreachable" } });
  });
});

describe("GET /v1/substances", () => {
  it("espone il catalogo delle sostanze", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/substances" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "list",
      data: [{ id: "test-lite", name: "Test Lite", durationSeconds: 660 }],
    });
  });
});
