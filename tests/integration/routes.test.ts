import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
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
      - qwen2.5:7b
`);

let app: FastifyInstance | undefined;

async function createApp(): Promise<FastifyInstance> {
  app = await buildApp({
    config: loadConfig({}),
    providers,
    logger: false,
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("proxy HTTP", () => {
  it("risponde su /healthz", async () => {
    const server = await createApp();
    const response = await server.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "synthetic-substance-engine",
    });
  });

  it("espone il catalogo modelli in formato OpenAI", async () => {
    const server = await createApp();
    const response = await server.inject({ method: "GET", url: "/v1/models" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: "list",
      data: [
        { id: "ollama-local/llama3.1:8b", object: "model", created: 0, owned_by: "ollama-local" },
        { id: "ollama-local/qwen2.5:7b", object: "model", created: 0, owned_by: "ollama-local" },
      ],
    });
  });

  it("restituisce errori con il formato OpenAI", async () => {
    const server = await createApp();
    const response = await server.inject({ method: "GET", url: "/v1/inesistente" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        message: "Rotta non trovata: GET /v1/inesistente",
        type: "invalid_request_error",
        param: null,
        code: "not_found",
      },
    });
  });
});

describe("loadConfig", () => {
  it("applica i default", () => {
    expect(loadConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      logLevel: "info",
      providersConfigPath: "config/providers.yaml",
    });
  });

  it("rifiuta valori non validi", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Configurazione ambiente non valida/);
  });
});
