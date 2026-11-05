import { describe, expect, it } from "vitest";
import { parseSubstance } from "../../src/engine/substance.js";
import { encodeText } from "../../src/engine/tokenizer.js";

function profile(logit: string): string {
  return `
schema: 1
id: prova-token
name: Prova Token
family: delirante
intensity: 1
onsetSeconds: 0
peakSeconds: 0
plateauSeconds: 100
decaySeconds: 10
distortions:
  logit:
${logit}
`;
}

/** Resolver finto: "colore" → [1, 2, 3, 4, 5, 6] */
const fakeResolver = (text: string): number[] =>
  Array.from({ length: text.length }, (_, index) => index + 1);

describe("parseSubstance con tokens", () => {
  it("compila solo il primo token per default", () => {
    const substance = parseSubstance(
      profile(`    mode: associative-drift
    strength: 0.5
    targetTokenizer: cl100k_base
    tokens:
      - text: "colore"
        bias: 10
`),
      "test",
      { resolveTokens: fakeResolver },
    );

    expect(substance.distortions.logit?.tokenIds).toEqual([{ id: 1, bias: 10 }]);
  });

  it("con target all prende tutti i sub-token", () => {
    const substance = parseSubstance(
      profile(`    mode: associative-drift
    strength: 0.5
    targetTokenizer: cl100k_base
    tokens:
      - text: "abc"
        bias: 4
        target: all
`),
      "test",
      { resolveTokens: fakeResolver },
    );

    expect(substance.distortions.logit?.tokenIds).toEqual([
      { id: 1, bias: 4 },
      { id: 2, bias: 4 },
      { id: 3, bias: 4 },
    ]);
  });

  it("deduplica scegliendo il bias più forte", () => {
    const substance = parseSubstance(
      profile(`    mode: associative-drift
    strength: 0.5
    targetTokenizer: cl100k_base
    tokens:
      - text: "a"
        bias: 4
      - text: "b"
        bias: -9
`),
      "test",
      { resolveTokens: () => [7] },
    );

    expect(substance.distortions.logit?.tokenIds).toEqual([{ id: 7, bias: -9 }]);
  });

  it("usa il tokenizer reale quando non viene iniettato un resolver", () => {
    const substance = parseSubstance(
      profile(`    mode: associative-drift
    strength: 0.5
    targetTokenizer: o200k_base
    tokens:
      - text: "sogno"
        bias: 8
`),
    );

    const expected = encodeText("sogno", "o200k_base")[0];
    expect(substance.distortions.logit?.tokenIds).toEqual([{ id: expected, bias: 8 }]);
  });

  it("rifiuta tokens senza targetTokenizer", () => {
    const yaml = profile(`    mode: associative-drift
    strength: 0.5
    tokens:
      - text: "colore"
        bias: 8
`);

    expect(() => parseSubstance(yaml, "test")).toThrow(/richiede targetTokenizer/);
  });

  it("rifiuta un tokenizer non supportato", () => {
    const yaml = profile(`    mode: associative-drift
    strength: 0.5
    targetTokenizer: llama3
    tokens:
      - text: "colore"
        bias: 8
`);

    expect(() => parseSubstance(yaml, "test")).toThrow(/tokenizer non supportato/);
  });
});
