import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { loadSubstances, type SubstanceRegistry } from "../../src/engine/registry.js";
import { SessionStore } from "../../src/engine/session.js";
import { encodeText } from "../../src/engine/tokenizer.js";
import { parseProvidersConfig } from "../../src/providers/config.js";
import { buildApp } from "../../src/server/app.js";
import type { ChatCompletionRequest } from "../../src/shared/types.js";

const providers = parseProvidersConfig(`
version: 1
default: senza-tokenizer
providers:
  - id: con-tokenizer
    kind: openai-compatible
    baseUrl: http://127.0.0.1:1111
    tokenizer: cl100k_base
    models:
      - modello
  - id: altro-tokenizer
    kind: openai-compatible
    baseUrl: http://127.0.0.1:2222
    tokenizer: o200k_base
    models:
      - modello
  - id: senza-tokenizer
    kind: ollama
    baseUrl: http://127.0.0.1:11434
    models:
      - modello
`);

let app: FastifyInstance;
let registry: SubstanceRegistry;
const fetchMock = vi.fn();

function forwardedBody(): ChatCompletionRequest {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as ChatCompletionRequest;
}

beforeAll(async () => {
  registry = await loadSubstances("tests/fixtures/tokenized");
});

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: "chatcmpl-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
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

async function chat(model: string) {
  return app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { "x-substance-id": "test-tokens" },
    payload: { model, messages: [{ role: "user", content: "ciao" }] },
  });
}

describe("logit con tokenizer", () => {
  it("applica il bias quando il tokenizer coincide", async () => {
    const response = await chat("con-tokenizer/modello");
    const tokenId = encodeText("colore", "cl100k_base")[0];

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-logit-status"]).toBe("applied");
    expect(forwardedBody().logit_bias).toEqual({ [String(tokenId)]: 5 });
  });

  it("salta il bias su un tokenizer diverso", async () => {
    const response = await chat("altro-tokenizer/modello");

    expect(response.headers["x-logit-status"]).toBe("skipped-tokenizer-mismatch");
    expect(forwardedBody().logit_bias).toBeUndefined();
  });

  it("salta il bias se il provider non dichiara il tokenizer", async () => {
    const response = await chat("senza-tokenizer/modello");

    expect(response.headers["x-logit-status"]).toBe("skipped-no-tokenizer");
    expect(forwardedBody().logit_bias).toBeUndefined();
  });
});
