import type { FastifyInstance } from "fastify";
import type { SubstanceRegistry } from "../../engine/registry.js";
import { substanceDuration } from "../../engine/substance.js";

/** Catalogo pubblico delle sostanze: identità, carattere e durata della curva. */
export function registerSubstanceRoutes(app: FastifyInstance, registry: SubstanceRegistry): void {
  app.get("/v1/substances", async () => ({
    object: "list",
    data: registry.list().map((substance) => ({
      id: substance.id,
      object: "substance",
      name: substance.name,
      family: substance.family,
      intensity: substance.intensity,
      durationSeconds: substanceDuration(substance),
      effects: substance.effects,
      contraindications: substance.contraindications,
    })),
  }));
}
