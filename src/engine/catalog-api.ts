import { parseSubstance, type Substance, substanceDuration } from "./substance.js";

/** Riassunto del profilo per la UI e per chi crea sostanze via API. */
export function summarizeSubstance(substance: Substance) {
  const logit = substance.distortions.logit;

  return {
    id: substance.id,
    object: "substance",
    name: substance.name,
    family: substance.family,
    intensity: substance.intensity,
    durationSeconds: substanceDuration(substance),
    phases: {
      onsetSeconds: substance.onsetSeconds,
      peakSeconds: substance.peakSeconds,
      plateauSeconds: substance.plateauSeconds,
      decaySeconds: substance.decaySeconds,
    },
    logit: logit
      ? {
          mode: logit.mode,
          strength: logit.strength,
          targetTokenizer: logit.targetTokenizer ?? null,
          biasedTokens: logit.tokenIds.length,
        }
      : null,
    effects: substance.effects,
    contraindications: substance.contraindications,
  };
}

export type ValidationResult = { ok: true; substance: Substance } | { ok: false; errors: string[] };

/**
 * Valida con lo stesso loader usato all'avvio: schema, regole trasversali e
 * compilazione dei token logit. Non scrive nulla su disco.
 */
export function validateProfile(yaml: string): ValidationResult {
  try {
    return { ok: true, substance: parseSubstance(yaml, "profilo") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errors = message
      .replace(/^profilo:\s*/, "")
      .replace(/^profilo non valido →\s*/, "")
      .split("; ")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return { ok: false, errors: errors.length > 0 ? errors : [message] };
  }
}
