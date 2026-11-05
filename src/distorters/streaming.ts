import { hashNoise } from "./logit.js";

/** Ritardo massimo aggiunto a un singolo chunk quando il jitter vale 1. */
export const MAX_JITTER_DELAY_MS = 90;

/**
 * Ritardo deterministico in millisecondi per il chunk `index`.
 * Il valore è in `[0, jitter × MAX_JITTER_DELAY_MS]`: il jitter cambia il ritmo
 * dell'uscita, non la quantità di testo né la sua latenza complessiva in modo caotico.
 */
export function jitterDelayMs(jitter: number, seed: number, index: number): number {
  if (jitter <= 0) {
    return 0;
  }

  const clamped = Math.min(1, jitter);
  const noise = hashNoise(seed, index + 1);
  const normalized = (noise + 1) / 2;

  return Math.round(normalized * clamped * MAX_JITTER_DELAY_MS);
}
