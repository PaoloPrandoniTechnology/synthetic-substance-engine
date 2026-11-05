import { describe, expect, it } from "vitest";
import { jitterDelayMs, MAX_JITTER_DELAY_MS } from "../../src/distorters/streaming.js";

describe("jitterDelayMs", () => {
  it("non ritarda senza jitter", () => {
    expect(jitterDelayMs(0, 7, 0)).toBe(0);
    expect(jitterDelayMs(-1, 7, 0)).toBe(0);
  });

  it("resta dentro il tetto dichiarato", () => {
    for (let index = 0; index < 50; index += 1) {
      const delay = jitterDelayMs(1, 7, index);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(MAX_JITTER_DELAY_MS);
    }
  });

  it("è deterministico e varia con indice e seed", () => {
    expect(jitterDelayMs(0.5, 7, 3)).toBe(jitterDelayMs(0.5, 7, 3));

    const indices = Array.from({ length: 32 }, (_, index) => index);
    const series = (seed: number): number[] =>
      indices.map((index) => jitterDelayMs(1, seed, index));

    // il jitter è quantizzato in ms: la varietà si misura su una serie, non su un singolo valore
    expect(new Set(series(7)).size).toBeGreaterThan(8);
    expect(series(7)).not.toEqual(series(8));
  });

  it("cresce col jitter", () => {
    expect(jitterDelayMs(1, 7, 1)).toBeGreaterThanOrEqual(jitterDelayMs(0.2, 7, 1));
  });
});
