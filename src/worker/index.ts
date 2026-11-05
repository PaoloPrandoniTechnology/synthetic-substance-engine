import allucinazioneControllataSource from "../../config/substances/allucinazione-controllata.yaml";
import amnesiaAnterogradaSource from "../../config/substances/amnesia-anterograda.yaml";
import euforiaCreativaSource from "../../config/substances/euforia-creativa.yaml";
import fissazioneParanoicaSource from "../../config/substances/fissazione-paranoica.yaml";
import sinestesiaConcettualeSource from "../../config/substances/sinestesia-concettuale.yaml";
import { summarizeSubstance, validateProfile } from "../engine/catalog-api.js";
import { parseSubstance, type Substance, substanceDuration } from "../engine/substance.js";
import { buildTripReport } from "../telemetry/trip-report.js";

/**
 * Demo online: le stesse API che il playground chiama sul proxy, servite da un
 * Worker. Il motore è quello vero (curva, referto, validazione); cambia solo il
 * posto dove vivono i profili, perché un Worker non ha un disco da scrivere.
 */

/** Catalogo compilato nel bundle: identico ai file `config/substances/*.yaml`. */
const BUNDLED_SOURCES: Readonly<Record<string, string>> = {
  "allucinazione-controllata": allucinazioneControllataSource,
  "amnesia-anterograda": amnesiaAnterogradaSource,
  "euforia-creativa": euforiaCreativaSource,
  "fissazione-paranoica": fissazioneParanoicaSource,
  "sinestesia-concettuale": sinestesiaConcettualeSource,
};

const BUNDLED = new Map<string, Substance>(
  Object.entries(BUNDLED_SOURCES).map(([id, source]) => [
    id,
    parseSubstance(source, `config/substances/${id}.yaml`),
  ]),
);

/** Ogni visitatore ha il suo catalogo: le modifiche non finiscono a nessun altro. */
const SESSION_COOKIE = "sse_demo";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1Statement;
  exec(sql: string): Promise<unknown>;
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: D1DatabaseLike;
}

interface StoredRow {
  id: string;
  yaml: string;
  deleted: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorResponse(options: {
  status: number;
  message: string;
  code: string;
  type?: string;
  param?: string | null;
}): Response {
  return json(
    {
      error: {
        message: options.message,
        type: options.type ?? "invalid_request_error",
        param: options.param ?? null,
        code: options.code,
      },
    },
    options.status,
  );
}

function notFound(id: string): Response {
  return errorResponse({
    status: 404,
    message: `Sostanza sconosciuta: ${id}`,
    code: "substance_not_found",
    param: "id",
  });
}

function invalidBody(): Response {
  return errorResponse({
    status: 400,
    message: 'Body non valido: serve {"yaml": "<profilo>"}',
    code: "invalid_body",
    param: "yaml",
  });
}

function storageUnavailable(): Response {
  return errorResponse({
    status: 503,
    message:
      "Questa demo è in sola lettura: il database delle modifiche non è configurato, quindi il catalogo resta quello del repo.",
    code: "storage_unavailable",
    type: "server_error",
  });
}

function sessionFor(request: Request): { sid: string; cookie: string | undefined } {
  const header = request.headers.get("cookie") ?? "";

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (name === SESSION_COOKIE && SESSION_PATTERN.test(value)) {
      return { sid: value, cookie: undefined };
    }
  }

