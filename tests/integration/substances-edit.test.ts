import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { loadSubstances } from "../../src/engine/registry.js";
import { parseProvidersConfig } from "../../src/providers/config.js";
import { buildApp } from "../../src/server/app.js";

const providers = parseProvidersConfig(`
version: 1
default: finta
providers:
  - id: finta
    kind: ollama
    baseUrl: http://127.0.0.1:11434
    models:
      - modello
`);

const profile = `schema: 1
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

const newProfile = profile.replace("id: prova", "id: nuova").replace("name: Prova", "name: Nuova");

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "substances-edit-"));
  await writeFile(join(dir, "prova.yaml"), profile, "utf8");

  const registry = await loadSubstances(dir);
  app = await buildApp({
    config: loadConfig({ SUBSTANCES_DIR: dir }),
    providers,
    registry,
    logger: false,
  });
});

afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("catalogo modificabile", () => {
  it("restituisce il profilo YAML di una sostanza", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/substances/prova/source" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/yaml");
    expect(response.body).toContain("id: prova");
  });

  it("risponde 404 sul profilo di una sostanza sconosciuta", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/substances/inesistente/source" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("substance_not_found");
  });

  it("valida un profilo senza scrivere nulla", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/substances/validate",
      payload: { yaml: newProfile },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      substance: {
        id: "nuova",
        name: "Nuova",
        durationSeconds: 60,
        phases: { onsetSeconds: 0, peakSeconds: 10, plateauSeconds: 20, decaySeconds: 30 },
      },
    });
    expect(await readdir(dir)).toEqual(["prova.yaml"]);
  });

  it("elenca gli errori di un profilo non valido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/substances/validate",
      payload: { yaml: "schema: 1\nid: NonValido\n" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; errors: string[] };
    expect(body.ok).toBe(false);
    expect(body.errors.join(" ")).toMatch(/kebab-case/);
  });

  it("salva una nuova sostanza e la rende subito attiva", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/substances/nuova",
      payload: { yaml: newProfile },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ ok: true, created: true, substance: { id: "nuova" } });
    expect(await readFile(join(dir, "nuova.yaml"), "utf8")).toContain("id: nuova");

    const catalog = await app.inject({ method: "GET", url: "/v1/substances" });
    expect(catalog.json().data.map((item: { id: string }) => item.id)).toContain("nuova");

    const report = await app.inject({
      method: "GET",
      url: "/v1/substances/nuova/trip-report?elapsed=20",
    });
    expect(report.statusCode).toBe(200);
  });

  it("aggiorna una sostanza esistente", async () => {
    const updated = profile.replace("name: Prova", "name: Prova Rinominata");
    const response = await app.inject({
      method: "PUT",
      url: "/v1/substances/prova",
      payload: { yaml: updated },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, created: false });

    const catalog = await app.inject({ method: "GET", url: "/v1/substances" });
    expect(catalog.json().data[0].name).toBe("Prova Rinominata");
  });

  it("rifiuta un profilo il cui id non coincide con il percorso", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/substances/altro",
      payload: { yaml: newProfile },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("id_mismatch");
    expect(await readdir(dir)).toEqual(["prova.yaml"]);
  });

  it("rifiuta un salvataggio non valido senza toccare il file", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/substances/prova",
      payload: { yaml: "schema: 1\nid: prova\n" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_substance");
    expect(await readFile(join(dir, "prova.yaml"), "utf8")).toBe(profile);
  });

  it("elimina una sostanza dal catalogo e dal disco", async () => {
    const response = await app.inject({ method: "DELETE", url: "/v1/substances/prova" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, id: "prova" });
    expect(await readdir(dir)).toEqual([]);

    const again = await app.inject({ method: "DELETE", url: "/v1/substances/prova" });
    expect(again.statusCode).toBe(404);
  });
});
