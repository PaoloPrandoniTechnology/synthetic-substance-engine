import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  encodeText,
  isSupportedTokenizer,
  SUPPORTED_TOKENIZERS,
  type TokenizerName,
} from "./tokenizer.js";

const ZeroToOne = z.number().min(0).max(1);

const ParamsDistortionSchema = z.strictObject({
  temperature: z.number().min(-2).max(2).default(0),
  topP: z.number().min(-1).max(1).default(0),
  frequencyPenalty: z.number().min(-4).max(4).default(0),
  presencePenalty: z.number().min(-4).max(4).default(0),
  /** Tetto specifico della sostanza: non può mai superare il tetto globale del proxy. */
  maxTemperature: z.number().min(0).max(2).optional(),
});

const TokenBiasSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  bias: z.number().int().min(-100).max(100),
});

const LogitTokenSchema = z.strictObject({
  /** Parola o frase da spingere: viene compilata in token id dal tokenizer dichiarato. */
  text: z.string().min(1),
  bias: z.number().int().min(-100).max(100),
  /** "first" = solo il primo token, "all" = tutti i sub-token della parola. */
  target: z.enum(["first", "all"]).default("first"),
});

const LogitDistortionSchema = z.strictObject({
  mode: z.enum(["off", "token-noise", "associative-drift"]).default("off"),
  strength: ZeroToOne.default(0),
  maxBiasedTokens: z.number().int().min(1).max(1000).default(64),
  /** Tokenizer a cui si riferiscono token id e parole (valida il provider a runtime). */
  targetTokenizer: z.string().min(1).optional(),
  seed: z.number().int().nonnegative().default(1),
  tokenIds: z.array(TokenBiasSchema).default([]),
  tokens: z.array(LogitTokenSchema).default([]),
});

const ContextDistortionSchema = z.strictObject({
  amnesia: ZeroToOne.default(0),
  fixation: ZeroToOne.default(0),
  fixationToken: z.string().min(1).optional(),
  synesthesia: ZeroToOne.default(0),
});

const StreamingDistortionSchema = z.strictObject({
  jitter: ZeroToOne.default(0),
  /** Seed del jitter: stesso seed, stesso ritmo. */
  seed: z.number().int().nonnegative().default(1),
});

const SubstanceSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id in kebab-case"),
  name: z.string().min(1),
  family: z.enum(["stimolante", "dissociativo", "delirante", "sedativo"]),
  intensity: ZeroToOne,
  onsetSeconds: z.number().int().min(0),
  peakSeconds: z.number().int().min(0),
  plateauSeconds: z.number().int().min(0),
  decaySeconds: z.number().int().min(0),
  distortions: z.strictObject({
    params: ParamsDistortionSchema.optional(),
    logit: LogitDistortionSchema.optional(),
    context: ContextDistortionSchema.optional(),
    streaming: StreamingDistortionSchema.optional(),
  }),
  effects: z.array(z.string().min(1)).default([]),
  contraindications: z.array(z.string().min(1)).default([]),
});

export type Substance = z.infer<typeof SubstanceSchema>;
export type TokenBias = z.infer<typeof TokenBiasSchema>;

export type TokenResolver = (text: string, tokenizer: TokenizerName) => number[];

export interface ParseSubstanceOptions {
  /** Iniettabile nei test per non dipendere dal tokenizer reale. */
  resolveTokens?: TokenResolver;
}

export function substanceDuration(substance: Substance): number {
  return (
    substance.onsetSeconds +
    substance.peakSeconds +
    substance.plateauSeconds +
    substance.decaySeconds
  );
}

function compileTokens(
  tokens: readonly z.infer<typeof LogitTokenSchema>[],
  tokenizer: TokenizerName,
  resolve: TokenResolver,
  source: string,
): TokenBias[] {
  const compiled: TokenBias[] = [];

  for (const token of tokens) {
    const ids = resolve(token.text, tokenizer);

    if (ids.length === 0) {
      throw new Error(`${source}: "${token.text}" non produce alcun token`);
    }

    const first = ids[0];

    if (token.target === "all") {
      for (const id of ids) {
        compiled.push({ id, bias: token.bias });
      }
    } else if (first !== undefined) {
      compiled.push({ id: first, bias: token.bias });
    }
  }

  return compiled;
}

/** Un token id può arrivare da più regole: vince il bias con intensità maggiore. */
function mergeTokenIds(base: readonly TokenBias[], extra: readonly TokenBias[]): TokenBias[] {
  const merged = new Map<number, number>();

  for (const item of [...base, ...extra]) {
    const existing = merged.get(item.id);
    if (existing === undefined || Math.abs(item.bias) > Math.abs(existing)) {
      merged.set(item.id, item.bias);
    }
  }

  return [...merged.entries()].map(([id, bias]) => ({ id, bias }));
}

const defaultResolver: TokenResolver = (text, tokenizer) => encodeText(text, tokenizer);

/**
 * Valida un profilo sostanza (YAML) applicando anche le regole trasversali
 * che lo schema da solo non copre. Lancia un errore con il nome della sorgente.
 */
export function parseSubstance(
  raw: string,
  source = "sostanza",
  options: ParseSubstanceOptions = {},
): Substance {
  let document: unknown;

  try {
    document = parseYaml(raw);
  } catch (error) {
    throw new Error(`${source}: YAML non parsabile (${(error as Error).message})`);
  }

  const parsed = SubstanceSchema.safeParse(document);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${source}: profilo non valido → ${details}`);
  }

  const substance = parsed.data;

  if (substanceDuration(substance) === 0) {
    throw new Error(`${source}: la durata totale (onset+peak+plateau+decay) deve essere > 0`);
  }

  const params = substance.distortions.params;
  if (params && params.temperature > 0 && params.maxTemperature === undefined) {
    throw new Error(`${source}: maxTemperature obbligatorio quando temperature viene alzata`);
  }

  const context = substance.distortions.context;
  if (context && context.fixation > 0 && !context.fixationToken) {
    throw new Error(`${source}: fixationToken obbligatorio quando fixation > 0`);
  }

  const logit = substance.distortions.logit;

  if (!logit) {
    return substance;
  }

  if (logit.mode !== "off" && logit.tokenIds.length === 0 && logit.tokens.length === 0) {
    throw new Error(`${source}: modalità logit "${logit.mode}" richiede token id o parole`);
  }

  if (logit.tokens.length === 0) {
    return substance;
  }

  if (!logit.targetTokenizer) {
    throw new Error(`${source}: il campo logit.tokens richiede targetTokenizer`);
  }

  if (!isSupportedTokenizer(logit.targetTokenizer)) {
    throw new Error(
      `${source}: tokenizer non supportato "${logit.targetTokenizer}" (disponibili: ${SUPPORTED_TOKENIZERS.join(", ")})`,
    );
  }

  const resolver = options.resolveTokens ?? defaultResolver;
  const compiled = compileTokens(logit.tokens, logit.targetTokenizer, resolver, source);

  return {
    ...substance,
    distortions: {
      ...substance.distortions,
      logit: { ...logit, tokenIds: mergeTokenIds(logit.tokenIds, compiled) },
    },
  };
}
