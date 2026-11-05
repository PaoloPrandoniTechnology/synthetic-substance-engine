import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSubstances } from "../../src/engine/registry.js";
import { parseSubstance, substanceDuration } from "../../src/engine/substance.js";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempSubstanceDir(fileName: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "substances-"));
  temporaryDirs.push(dir);
  await writeFile(join(dir, fileName), content, "utf8");
  return dir;
}

const validProfile = `
schema: 1
id: prova
name: Prova
family: stimolante
intensity: 0.5
onsetSeconds: 0
peakSeconds: 10
plateauSeconds: 20
decaySeconds: 30
distortions:
  params:
    temperature: 0.2
    maxTemperature: 1.5
effects:
  - "effetto di prova"
`;

describe("parseSubstance", () => {
  it("accetta un profilo valido e calcola la durata", () => {
    const substance = parseSubstance(validProfile);

    expect(substance.id).toBe("prova");
    expect(substanceDuration(substance)).toBe(60);
    expect(substance.contraindications).toEqual([]);
  });

  it("rifiuta un id non kebab-case", () => {
    expect(() => parseSubstance(validProfile.replace("id: prova", "id: Prova"))).toThrow(
      /kebab-case/,
    );
  });

  it("rifiuta campi sconosciuti", () => {
    expect(() => parseSubstance(`${validProfile}\nsconosciuto: 1\n`)).toThrow(/profilo non valido/);
  });

  it("rifiuta una durata totale nulla", () => {
    const yaml = validProfile
      .replace("peakSeconds: 10", "peakSeconds: 0")
      .replace("plateauSeconds: 20", "plateauSeconds: 0")
      .replace("decaySeconds: 30", "decaySeconds: 0");

    expect(() => parseSubstance(yaml)).toThrow(/durata totale/);
  });

  it("richiede maxTemperature quando la temperature viene alzata", () => {
    const yaml = validProfile.replace("    maxTemperature: 1.5\n", "");
    expect(() => parseSubstance(yaml)).toThrow(/maxTemperature/);
  });

  it("richiede fixationToken quando fixation > 0", () => {
    const yaml = `
schema: 1
id: prova
name: Prova
family: delirante
intensity: 1
onsetSeconds: 0
peakSeconds: 1
plateauSeconds: 1
decaySeconds: 1
distortions:
  context:
    fixation: 0.5
`;
    expect(() => parseSubstance(yaml)).toThrow(/fixationToken/);
  });

  it("richiede token id o parole quando la modalità logit è attiva", () => {
    const yaml = `
schema: 1
id: prova
name: Prova
family: delirante
intensity: 1
onsetSeconds: 0
peakSeconds: 1
plateauSeconds: 1
decaySeconds: 1
distortions:
  logit:
    mode: token-noise
    strength: 0.5
`;
    expect(() => parseSubstance(yaml)).toThrow(/richiede token id o parole/);
  });
});

describe("loadSubstances", () => {
  it("carica i profili della cartella fixture", async () => {
    const registry = await loadSubstances("tests/fixtures/substances");

    expect(registry.size).toBe(1);
    expect(registry.has("test-lite")).toBe(true);
    expect(registry.get("test-lite")?.name).toBe("Test Lite");
  });

  it("carica solo i file yaml e ordina il catalogo", async () => {
    const dir = await tempSubstanceDir("prova.yaml", validProfile);
    await writeFile(join(dir, "note.txt"), "ignorami", "utf8");

    const registry = await loadSubstances(dir);
    expect(registry.list().map((substance) => substance.id)).toEqual(["prova"]);
  });

  it("rifiuta un id diverso dal nome del file", async () => {
    const dir = await tempSubstanceDir("altro.yaml", validProfile);
    await expect(loadSubstances(dir)).rejects.toThrow(/diverso dal nome file/);
  });

  it("fallisce su una cartella inesistente", async () => {
    await expect(loadSubstances("cartella/che/non/esiste")).rejects.toThrow(/Impossibile leggere/);
  });
});
