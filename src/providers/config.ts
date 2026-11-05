import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ProviderSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["openai", "openai-compatible", "ollama"]),
  baseUrl: z.string().min(1),
  apiKeyEnv: z.string().min(1).optional(),
  models: z.array(z.string().min(1)).default([]),
});

const ProvidersFileSchema = z.object({
  version: z.literal(1),
  default: z.string().min(1),
  providers: z.array(ProviderSchema).min(1),
});

export type Provider = z.infer<typeof ProviderSchema>;
export type ProvidersConfig = z.infer<typeof ProvidersFileSchema>;

function invalidConfig(message: string): never {
  throw new Error(`config/providers.yaml non valido: ${message}`);
}

/**
 * Valida il testo YAML del catalogo provider: schema, id duplicati,
 * URL assoluti e esistenza del provider di default.
 */
export function parseProvidersConfig(raw: string): ProvidersConfig {
  let document: unknown;

  try {
    document = parseYaml(raw);
  } catch (error) {
    invalidConfig(`YAML non parsabile (${(error as Error).message})`);
  }

  const parsed = ProvidersFileSchema.safeParse(document);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    invalidConfig(details);
  }

  const config = parsed.data;
  const seen = new Set<string>();

  for (const provider of config.providers) {
    if (seen.has(provider.id)) {
      invalidConfig(`id provider duplicato "${provider.id}"`);
    }
    seen.add(provider.id);

    try {
      new URL(provider.baseUrl);
    } catch {
      invalidConfig(`baseUrl non valido per "${provider.id}": ${provider.baseUrl}`);
    }
  }

  if (!seen.has(config.default)) {
    invalidConfig(`provider di default "${config.default}" non presente nell'elenco`);
  }

  return config;
}

export async function loadProvidersConfig(path: string): Promise<ProvidersConfig> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(
      `Impossibile leggere il catalogo provider "${path}": ${(error as Error).message}`,
    );
  }

  return parseProvidersConfig(raw);
}
