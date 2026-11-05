import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config.js";
import type { DistortionCaps } from "../distorters/params.js";
import { SubstanceRegistry } from "../engine/registry.js";
import { SessionStore } from "../engine/session.js";
import type { ProvidersConfig } from "../providers/config.js";
import { registerErrorHandler } from "./middleware/errors.js";
import { registerChatCompletionsRoute } from "./routes/chat-completions.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerPlaygroundRoutes } from "./routes/playground.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerSubstanceRoutes } from "./routes/substances.js";

export interface BuildAppOptions {
  config: AppConfig;
  providers: ProvidersConfig;
  /** `false` nei test per silenziare i log. */
  logger?: FastifyServerOptions["logger"];
  registry?: SubstanceRegistry;
  sessions?: SessionStore;
  env?: Record<string, string | undefined>;
  /** Iniettabile nei test: il jitter non attende davvero. */
  sleep?: (ms: number) => Promise<void>;
}

export async function buildApp({
  config,
  providers,
  logger,
  registry = new SubstanceRegistry(),
  sessions = new SessionStore(),
  env = process.env,
  sleep,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
  });

  const caps: DistortionCaps = {
    maxTemperature: config.maxTemperature,
    maxBiasedTokens: config.maxBiasedTokens,
  };

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerModelRoutes(app, providers);
  registerPlaygroundRoutes(app);
  registerSubstanceRoutes(app, { registry, substancesDir: config.substancesDir });
  registerReportRoutes(app, { registry, sessions });
  registerChatCompletionsRoute(app, { providers, registry, sessions, caps, env, sleep });

  return app;
}
