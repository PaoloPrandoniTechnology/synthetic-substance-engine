import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSubstance, type Substance } from "./substance.js";

/** Catalogo immutabile dei profili sostanza caricati all'avvio. */
export class SubstanceRegistry {
  private readonly byId = new Map<string, Substance>();

  constructor(substances: readonly Substance[] = []) {
    for (const substance of substances) {
      this.byId.set(substance.id, substance);
    }
  }

  get(id: string): Substance | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(): Substance[] {
    return [...this.byId.values()];
  }

  /** Aggiunge o sostituisce un profilo: il catalogo si aggiorna senza riavviare il proxy. */
  upsert(substance: Substance): void {
    this.byId.set(substance.id, substance);
  }

  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  get size(): number {
    return this.byId.size;
  }
}

/**
 * Carica tutti i profili `*.yaml` / `*.yml` della cartella.
 * L'id del profilo deve coincidere con il nome del file: evita cataloghi ambigui.
 */
export async function loadSubstances(directory: string): Promise<SubstanceRegistry> {
  let entries: string[];

  try {
    entries = await readdir(directory);
  } catch (error) {
    throw new Error(
      `Impossibile leggere la cartella sostanze "${directory}": ${(error as Error).message}`,
    );
  }

  const files = entries.filter((name) => name.endsWith(".yaml") || name.endsWith(".yml")).sort();
  const substances: Substance[] = [];
  const ids = new Set<string>();

  for (const file of files) {
    const source = `${directory}/${file}`;
    const expectedId = file.replace(/\.ya?ml$/, "");
    const substance = parseSubstance(await readFile(join(directory, file), "utf8"), source);

    if (substance.id !== expectedId) {
      throw new Error(`${source}: id "${substance.id}" diverso dal nome file "${expectedId}"`);
    }

    if (ids.has(substance.id)) {
      throw new Error(`${source}: id sostanza duplicato "${substance.id}"`);
    }

    ids.add(substance.id);
    substances.push(substance);
  }

  return new SubstanceRegistry(substances);
}
