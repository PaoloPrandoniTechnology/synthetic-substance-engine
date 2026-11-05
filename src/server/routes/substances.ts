import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { SubstanceRegistry } from "../../engine/registry.js";
import { parseSubstance, type Substance, substanceDuration } from "../../engine/substance.js";
import { AppError } from "../../shared/errors.js";

export interface SubstanceRouteDeps {
  registry: SubstanceRegistry;
  /** Cartella dei profili YAML: le sostanze salvate dal playground finiscono qui. */
  substancesDir: string;
}

const EXTENSIONS = [".yaml", ".yml"] as const;

function notFound(id: string): AppError {
  return new AppError(`Sostanza sconosciuta: ${id}`, {
    statusCode: 404,
    type: "invalid_request_error",
    code: "substance_not_found",
    param: "id",
  });
}

/** Riassunto del profilo per la UI e per chi crea sostanze via API. */
function summarize(substance: Substance) {
  const logit = substance.distortions.logit;

  return {
    id: substance.id,
    object: "substance",
    name: substance.name,
    family: substance.family,
    intensity: substance.intensity,
    durationSeconds: substanceDuration(substance),
    phases: {
      onsetSeconds: substance.onsetSeconds,
      peakSeconds: substance.peakSeconds,
      plateauSeconds: substance.plateauSeconds,
      decaySeconds: substance.decaySeconds,
    },
    logit: logit
      ? {
          mode: logit.mode,
          strength: logit.strength,
          targetTokenizer: logit.targetTokenizer ?? null,
          biasedTokens: logit.tokenIds.length,
        }
      : null,
    effects: substance.effects,
    contraindications: substance.contraindications,
  };
}

function readYamlBody(body: unknown): string {
  const yaml = (body as { yaml?: unknown } | undefined)?.yaml;

  if (typeof yaml !== "string" || yaml.trim().length === 0) {
    throw new AppError('Body non valido: serve {"yaml": "<profilo>"}', {
      statusCode: 400,
      type: "invalid_request_error",
      code: "invalid_body",
      param: "yaml",
    });
  }

  return yaml;
}

type ValidationResult = { ok: true; substance: Substance } | { ok: false; errors: string[] };

/**
 * Valida con lo stesso loader usato all'avvio: schema, regole trasversali e
 * compilazione dei token logit. Non scrive nulla su disco.
 */
function validateProfile(yaml: string): ValidationResult {
  try {
    return { ok: true, substance: parseSubstance(yaml, "profilo") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errors = message
      .replace(/^profilo:\s*/, "")
      .replace(/^profilo non valido →\s*/, "")
      .split("; ")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return { ok: false, errors: errors.length > 0 ? errors : [message] };
  }
}

async function readSource(dir: string, id: string): Promise<string | undefined> {
  for (const extension of EXTENSIONS) {
    try {
      return await readFile(join(dir, `${id}${extension}`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return undefined;
}

/** Scrittura atomica: il loader non vede mai un file a metà. */
async function writeSource(dir: string, id: string, yaml: string): Promise<string> {
  await mkdir(dir, { recursive: true });

  const target = join(dir, `${id}.yaml`);
  const temp = join(dir, `.${id}.yaml.tmp`);
  const text = yaml.endsWith("\n") ? yaml : `${yaml}\n`;

  await writeFile(temp, text, "utf8");
  await rename(temp, target);

  // Un profilo che prima era `.yml` non deve restare in giro: sarebbe un id duplicato.
  for (const extension of EXTENSIONS) {
    const candidate = join(dir, `${id}${extension}`);
    if (candidate !== target) {
      await rm(candidate, { force: true });
    }
  }

  return target;
}

export function registerSubstanceRoutes(app: FastifyInstance, deps: SubstanceRouteDeps): void {
  app.get("/v1/substances", async () => ({
    object: "list",
    data: deps.registry.list().map((substance) => ({
      id: substance.id,
      object: "substance",
      name: substance.name,
      family: substance.family,
      intensity: substance.intensity,
      durationSeconds: substanceDuration(substance),
      effects: substance.effects,
      contraindications: substance.contraindications,
    })),
  }));

  /** Profilo YAML grezzo: è quello che il playground carica nell'editor. */
  app.get("/v1/substances/:id/source", async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!deps.registry.has(id)) {
      throw notFound(id);
    }

    const source = await readSource(deps.substancesDir, id);

    if (source === undefined) {
      throw notFound(id);
    }

    return reply.type("text/yaml; charset=utf-8").header("cache-control", "no-store").send(source);
  });

  /** Prova a secco: la UI mostra gli errori mentre si scrive, senza toccare il disco. */
  app.post("/v1/substances/validate", async (request) => {
    const result = validateProfile(readYamlBody(request.body));

    return result.ok
      ? { ok: true, substance: summarize(result.substance) }
      : { ok: false, errors: result.errors };
  });

  /** Crea o aggiorna una sostanza: stesso id, stesso file, nessun riavvio. */
  app.put("/v1/substances/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const yaml = readYamlBody(request.body);
    const result = validateProfile(yaml);

    if (!result.ok) {
      throw new AppError(`Profilo non valido: ${result.errors.join("; ")}`, {
        statusCode: 400,
        type: "invalid_request_error",
        code: "invalid_substance",
        param: "yaml",
      });
    }

    if (result.substance.id !== id) {
      throw new AppError(
        `L'id del profilo ("${result.substance.id}") non coincide con il percorso ("${id}")`,
        {
          statusCode: 400,
          type: "invalid_request_error",
          code: "id_mismatch",
          param: "yaml",
        },
      );
    }

    const existed = deps.registry.has(id);
    await writeSource(deps.substancesDir, id, yaml);
    deps.registry.upsert(result.substance);

    return reply.status(existed ? 200 : 201).send({
      ok: true,
      created: !existed,
      substance: summarize(result.substance),
    });
  });

  /** Toglie la sostanza dal catalogo e il file dal disco. */
  app.delete("/v1/substances/:id", async (request) => {
    const { id } = request.params as { id: string };

    if (!deps.registry.has(id)) {
      throw notFound(id);
    }

    for (const extension of EXTENSIONS) {
      await rm(join(deps.substancesDir, `${id}${extension}`), { force: true });
    }

    deps.registry.remove(id);

    return { ok: true, id };
  });
}
