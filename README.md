# Synthetic Substance Engine

Middleware proxy **OpenAI-compatibile** che si frappone tra client (web UI, giochi, app terze) e
provider LLM (Ollama, LM Studio, vLLM, OpenAI) per modulare i parametri di inferenza tramite
profili di "sostanze" sintetiche: curve di dose/effetto, rumore semantico sui logit e distorsione
di contesto e percezione.

> Il brief completo del progetto è in [`CLAUDE.md`](./CLAUDE.md).
> Architettura, stack e struttura cartelle: [`docs/ARCHITETTURA.md`](./docs/ARCHITETTURA.md).

## Stato

M1 — scaffolding del proxy: server Fastify, `/healthz`, `/v1/models` dal catalogo provider,
errori in formato OpenAI. Endpoint `/v1/chat/completions` e sostanze: milestone successive.

## Requisiti

- Node.js >= 24
- pnpm 10

## Avvio

```bash
pnpm install
cp .env.example .env   # opzionale: i default funzionano senza
pnpm dev               # http://127.0.0.1:8787
```

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/v1/models
```

## Comandi

| Comando                     | Effetto                                          |
| --------------------------- | ------------------------------------------------ |
| `pnpm dev`                  | server in watch mode (tsx)                       |
| `pnpm build` / `pnpm start` | build TypeScript in `dist/` ed esecuzione        |
| `pnpm test`                 | suite Vitest (`tests/unit`, `tests/integration`) |
| `pnpm typecheck`            | controllo tipi senza emit                        |
| `pnpm lint` / `pnpm format` | Biome                                            |

## Configurazione

- `config/providers.yaml` — catalogo upstream; l'`id` del modello esposto è `provider/modello`.
- `config/substances/` — profili sostanza in YAML (in arrivo con M3).
- Variabili d'ambiente: vedi `.env.example`.
