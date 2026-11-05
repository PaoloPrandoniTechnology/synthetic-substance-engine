import { describe, expect, it } from "vitest";
import {
  encodeText,
  isSupportedTokenizer,
  SUPPORTED_TOKENIZERS,
} from "../../src/engine/tokenizer.js";

describe("tokenizer", () => {
  it("codifica una parola in token id validi e stabili", () => {
    const ids = encodeText("colore", "cl100k_base");

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => Number.isInteger(id) && id >= 0)).toBe(true);
    expect(encodeText("colore", "cl100k_base")).toEqual(ids);
  });

  it("distingue i vocabolari", () => {
    expect(encodeText("colore", "cl100k_base")).not.toEqual(encodeText("colore", "o200k_base"));
  });

  it("riconosce solo i tokenizer supportati", () => {
    for (const name of SUPPORTED_TOKENIZERS) {
      expect(isSupportedTokenizer(name)).toBe(true);
    }
    expect(isSupportedTokenizer("llama3")).toBe(false);
  });
});
