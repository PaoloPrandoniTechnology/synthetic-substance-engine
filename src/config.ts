import { z } from "zod";

const LogLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const EnvSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: LogLevelSchema.default("info"),
  PROVIDERS_CONFIG_PATH: z.string().min(1).default("config/providers.yaml"),
  SUBSTANCES_DIR: z.string().min(1).default("config/substances"),
  /** Tetto globale di temperature: nessuna sostanza può superarlo. */
  MAX_TEMPERATURE: z.coerce.number().min(0).max(2).default(1.6),
  /** Numero massimo di voci logit_bias inviate all'upstream. */
  MAX_BIASED_TOKENS: z.coerce.number().int().min(1).max(1000).default(64),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;

export interface AppConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  providersConfigPath: string;
  substancesDir: string;
  maxTemperature: number;
  maxBiasedTokens: number;
}

/**
 * Legge e valida la configurazione da variabili d'ambiente.
 * Fallisce subito (fail-fast) con un messaggio leggibile se una variabile non è valida.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configurazione ambiente non valida: ${details}`);
  }

  return {
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    providersConfigPath: parsed.data.PROVIDERS_CONFIG_PATH,
    substancesDir: parsed.data.SUBSTANCES_DIR,
    maxTemperature: parsed.data.MAX_TEMPERATURE,
    maxBiasedTokens: parsed.data.MAX_BIASED_TOKENS,
  };
}
