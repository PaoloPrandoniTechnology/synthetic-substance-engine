# Synthetic Substance Engine

Middleware proxy **OpenAI-compatibile** che si frappone tra client (web UI, giochi, app terze) e
provider LLM (Ollama, LM Studio, vLLM, OpenAI) per modulare i parametri di inferenza tramite
profili di "sostanze" sintetiche: curve di dose/effetto, rumore semantico sui logit e distorsione
di contesto e percezione.

> Il brief completo del progetto è in [`CLAUDE.md`](./CLAUDE.md).
> Architettura, stack e struttura cartelle: [`docs/ARCHITETTURA.md`](./docs/ARCHITETTURA.md).

## Stato

M3 — proxy funzionante: `/v1/chat/completions` (streaming SSE in pass-through), motore sostanze
con curva dose/tempo, distorsori `params`, `context` e `logit`, catalogo `/v1/substances` con
5 profili in `config/substances/`. Dettaglio di endpoint e header in [`docs/API.md`](./docs/API.md).

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
curl http://127.0.0.1:8787/v1/substances
```

Una richiesta chat con sostanza attiva (Ollama deve essere in ascolto su `127.0.0.1:11434`):

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -H "x-substance-id: euforia-creativa" \
  -H "x-dose: 0.8" \
  -H "x-substance-elapsed: 60" \
  -d '{"model":"ollama-local/llama3.1:8b","messages":[{"role":"user","content":"Un titolo per un racconto"}]}'
```

Senza header `x-substance-id` il proxy inoltra la richiesta invariata.

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
- `config/substances/` — un file YAML per sostanza; standard in
  [`docs/skills/01-substance-authoring.md`](./docs/skills/01-substance-authoring.md).
- Variabili d'ambiente: vedi `.env.example` (`MAX_TEMPERATURE`, `MAX_BIASED_TOKENS` sono i tetti globali).
