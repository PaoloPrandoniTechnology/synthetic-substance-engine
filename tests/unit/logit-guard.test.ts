import { describe, expect, it } from "vitest";
import { logitStatus } from "../../src/distorters/logit.js";
import { parseSubstance } from "../../src/engine/substance.js";

const tokenized = parseSubstance(
  `
schema: 1
id: guardia-logit
name: Guardia Logit
family: delirante
intensity: 1
onsetSeconds: 0
peakSeconds: 0
plateauSeconds: 100
decaySeconds: 10
distortions:
  logit:
    mode: associative-drift
    strength: 0.5
    targetTokenizer: cl100k_base
    tokens:
      - text: "colore"
        bias: 8
`,
  "test",
  { resolveTokens: () => [42] },
);

const manual = parseSubstance(`
schema: 1
id: guardia-manuale
name: Guardia Manuale
family: delirante
intensity: 1
onsetSeconds: 0
peakSeconds: 0
plateauSeconds: 100
decaySeconds: 10
distortions:
  logit:
    mode: token-noise
    strength: 0.5
    tokenIds:
      - id: 42
        bias: 8
`);

describe("logitStatus", () => {
  it("applica solo con il tokenizer dichiarato", () => {
    expect(logitStatus(tokenized, "cl100k_base")).toBe("applied");
    expect(logitStatus(tokenized, "o200k_base")).toBe("skipped-tokenizer-mismatch");
    expect(logitStatus(tokenized, undefined)).toBe("skipped-no-tokenizer");
  });

  it("considera applicabili i profili con soli token id manuali", () => {
    expect(logitStatus(manual, undefined)).toBe("applied");
  });

  it("resta off senza blocco logit", () => {
    const plain = parseSubstance(`
schema: 1
id: senza-logit
name: Senza Logit
family: sedativo
intensity: 1
onsetSeconds: 0
peakSeconds: 0
plateauSeconds: 10
decaySeconds: 10
distortions: {}
`);
    expect(logitStatus(plain, "cl100k_base")).toBe("off");
  });
});
