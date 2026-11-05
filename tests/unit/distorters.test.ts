import { describe, expect, it } from "vitest";
import { applyContext } from "../../src/distorters/context.js";
import { applyLogit, hashNoise } from "../../src/distorters/logit.js";
import { applyParams, type DistortionCaps } from "../../src/distorters/params.js";
import { computeFactors } from "../../src/engine/metabolism.js";
import { parseSubstance } from "../../src/engine/substance.js";
import type { ChatCompletionRequest } from "../../src/shared/types.js";

const caps: DistortionCaps = { maxTemperature: 1.6, maxBiasedTokens: 64 };

const substance = parseSubstance(`
schema: 1
id: test-distorsioni
name: Test Distorsioni
family: delirante
intensity: 1
onsetSeconds: 0
peakSeconds: 0
plateauSeconds: 100
decaySeconds: 10
distortions:
  params:
    temperature: 0.6
    topP: 0.2
    frequencyPenalty: 0.3
    presencePenalty: 0.5
    maxTemperature: 1.4
  context:
    amnesia: 0.5
    fixation: 0.6
    fixationToken: "soglia"
    synesthesia: 0.3
  logit:
    mode: token-noise
    strength: 0.5
    maxBiasedTokens: 2
    seed: 7
    tokenIds:
      - id: 100
        bias: 10
      - id: 200
        bias: -5
      - id: 300
        bias: 3
`);

const factors = computeFactors(substance, 1, 1);
const request: ChatCompletionRequest = {
  model: "ollama-local/llama3.1:8b",
  messages: [{ role: "user", content: "ciao" }],
  temperature: 1.2,
};

describe("applyParams", () => {
  it("somma il delta e rispetta il tetto della sostanza", () => {
    const result = applyParams(request, factors, substance, caps);
    expect(result.temperature).toBe(1.4);
  });

  it("usa i default del provider come base e applica i tetti globali", () => {
    const result = applyParams({ model: "m", messages: [] }, factors, substance, {
      maxTemperature: 1.0,
      maxBiasedTokens: 64,
    });
    expect(result.temperature).toBe(1);
    expect(result.top_p).toBe(1);
    expect(result.frequency_penalty).toBe(0.3);
    expect(result.presence_penalty).toBe(0.5);
  });

  it("non tocca la richiesta senza profilo di parametri", () => {
    const plain = parseSubstance(`
schema: 1
id: senza-params
name: Senza Params
family: sedativo
intensity: 1
onsetSeconds: 0
peakSeconds: 0
plateauSeconds: 10
decaySeconds: 10
distortions: {}
`);
    expect(applyParams(request, computeFactors(plain, 1, 1), plain, caps)).toBe(request);
  });
});

describe("applyContext", () => {
  const conversation: ChatCompletionRequest = {
    model: "m",
    messages: [
      { role: "system", content: "sei un poeta" },
      { role: "user", content: "m1" },
      { role: "assistant", content: "m2" },
      { role: "user", content: "m3" },
      { role: "assistant", content: "m4" },
    ],
  };

  it("dimentica i turni più vecchi senza perdere l'ultimo", () => {
    const result = applyContext(conversation, factors, substance);
    const contents = result.messages.map((message) => message.content);

    expect(contents).toContain("sei un poeta");
    expect(contents).not.toContain("m1");
    expect(contents).not.toContain("m2");
    expect(contents).toContain("m3");
    expect(contents).toContain("m4");
  });

  it("inietta fissazione e sinestesia come direttiva di sistema", () => {
    const result = applyContext(conversation, factors, substance);
    const last = result.messages.at(-1);

    expect(last?.role).toBe("system");
    expect(String(last?.content)).toContain("soglia");
    expect(String(last?.content)).toContain("Sinestesia");
  });

  it("non modifica il contesto quando l'effetto è nullo", () => {
    const expired = computeFactors(substance, 1, 10_000);
    expect(applyContext(conversation, expired, substance)).toBe(conversation);
  });
});

describe("applyLogit", () => {
  it("limita il numero di voci e ordina per intensità", () => {
    const result = applyLogit(request, factors, substance, caps);
    expect(Object.keys(result.logit_bias ?? {})).toEqual(["100", "200"]);
  });

  it("è deterministico e dipende dal seed", () => {
    const first = applyLogit(request, factors, substance, caps);
    const second = applyLogit(request, factors, substance, caps);

    expect(first.logit_bias).toEqual(second.logit_bias);
    expect(hashNoise(7, 100)).toBe(hashNoise(7, 100));
    expect(hashNoise(7, 100)).not.toBe(hashNoise(8, 100));
  });

  it("somma il bias già inviato dal client", () => {
    const result = applyLogit({ ...request, logit_bias: { "200": -10 } }, factors, substance, caps);
    // base curata (-5 × 0.5) + rumore proporzionale + bias del client (-10)
    const expected = -2.5 + hashNoise(7, 200) * 2.5 * 0.3 - 10;

    expect(result.logit_bias?.["200"]).toBeCloseTo(expected, 1);
    expect(result.logit_bias?.["100"]).toBeDefined();
  });

  it("non interviene fuori dalla finestra di effetto", () => {
    const expired = computeFactors(substance, 1, 10_000);
    const withBias = { ...request, logit_bias: { "42": 3 } };
    expect(applyLogit(withBias, expired, substance, caps)).toBe(withBias);
  });
});
