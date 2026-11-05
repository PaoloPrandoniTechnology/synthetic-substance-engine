import { loadConfig } from "./config.js";
import { loadProvidersConfig } from "./providers/config.js";
import { buildApp } from "./server/app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const providers = await loadProvidersConfig(config.providersConfigPath);
  const app = await buildApp({ config, providers });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "arresto del proxy richiesto");
    await app.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { providerDiDefault: providers.default, sostanze: config.substancesDir },
    "synthetic substance engine pronto",
  );
}

main().catch((error: unknown) => {
  console.error("Avvio del proxy fallito:", error instanceof Error ? error.message : error);
  process.exit(1);
});
