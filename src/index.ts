import { loadConfig } from "./config.js";
import { loadSubstances } from "./engine/registry.js";
import { SessionStore } from "./engine/session.js";
import { loadProvidersConfig } from "./providers/config.js";
import { buildApp } from "./server/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const providers = await loadProvidersConfig(config.providersConfigPath);
  const registry = await loadSubstances(config.substancesDir);
  const app = await buildApp({
    config,
    providers,
    registry,
    sessions: new SessionStore(),
    env: process.env,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "arresto del proxy richiesto");
    await app.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { providerDiDefault: providers.default, sostanze: registry.size },
    "synthetic substance engine pronto",
  );
}

main().catch((error: unknown) => {
  console.error("Avvio del proxy fallito:", error instanceof Error ? error.message : error);
  process.exit(1);
});
