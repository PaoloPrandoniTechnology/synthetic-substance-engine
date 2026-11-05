import type { Factors } from "../engine/metabolism.js";
import type { Substance } from "../engine/substance.js";
import type { ChatCompletionRequest } from "../shared/types.js";
import { clamp, round } from "../shared/utils.js";

export interface DistortionCaps {
  /** Tetto globale di temperature imposto dal proxy. */
  maxTemperature: number;
  /** Numero massimo di voci logit_bias per richiesta. */
  maxBiasedTokens: number;
}

/**
 * Applica i delta dei parametri di sampling. I valori del client restano la base:
 * la sostanza somma il proprio effetto e non può mai superare i tetti dichiarati.
 */
export function applyParams(
  request: ChatCompletionRequest,
  factors: Factors,
  substance: Substance,
  caps: DistortionCaps,
): ChatCompletionRequest {
  const params = substance.distortions.params;
  if (!params) {
    return request;
  }

  const result: ChatCompletionRequest = { ...request };
  const temperatureCap = Math.min(
    caps.maxTemperature,
    params.maxTemperature ?? caps.maxTemperature,
  );

  if (params.temperature !== 0) {
    const base = request.temperature ?? 1;
    result.temperature = round(
      clamp(base + params.temperature * factors.envelope, 0, temperatureCap),
    );
  }

  if (params.topP !== 0) {
    const base = request.top_p ?? 1;
    result.top_p = round(clamp(base + params.topP * factors.envelope, 0.01, 1));
  }

  if (params.frequencyPenalty !== 0) {
    const base = request.frequency_penalty ?? 0;
    result.frequency_penalty = round(
      clamp(base + params.frequencyPenalty * factors.envelope, -2, 2),
    );
  }

  if (params.presencePenalty !== 0) {
    const base = request.presence_penalty ?? 0;
    result.presence_penalty = round(clamp(base + params.presencePenalty * factors.envelope, -2, 2));
  }

  return result;
}
