import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { loadSubstances, type SubstanceRegistry } from "../../src/engine/registry.js";
import { SessionStore } from "../../src/engine/session.js";
import { parseProvidersConfig } from "../../src/providers/config.js";
import { buildApp } from "../../src/server/app.js";

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

let app: FastifyInstance;
let registry: SubstanceRegistry;
const fetchMock = vi.fn();

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
    sleep: async () => {},
  });
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

describe("GET /v1/substances/:id/trip-report", () => {
  it("simula dose e tempo senza sessione", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/substances/test-lite/trip-report?dose=0.5&elapsed=100",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      substanceId: "test-lite",
      phase: "plateau",
      percent: 50,
      dose: 0.5,
      elapsedSeconds: 100,
    });
    expect(response.json().summary).toContain("Test Lite");
  });

  it("rifiuta parametri fuori scala", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/substances/test-lite/trip-report?dose=2",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_parameter" } });
  });

  it("risponde 404 per una sostanza inesistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/substances/non-esiste/trip-report",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "substance_not_found" } });
  });
});

describe("GET /v1/sessions/:sessionId/trip-report", () => {
  it("riporta la sessione creata da una richiesta chat", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "chatcmpl-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "x-substance-id": "test-lite", "x-session-id": "sessione-1" },
      payload: {
        model: "ollama-local/llama3.1:8b",
        messages: [{ role: "user", content: "ciao" }],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/sessione-1/trip-report",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: "sessione-1",
      substanceId: "test-lite",
      requests: 1,
      percent: 100,
      phase: "plateau",
    });
  });

  it("risponde 404 per una sessione inesistente", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sessions/mai-vista/trip-report" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "session_not_found" } });
  });
});
