import { AppError } from "../shared/errors.js";
import type { ChatProviderClient } from "./base.js";
import type { Provider, ProvidersConfig } from "./config.js";
import { createOpenAICompatibleClient } from "./openai-compatible.js";

export interface ResolvedModel {
  provider: Provider;
  model: string;
}

/**
 * Risolve `provider/modello` nel provider concreto. Un id senza prefisso noto
 * viene inviato al provider di default così com'è (compatibilità con id esterni
 * come `meta-llama/Llama-3-8B`).
 */
export function resolveModel(providers: ProvidersConfig, modelId: string): ResolvedModel {
  const separator = modelId.indexOf("/");

  if (separator > 0) {
    const providerId = modelId.slice(0, separator);
    const provider = providers.providers.find((candidate) => candidate.id === providerId);
    if (provider) {
      return { provider, model: modelId.slice(separator + 1) };
    }
  }

  const fallback = providers.providers.find((candidate) => candidate.id === providers.default);
  if (!fallback) {
    throw new AppError(`Provider di default "${providers.default}" non configurato`, {
      statusCode: 500,
      type: "server_error",
      code: "provider_missing",
    });
  }

  return { provider: fallback, model: modelId };
}

export function createProviderClient(provider: Provider): ChatProviderClient {
  return createOpenAICompatibleClient(provider);
}
