import type { Factors } from "../engine/metabolism.js";
import type { Substance } from "../engine/substance.js";
import type { ChatCompletionRequest } from "../shared/types.js";
import { clamp, round } from "../shared/utils.js";
import type { DistortionCaps } from "./params.js";

/** Quanto il rumore può spostare un bias curato (30% della sua intensità). */
const NOISE_RATIO = 0.3;

/** Rumore deterministico in [-1, 1] derivato da seed e token id (nessun Math.random). */
export function hashNoise(seed: number, tokenId: number): number {
  let hash = (seed ^ (tokenId + 0x9e3779b9)) >>> 0;
  hash = (hash ^ (hash << 13)) >>> 0;
  hash = (hash ^ (hash >> 17)) >>> 0;
  hash = (hash ^ (hash << 5)) >>> 0;
  return (hash / 0xffffffff) * 2 - 1;
}

/**
 * Costruisce `logit_bias` a partire dai token id curati nel profilo, sommandoli
 * al bias già inviato dal client. Le voci sono limitate per numero e per valore.
 */
export function applyLogit(
  request: ChatCompletionRequest,
  factors: Factors,
  substance: Substance,
  caps: DistortionCaps,
): ChatCompletionRequest {
  const logit = substance.distortions.logit;

  if (!logit || logit.mode === "off" || factors.envelope < 0.01 || factors.logit.strength <= 0) {
    return request;
  }

  const biases = new Map<number, number>();

  for (const token of logit.tokenIds) {
    const base = token.bias * factors.logit.strength;
    // Il rumore è proporzionale al bias curato: resta un'increspatura, non
    // un valore che stravolge l'intenzione del profilo (e resta riproducibile).
    const jitter =
      logit.mode === "token-noise"
        ? hashNoise(logit.seed, token.id) * Math.abs(base) * NOISE_RATIO
        : 0;
    biases.set(token.id, base + jitter);
  }

  if (biases.size === 0) {
    return request;
  }

  const merged = new Map<number, number>(biases);

  for (const [key, value] of Object.entries(request.logit_bias ?? {})) {
    const tokenId = Number(key);
    if (!Number.isInteger(tokenId)) {
      continue;
    }
    merged.set(tokenId, (merged.get(tokenId) ?? 0) + value);
  }

  const maxEntries = Math.min(logit.maxBiasedTokens, caps.maxBiasedTokens);
  const entries = [...merged.entries()]
    .map(([tokenId, bias]) => [tokenId, round(clamp(bias, -100, 100), 2)] as const)
    .filter(([, bias]) => bias !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, maxEntries);

  const logitBias: Record<string, number> = {};
  for (const [tokenId, bias] of entries) {
    logitBias[String(tokenId)] = bias;
  }

  return { ...request, logit_bias: logitBias };
}
