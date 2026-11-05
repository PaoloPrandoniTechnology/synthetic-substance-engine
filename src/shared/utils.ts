/** Piccole funzioni condivise, senza stato. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
