import type { FastifyInstance } from "fastify";
import type { ProvidersConfig } from "../../providers/config.js";
import type { OpenAIModel, OpenAIModelList } from "../../shared/types.js";

/** Identificativo esposto al client: `provider/model`. */
export function toModelId(providerId: string, model: string): string {
  return `${providerId}/${model}`;
}

export function buildModelList(providers: ProvidersConfig): OpenAIModelList {
  const data: OpenAIModel[] = providers.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: toModelId(provider.id, model),
      object: "model" as const,
      created: 0,
      owned_by: provider.id,
    })),
  );

  return { object: "list", data };
}

export function registerModelRoutes(app: FastifyInstance, providers: ProvidersConfig): void {
  app.get("/v1/models", async () => buildModelList(providers));
}
