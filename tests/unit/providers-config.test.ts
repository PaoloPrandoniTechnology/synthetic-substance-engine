import { describe, expect, it } from "vitest";
import { parseProvidersConfig } from "../../src/providers/config.js";

const validYaml = `
version: 1
default: ollama-local
providers:
  - id: ollama-local
    kind: ollama
    baseUrl: http://127.0.0.1:11434
    models:
      - llama3.1:8b
  - id: openai-cloud
    kind: openai
    baseUrl: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
    models:
      - gpt-4o-mini
`;

describe("parseProvidersConfig", () => {
  it("accetta un catalogo valido", () => {
    const config = parseProvidersConfig(validYaml);

    expect(config.default).toBe("ollama-local");
    expect(config.providers).toHaveLength(2);
    expect(config.providers[1]?.models).toEqual(["gpt-4o-mini"]);
  });

  it("rifiuta un default inesistente", () => {
    const yaml = validYaml.replace("default: ollama-local", "default: inesistente");

    expect(() => parseProvidersConfig(yaml)).toThrow(/default "inesistente" non presente/);
  });

  it("rifiuta id duplicati", () => {
    const yaml = `
version: 1
default: a
providers:
  - id: a
    kind: ollama
    baseUrl: http://127.0.0.1:11434
  - id: a
    kind: ollama
    baseUrl: http://127.0.0.1:11435
`;

    expect(() => parseProvidersConfig(yaml)).toThrow(/duplicato "a"/);
  });

  it("rifiuta un baseUrl non assoluto", () => {
    const yaml = `
version: 1
default: a
providers:
  - id: a
    kind: ollama
    baseUrl: "non-un-url"
`;

    expect(() => parseProvidersConfig(yaml)).toThrow(/baseUrl non valido/);
  });

  it("rifiuta uno schema non conforme", () => {
    expect(() => parseProvidersConfig("version: 2\ndefault: a\nproviders: []\n")).toThrow(
      /non valido/,
    );
  });
});
