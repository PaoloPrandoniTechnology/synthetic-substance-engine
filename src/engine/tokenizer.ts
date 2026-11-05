import { encode as encodeCL100kBase } from "gpt-tokenizer/encoding/cl100k_base";
import { encode as encodeO200kBase } from "gpt-tokenizer/encoding/o200k_base";

/** Tokenizer supportati per compilare le parole dei profili in token id. */
export const SUPPORTED_TOKENIZERS = ["cl100k_base", "o200k_base"] as const;

export type TokenizerName = (typeof SUPPORTED_TOKENIZERS)[number];

const ENCODERS: Record<TokenizerName, (text: string) => number[]> = {
  cl100k_base: encodeCL100kBase,
  o200k_base: encodeO200kBase,
};

export function isSupportedTokenizer(name: string): name is TokenizerName {
  return (SUPPORTED_TOKENIZERS as readonly string[]).includes(name);
}

export function encodeText(text: string, tokenizer: TokenizerName): number[] {
  return ENCODERS[tokenizer](text);
}
