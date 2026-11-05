import { clamp01 } from "../shared/utils.js";
import type { Substance } from "./substance.js";

export interface ParamFactors {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

export interface ContextFactors {
  amnesia: number;
  fixation: number;
  synesthesia: number;
}

export interface LogitFactors {
  mode: "off" | "token-noise" | "associative-drift";
  strength: number;
}

export interface StreamFactors {
  jitter: number;
}

export interface Factors {
  /** Inviluppo 0..1: curva temporale × dose × intensità della sostanza. */
  envelope: number;
  params: ParamFactors;
  context: ContextFactors;
  logit: LogitFactors;
  streaming: StreamFactors;
}

/**
 * Curva di metabolizzazione, pura e deterministica:
 *
 * ```
 * 0 ──[onset: latenza]──▶ salita (peakSeconds) ──▶ plateau ──▶ svanimento (decaySeconds) ──▶ 0
 * ```
 *
 * `onsetSeconds` è il ritardo prima che l'effetto compaia, `peakSeconds` il tempo
 * per raggiungere l'intensità massima, `plateauSeconds` la tenuta, `decaySeconds` la coda.
 */
export function envelopeAt(substance: Substance, dose: number, elapsedSeconds: number): number {
  const doseClamped = clamp01(dose);
  if (doseClamped <= 0) {
    return 0;
  }

  const elapsed = Math.max(0, elapsedSeconds);
  const onsetEnd = substance.onsetSeconds;
  const peakEnd = onsetEnd + substance.peakSeconds;
  const plateauEnd = peakEnd + substance.plateauSeconds;
  const totalEnd = plateauEnd + substance.decaySeconds;

  let curve: number;

  if (elapsed < onsetEnd) {
    curve = 0;
  } else if (elapsed < peakEnd) {
    curve = substance.peakSeconds === 0 ? 1 : (elapsed - onsetEnd) / substance.peakSeconds;
  } else if (elapsed < plateauEnd) {
    curve = 1;
  } else if (elapsed < totalEnd) {
    curve = substance.decaySeconds === 0 ? 0 : 1 - (elapsed - plateauEnd) / substance.decaySeconds;
  } else {
    curve = 0;
  }

  return clamp01(curve * doseClamped * substance.intensity);
}

/** Converte l'inviluppo corrente nei fattori concreti applicati dai distorsori. */
export function computeFactors(
  substance: Substance,
  dose: number,
  elapsedSeconds: number,
): Factors {
  const envelope = envelopeAt(substance, dose, elapsedSeconds);
  const params = substance.distortions.params;
  const context = substance.distortions.context;
  const logit = substance.distortions.logit;
  const streaming = substance.distortions.streaming;

  return {
    envelope,
    params: {
      temperature: (params?.temperature ?? 0) * envelope,
      topP: (params?.topP ?? 0) * envelope,
      frequencyPenalty: (params?.frequencyPenalty ?? 0) * envelope,
      presencePenalty: (params?.presencePenalty ?? 0) * envelope,
    },
    context: {
      amnesia: (context?.amnesia ?? 0) * envelope,
      fixation: (context?.fixation ?? 0) * envelope,
      synesthesia: (context?.synesthesia ?? 0) * envelope,
    },
    logit: {
      mode: logit?.mode ?? "off",
      strength: (logit?.strength ?? 0) * envelope,
    },
    streaming: {
      jitter: (streaming?.jitter ?? 0) * envelope,
    },
  };
}
