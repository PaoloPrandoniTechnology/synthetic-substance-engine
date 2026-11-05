import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { loadSubstances, type SubstanceRegistry } from "../../src/engine/registry.js";
import { SessionStore } from "../../src/engine/session.js";
import { parseProvidersConfig } from "../../src/providers/config.js";
import { buildApp } from "../../src/server/app.js";

const providers = parseProvidersConfig(`
version: 1
default: finta
providers:
  - id: finta
    kind: ollama
    baseUrl: http://127.0.0.1:11434
    models:
      - modello
`);

let app: FastifyInstance;
let registry: SubstanceRegistry;

beforeAll(async () => {
  registry = await loadSubstances("config/substances");
});

afterEach(async () => {
  await app.close();
});

async function makeApp(): Promise<FastifyInstance> {
  return buildApp({
    config: loadConfig({}),
    providers,
    registry,
    sessions: new SessionStore(() => 0),
    logger: false,
    env: {},
    sleep: async () => {},
  });
}

describe("playground", () => {
  it("serve la pagina statica", async () => {
    app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/playground" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<title>Playground");
    expect(response.body).toContain('id="curve"');
    expect(response.body).toContain("/v1/chat/completions");
  });

  it("manda la radice al playground", async () => {
    app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/playground");
  });
});
