import type { FastifyInstance } from "fastify";

const startedAt = Date.now();

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/healthz", async () => ({
    status: "ok",
    service: "synthetic-substance-engine",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }));
}
