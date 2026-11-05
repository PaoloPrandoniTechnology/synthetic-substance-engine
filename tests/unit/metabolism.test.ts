import { describe, expect, it } from "vitest";
import { computeFactors, envelopeAt } from "../../src/engine/metabolism.js";
import { parseSubstance } from "../../src/engine/substance.js";

const substance = parseSubstance(`
schema: 1
id: curva-test
name: Curva Test
family: stimolante
intensity: 1
onsetSeconds: 10
peakSeconds: 20
plateauSeconds: 30
decaySeconds: 40
distortions:
  params:
    temperature: 0.5
    maxTemperature: 1.6
  context:
    amnesia: 0.4
    fixation: 0.6
    fixationToken: "soglia"
`);

describe("envelopeAt", () => {
  it("segue latenza, salita, plateau e svanimento", () => {
    expect(envelopeAt(substance, 1, 0)).toBe(0);
    expect(envelopeAt(substance, 1, 10)).toBe(0);
    expect(envelopeAt(substance, 1, 20)).toBeCloseTo(0.5, 5);
    expect(envelopeAt(substance, 1, 30)).toBeCloseTo(1, 5);
    expect(envelopeAt(substance, 1, 50)).toBeCloseTo(1, 5);
    expect(envelopeAt(substance, 1, 80)).toBeCloseTo(0.5, 5);
    expect(envelopeAt(substance, 1, 100)).toBe(0);
    expect(envelopeAt(substance, 1, 500)).toBe(0);
  });

  it("scala con dose e intensità", () => {
    expect(envelopeAt(substance, 0.5, 30)).toBeCloseTo(0.5, 5);
    expect(envelopeAt(substance, 0, 30)).toBe(0);
    expect(envelopeAt({ ...substance, intensity: 0.4 }, 1, 30)).toBeCloseTo(0.4, 5);
    expect(envelopeAt(substance, 1, -5)).toBe(0);
  });

  it("non supera mai 1 anche con dose fuori scala", () => {
    expect(envelopeAt(substance, 3, 30)).toBe(1);
  });
});

describe("computeFactors", () => {
  it("moltiplica i valori del profilo per l'inviluppo", () => {
    const peak = computeFactors(substance, 1, 30);
    expect(peak.envelope).toBe(1);
    expect(peak.params.temperature).toBeCloseTo(0.5, 5);
    expect(peak.context.fixation).toBeCloseTo(0.6, 5);

    const half = computeFactors(substance, 1, 20);
    expect(half.envelope).toBeCloseTo(0.5, 5);
    expect(half.params.temperature).toBeCloseTo(0.25, 5);
  });

  it("azzera tutto fuori dalla finestra di effetto", () => {
    const expired = computeFactors(substance, 1, 1_000);
    expect(expired.envelope).toBe(0);
    expect(expired.params.temperature).toBe(0);
    expect(expired.logit.strength).toBe(0);
  });
});