  const sid = crypto.randomUUID();
  const cookie = `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;

  return { sid, cookie };
}

function withCookie(response: Response, cookie: string | undefined): Response {
  if (!cookie) {
    return response;
  }

  const copy = new Response(response.body, response);
  copy.headers.append("set-cookie", cookie);

  return copy;
}

let schemaReady: Promise<unknown> | undefined;

const CREATE_TABLE =
  "CREATE TABLE IF NOT EXISTS demo_substances (sid TEXT NOT NULL, id TEXT NOT NULL, " +
  "yaml TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, " +
  "PRIMARY KEY (sid, id))";

/** La tabella è per-visitatore: nessuna scrittura può toccare il catalogo degli altri. */
function ensureSchema(db: D1DatabaseLike): Promise<unknown> {
  schemaReady ??= db
    .prepare(CREATE_TABLE)
    .run()
    .catch((error: unknown) => {
      schemaReady = undefined;
      throw error;
    });

  return schemaReady;
}

async function storedRows(env: Env, sid: string): Promise<StoredRow[]> {
  if (!env.DB) {
    return [];
  }

  await ensureSchema(env.DB);

  const result = await env.DB.prepare(
    "SELECT id, yaml, deleted FROM demo_substances WHERE sid = ?1",
  )
    .bind(sid)
    .all<StoredRow>();

  return result.results ?? [];
}

/**
 * Variante tollerante: se lo storage non risponde la demo mostra comunque il
 * catalogo del repo invece di un errore 500.
 */
async function storedRowsOrEmpty(env: Env, sid: string): Promise<StoredRow[]> {
  try {
    return await storedRows(env, sid);
  } catch {
    return [];
  }
}

async function loadCatalog(env: Env, sid: string): Promise<Map<string, Substance>> {
  const catalog = new Map(BUNDLED);

  for (const row of await storedRowsOrEmpty(env, sid)) {
    if (row.deleted) {
      catalog.delete(row.id);
      continue;
    }

    try {
      catalog.set(row.id, parseSubstance(row.yaml, `demo/${row.id}.yaml`));
    } catch {}
  }

  return catalog;
}

async function sourceFor(env: Env, sid: string, id: string): Promise<string | undefined> {
  for (const row of await storedRowsOrEmpty(env, sid)) {
    if (row.id !== id) {
      continue;
    }

    return row.deleted ? undefined : row.yaml;
  }

  return BUNDLED_SOURCES[id];
}

async function readYamlBody(request: Request): Promise<string | undefined> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return undefined;
  }

  const yaml = (body as { yaml?: unknown } | null)?.yaml;

  return typeof yaml === "string" && yaml.trim().length > 0 ? yaml : undefined;
}

function numberParam(
  params: URLSearchParams,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number | undefined {
  const raw = params.get(field);

  if (raw === null) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return undefined;
  }

  return parsed;
}

function listItem(substance: Substance) {
  return {
    id: substance.id,
    object: "substance",
    name: substance.name,
    family: substance.family,
    intensity: substance.intensity,
    durationSeconds: substanceDuration(substance),
    effects: substance.effects,
    contraindications: substance.contraindications,
  };
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (pathname === "/healthz") {
    return json({ status: "ok", mode: env.DB ? "demo" : "demo-read-only" });
  }

  if (method === "GET" && (pathname === "/" || pathname === "/playground")) {
    if (pathname === "/") {
      return Response.redirect(new URL("/playground", url).toString(), 302);
    }

    // Gli asset canonicalizzano `/index.html` verso `/playground`: chiediamo la radice.
    return env.ASSETS.fetch(new Request(new URL("/", url).toString(), request));
  }

  if (method === "GET" && pathname === "/v1/models") {
    // Senza provider configurato la chat non ha modelli da mostrare: il playground lo dice.
    return json({ object: "list", data: [] });
  }

  const { sid, cookie } = sessionFor(request);

  if (method === "GET" && pathname === "/v1/substances") {
    const catalog = await loadCatalog(env, sid);

    return withCookie(
      json({ object: "list", data: [...catalog.values()].map((item) => listItem(item)) }),
      cookie,
    );
  }

  const tripReportMatch = pathname.match(/^\/v1\/substances\/([^/]+)\/trip-report$/);

  if (method === "GET" && tripReportMatch) {
    const id = decodeURIComponent(tripReportMatch[1] ?? "");
    const substance = (await loadCatalog(env, sid)).get(id);

    if (!substance) {
      return withCookie(notFound(id), cookie);
    }

    const dose = numberParam(url.searchParams, "dose", 1, 0, 1);
    const elapsed = numberParam(url.searchParams, "elapsed", 0, 0, 86_400);

    if (dose === undefined) {
      return withCookie(
        errorResponse({
          status: 400,
          message: "Parametro dose non valido: usare un numero tra 0 e 1",
          code: "invalid_parameter",
          param: "dose",
        }),
        cookie,
      );
    }

    if (elapsed === undefined) {
      return withCookie(
        errorResponse({
          status: 400,
          message: "Parametro elapsed non valido: usare un numero tra 0 e 86400",
          code: "invalid_parameter",
          param: "elapsed",
        }),
        cookie,
      );
    }

    return withCookie(json(buildTripReport(substance, dose, elapsed)), cookie);
  }

  const sourceMatch = pathname.match(/^\/v1\/substances\/([^/]+)\/source$/);

  if (method === "GET" && sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1] ?? "");
    const catalog = await loadCatalog(env, sid);

    if (!catalog.has(id)) {
      return withCookie(notFound(id), cookie);
    }

    const source = await sourceFor(env, sid, id);

    if (source === undefined) {
      return withCookie(notFound(id), cookie);
    }

    return withCookie(
      new Response(source, {
        status: 200,
        headers: { "content-type": "text/yaml; charset=utf-8", "cache-control": "no-store" },
      }),
      cookie,
    );
  }

  if (method === "POST" && pathname === "/v1/substances/validate") {
    const yaml = await readYamlBody(request);

    if (yaml === undefined) {
      return withCookie(invalidBody(), cookie);
    }

    const result = validateProfile(yaml);

    return withCookie(
      json(
        result.ok
          ? { ok: true, substance: summarizeSubstance(result.substance) }
          : { ok: false, errors: result.errors },
      ),
      cookie,
    );
  }

  const profileMatch = pathname.match(/^\/v1\/substances\/([^/]+)$/);

  if (method === "PUT" && profileMatch) {
    const db = env.DB;

    if (!db) {
      return withCookie(storageUnavailable(), cookie);
    }

    const id = decodeURIComponent(profileMatch[1] ?? "");
    const yaml = await readYamlBody(request);

    if (yaml === undefined) {
      return withCookie(invalidBody(), cookie);
    }

    const result = validateProfile(yaml);

    if (!result.ok) {
      return withCookie(
        errorResponse({
          status: 400,
          message: `Profilo non valido: ${result.errors.join("; ")}`,
          code: "invalid_substance",
          param: "yaml",
        }),
        cookie,
      );
    }

    if (result.substance.id !== id) {
      return withCookie(
        errorResponse({
          status: 400,
          message: `L'id del profilo ("${result.substance.id}") non coincide con il percorso ("${id}")`,
          code: "id_mismatch",
          param: "yaml",
        }),
        cookie,
      );
    }

    const existed = (await loadCatalog(env, sid)).has(id);

    await ensureSchema(db);
    await db
      .prepare(
        `INSERT INTO demo_substances (sid, id, yaml, deleted, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4)
         ON CONFLICT(sid, id) DO UPDATE SET yaml = excluded.yaml, deleted = 0, updated_at = excluded.updated_at`,
      )
      .bind(sid, id, yaml, new Date().toISOString())
      .run();

    return withCookie(
      json(
        { ok: true, created: !existed, substance: summarizeSubstance(result.substance) },
        existed ? 200 : 201,
      ),
      cookie,
    );
  }

  if (method === "DELETE" && profileMatch) {
    const db = env.DB;

    if (!db) {
      return withCookie(storageUnavailable(), cookie);
    }

    const id = decodeURIComponent(profileMatch[1] ?? "");
    const catalog = await loadCatalog(env, sid);

    if (!catalog.has(id)) {
      return withCookie(notFound(id), cookie);
    }

    await ensureSchema(db);
    await db
      .prepare(
        `INSERT INTO demo_substances (sid, id, yaml, deleted, updated_at)
         VALUES (?1, ?2, '', 1, ?3)
         ON CONFLICT(sid, id) DO UPDATE SET deleted = 1, yaml = '', updated_at = excluded.updated_at`,
      )
      .bind(sid, id, new Date().toISOString())
      .run();

    return withCookie(json({ ok: true, id }), cookie);
  }

  if (method === "POST" && pathname === "/v1/chat/completions") {
    return withCookie(
      errorResponse({
        status: 503,
        message:
          "La chat non è disponibile nella demo online: richiede un provider configurato (Ollama, LM Studio, vLLM o OpenAI). Motore, curva e catalogo funzionano davvero: prova a dosare una sostanza.",
        code: "demo_chat_unavailable",
        type: "server_error",
      }),
      cookie,
    );
  }

  if (pathname.startsWith("/v1/")) {
    return withCookie(
      errorResponse({
        status: 404,
        message: `Rotta non disponibile: ${method} ${pathname}`,
        code: "not_found",
      }),
      cookie,
    );
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
