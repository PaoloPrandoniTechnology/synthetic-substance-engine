import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config.js";
import type { ProvidersConfig } from "../providers/config.js";
import { registerErrorHandler } from "./middleware/errors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerModelRoutes } from "./routes/models.js";

export interface BuildAppOptions {
  config: AppConfig;
  providers: ProvidersConfig;
  /** `false` nei test per silenziare i log. */
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({
  config,
  providers,
  logger,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
  });

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerModelRoutes(app, providers);

  return app;
}
