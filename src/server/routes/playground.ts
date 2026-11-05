import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

/** `public/` sta sempre tre livelli sopra il modulo, sia in `src/` sia in `dist/`. */
const HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/index.html");

/**
 * Playground: un'unica pagina statica che chiama le API del proxy sulla stessa
 * origine. Nessun bundler, nessuna dipendenza: si apre e funziona.
 */
export function registerPlaygroundRoutes(app: FastifyInstance): void {
  let cached: string | undefined;

  app.get("/", async (_request, reply) => reply.redirect("/playground"));

  app.get("/playground", async (_request, reply) => {
    cached ??= await readFile(HTML_PATH, "utf8");

    return reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(cached);
  });
}
