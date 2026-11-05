import { describe, expect, it } from "vitest";
import { parseSubstance } from "../../src/engine/substance.js";
import { buildTripReport, effectPhase } from "../../src/telemetry/trip-report.js";

const substance = parseSubstance(`
schema: 1
id: euforia-test
name: Euforia Test
family: stimolante
intensity: 0.7
onsetSeconds: 10
peakSeconds: 20
plateauSeconds: 180
decaySeconds: 200
distortions:
  params:
    temperature: 0.35
    presencePenalty: 0.4
    maxTemperature: 1.6
  context:
    fixation: 0.6
    fixationToken: "meraviglia"
  streaming:
    jitter: 0.5
`);

describe("effectPhase", () => {
  it("segue le fasi della curva", () => {
    expect(effectPhase(substance, 0)).toBe("latente");
    expect(effectPhase(substance, 20)).toBe("salita");
    expect(effectPhase(substance, 60)).toBe("plateau");
    expect(effectPhase(substance, 250)).toBe("svanimento");
    expect(effectPhase(substance, 500)).toBe("fine");
  });
});

describe("buildTripReport", () => {
  it("riassume fase, percentuale e distorsioni attive", () => {
    const report = buildTripReport(substance, 1, 60);

    expect(report.phase).toBe("plateau");
    expect(report.percent).toBe(70);
    expect(report.envelope).toBeCloseTo(0.7, 3);
    expect(report.applied.temperature).toBeCloseTo(0.245, 3);
    expect(report.applied.jitter).toBeCloseTo(0.35, 3);
    expect(report.summary).toContain("Euforia Test");
    expect(report.summary).toContain("70%");
    expect(report.summary).toContain("meraviglia");
  });

  it("riduce l'effetto con la dose", () => {
    const half = buildTripReport(substance, 0.5, 60);
    expect(half.percent).toBe(35);
  });

  it("dichiara la fine dell'effetto", () => {
    const report = buildTripReport(substance, 1, 900);

    expect(report.phase).toBe("fine");
    expect(report.percent).toBe(0);
    expect(report.summary).toContain("effetto esaurito");
  });
});
