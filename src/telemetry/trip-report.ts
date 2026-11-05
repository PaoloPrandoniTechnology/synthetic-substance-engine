import { computeFactors, type Factors } from "../engine/metabolism.js";
import type { Substance } from "../engine/substance.js";
import { round } from "../shared/utils.js";

export type EffectPhase = "latente" | "salita" | "plateau" | "svanimento" | "fine";

export function effectPhase(substance: Substance, elapsedSeconds: number): EffectPhase {
  const elapsed = Math.max(0, elapsedSeconds);
  const peakEnd = substance.onsetSeconds + substance.peakSeconds;
  const plateauEnd = peakEnd + substance.plateauSeconds;
  const totalEnd = plateauEnd + substance.decaySeconds;

  if (elapsed < substance.onsetSeconds) {
    return "latente";
  }
  if (elapsed < peakEnd) {
    return "salita";
  }
  if (elapsed < plateauEnd) {
    return "plateau";
  }
  if (elapsed < totalEnd) {
    return "svanimento";
  }
  return "fine";
}

export interface TripReport {
  substanceId: string;
  substanceName: string;
  family: string;
  dose: number;
  elapsedSeconds: number;
  phase: EffectPhase;
  envelope: number;
  percent: number;
  applied: {
    temperature: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    amnesia: number;
    fixation: number;
    synesthesia: number;
    logitMode: string;
    logitStrength: number;
    jitter: number;
  };
  summary: string;
}

function describeApplied(substance: Substance, factors: Factors): string[] {
  const parts: string[] = [];
  const { params, context } = factors;

  if (params.temperature !== 0) {
    parts.push(`temperatura ${params.temperature > 0 ? "+" : ""}${round(params.temperature, 2)}`);
  }
  if (params.topP !== 0) {
    parts.push(`top_p ${params.topP > 0 ? "+" : ""}${round(params.topP, 2)}`);
  }
  if (params.presencePenalty !== 0) {
    parts.push(`presence ${round(params.presencePenalty, 2)}`);
  }
  if (params.frequencyPenalty !== 0) {
    parts.push(`frequency ${round(params.frequencyPenalty, 2)}`);
  }
  if (context.amnesia > 0.01) {
    parts.push(`amnesia ${Math.round(context.amnesia * 100)}%`);
  }
  if (context.fixation >= 0.25) {
    const token = substance.distortions.context?.fixationToken;
    parts.push(`fissazione ${Math.round(context.fixation * 100)}%${token ? ` su «${token}»` : ""}`);
  }
  if (context.synesthesia >= 0.25) {
    parts.push(`sinestesia ${Math.round(context.synesthesia * 100)}%`);
  }
  if (factors.logit.mode !== "off" && factors.logit.strength > 0) {
    const tokens = substance.distortions.logit?.tokenIds.length ?? 0;
    parts.push(`${factors.logit.mode} ×${tokens} token (${round(factors.logit.strength, 2)})`);
  }
  if (factors.streaming.jitter > 0) {
    parts.push(`jitter ritmico ${round(factors.streaming.jitter, 2)}`);
  }

  return parts;
}

/**
 * Referto leggibile di una somministrazione: fase della curva, percentuale di effetto
 * e distorsioni concrete, in una frase che si può mostrare a un utente.
 */
export function buildTripReport(
  substance: Substance,
  dose: number,
  elapsedSeconds: number,
): TripReport {
  const factors = computeFactors(substance, dose, elapsedSeconds);
  const phase = effectPhase(substance, elapsedSeconds);
  const parts = describeApplied(substance, factors);
  const percent = Math.round(factors.envelope * 100);
  const doseLabel = `dose ${round(dose, 2)}`;
  const timeLabel = `${Math.round(elapsedSeconds)}s dall'inizio`;

  const summary =
    phase === "fine"
      ? `${substance.name}: effetto esaurito (${timeLabel}).`
      : `${substance.name} — ${phase} (${percent}%) · ${doseLabel} · ${timeLabel}: ${
          parts.length > 0 ? parts.join(", ") : "nessuna alterazione attiva"
        }.`;

  return {
    substanceId: substance.id,
    substanceName: substance.name,
    family: substance.family,
    dose,
    elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
    phase,
    envelope: round(factors.envelope, 3),
    percent,
    applied: {
      temperature: round(factors.params.temperature, 3),
      topP: round(factors.params.topP, 3),
      frequencyPenalty: round(factors.params.frequencyPenalty, 3),
      presencePenalty: round(factors.params.presencePenalty, 3),
      amnesia: round(factors.context.amnesia, 3),
      fixation: round(factors.context.fixation, 3),
      synesthesia: round(factors.context.synesthesia, 3),
      logitMode: factors.logit.mode,
      logitStrength: round(factors.logit.strength, 3),
      jitter: round(factors.streaming.jitter, 3),
    },
    summary,
  };
}
