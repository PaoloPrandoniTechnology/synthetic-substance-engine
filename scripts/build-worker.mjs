/**
 * Prepara il pacchetto della demo online per la pubblicazione: Wrangler compila il
 * Worker (TypeScript + profili YAML come testo) e accanto finisce il manifest dei moduli.
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "dist", "worker");

rmSync(outDir, { recursive: true, force: true });

execSync(`npx wrangler deploy --dry-run --outdir "${outDir}"`, { cwd: root, stdio: "inherit" });

cpSync(join(root, "public"), join(outDir, "assets"), { recursive: true });

// Il deploy accetta moduli di testo solo con estensione nota: i profili compilati
// come `.yaml` diventano `.txt`, e il bundle impara il nuovo nome.
const renamed = new Map();

for (const name of readdirSync(outDir).filter((entry) => entry.endsWith(".yaml"))) {
  const target = name.replace(/\.yaml$/, ".txt");
  renameSync(join(outDir, name), join(outDir, target));
  renamed.set(name, target);
}

for (const name of readdirSync(outDir)) {
  const path = join(outDir, name);

  if (!/\.(js|txt)$/.test(name) || statSync(path).isDirectory()) {
    continue;
  }

  let text = readFileSync(path, "utf8");
  let changed = false;

  for (const [from, to] of renamed) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(path, text, "utf8");
  }
}

function moduleType(name) {
  if (name.endsWith(".wasm")) return "wasm";
  if (name.endsWith(".txt")) return "text";
  return "esm";
}

const modules = readdirSync(outDir)
  .filter((name) => {
    const path = join(outDir, name);
    return statSync(path).isFile() && /\.(js|wasm|txt)$/.test(name);
  })
  .sort()
  .map((name) => ({ name, type: moduleType(name), path: `./${name}` }));

if (!modules.some((module) => module.name === "index.js")) {
  throw new Error("Wrangler non ha prodotto index.js: build del Worker fallita");
}

const manifest = {
  entrypoint: "index.js",
  compatibilityDate: "2026-11-01",
  modules,
  assetsDirectory: "./assets",
};

writeFileSync(join(outDir, "sites.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const totalBytes = modules.reduce(
  (sum, module) => sum + statSync(join(outDir, module.name)).size,
  0,
);
console.log(
  `manifest: ${join(outDir, "sites.json")} (${modules.length} moduli, ${totalBytes} byte)`,
);
