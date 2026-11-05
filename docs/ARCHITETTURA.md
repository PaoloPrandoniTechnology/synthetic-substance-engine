# Architettura — Synthetic Substance Engine (Creative Hallucination Proxy)

> Stato: **PROPOSTA** (da confermare prima dello scaffolding del codice).
> Autore: lead architect. Riferimento di progetto: `CLAUDE.md`.

---

## 1. Vincoli che guidano la scelta dello stack

Dal brief (`CLAUDE.md`, sezione *Scopo e architettura*):

| Requisito | Implicazione tecnica |
|---|---|
| Proxy OpenAI-compatible ad alte prestazioni | HTTP server con overhead minimo, keep-alive, **pass-through SSE in streaming** senza buffering |
| Modulazione parametrica nel tempo (onset → picco → svanimento) | Motore di stato per sessione, calcolo deterministico delle curve a ogni richiesta |
| Logit / semantic noise | Manipolazione di `logit_bias`, `temperature`, `top_p`, penalties; tokenizzazione per mappare token→id |
| Context & perception distorter | Riscrittura prompt e history (amnesia, fissazioni, sinestesia) prima dell'invio all'upstream |
| Client eterogenei (web UI, videogiochi, app terze) | Protocollo standard HTTP/JSON + SSE: nessuna dipendenza da runtime specifico |
| Sostanze come "contenuto" dichiarativo | Profili in **YAML** validati con schema, estendibili senza toccare il codice |
| Uso creativo (artisti, scrittori, game designer) | Playground web in fase 2, profili esportabili, "trip report" leggibile |

Vincoli pratici dell'ambiente verificati:

- Windows 11, Git 2.56, **Node 24.20**, **pnpm 10.26** → disponibili.
- Python 3.12.3 (Anaconda) disponibile.
- Bun e GitHub CLI **non** installati.

---

## 2. Stack raccomandato — TypeScript su Node 24 + Fastify 5

| Livello | Scelta | Perché |
|---|---|---|
| Runtime | **Node.js 24 LTS** | `fetch`/undici nativo con streaming Web API, HTTP/2, stabile su Windows |
| Linguaggio | **TypeScript 5.x, `strict`** | Il contratto OpenAI (request/response/SSE chunk) è tipizzabile: errori di forma intercettati a compile-time |
| HTTP server | **Fastify 5** | ~2–3× il throughput di Express, schema validation integrata, plugin di lifecycle ideali per la catena di distorsione |
| Streaming | `undici` + `ReadableStream` nativi, `reply.raw` pipe | Zero buffering: ogni chunk SSE viene alterato e inoltrato subito (latenza per-token ~costante) |
| Validazione | **Zod** (request, profili sostanza, config provider) | Unica fonte di verità per schema + tipi; messaggi d'errore compatibili con il formato `{"error": {...}}` OpenAI |
| Profili sostanze | **YAML** (`yaml`) + schema Zod | Editing creativo senza ricompilare; diff leggibili in Git; validazione all'avvio/`/admin` |
| Config runtime | `dotenv` + `.env.example` | Nessun segreto nel repo |
| Logging/telemetria | **pino** (+ `pino-pretty` in dev) | Log JSON strutturati, latenza per fase, correlation id per sessione |
| Test | **Vitest** + `fastify.inject()` + mock SSE upstream | Test rapidi sul proxy senza rete; snapshot dei payload alterati |
| Qualità | **Biome** (lint + format, un solo tool) | Un binario, zero conflitti Prettier/ESLint, ~50 ms |
| Package manager | **pnpm workspaces** | Repo pronto ad accogliere `apps/web` (fase 2) e `packages/sdk` senza migrazioni |
| Tokenizzazione (opz.) | `tiktoken` (tokenizer OpenAI) / `@huggingface/transformers` | Necessaria per costruire `logit_bias` per token e misurare "distanza semantica" |
| Fase 2 UI | **React 19 + Vite + TanStack Query** | Playground sostanze, grafici delle curve, streaming visibile |

### Perché non le alternative

- **Python 3.12 + FastAPI** — eccellente per ML (numpy, tokenizers HF, transformers) ma: streaming SSE e concorrenza I/O pesante richiedono attenzione (uvloop/anyio), l'ecosistema web/game client è JS, e per la UI servirebbe comunque un secondo processo TypeScript. Resta la scelta migliore **solo** se il progetto virerà su manipolazione logit *vera* in-process (motori locali, PyTorch).
- **Rust + Axum** — massime prestazioni e latenza minima, ma tempi di iterazione e costo di sviluppo molto alti per una piattaforma ancora in esplorazione creativa.
- **Go + chi** — ottimo proxy, ma tipi/schema dei payload OpenAI e la futura UI rendono il ciclo più lento.

### Compromesso consigliato (ibrido, opzionale in fase 3)

Il core proxy resta **TypeScript**; se servirà manipolazione logit nativa su modelli locali, si aggiunge un micro-servizio Python ("**Logit Lab**", `uv`/FastAPI) chiamato solo per quel livello. L'interfaccia `distorters/logit.ts` è già pensata come adapter, quindi l'aggiunta non impatta il resto.

---

## 3. Struttura delle cartelle

```
SW- Droga AI/
├── CLAUDE.md                     # brief di progetto (fonte di verità)
├── README.md
├── .gitignore
├── .env.example                  # variabili documentate, nessun segreto
├── package.json                  # workspace root + script (dev, build, test, lint)
├── pnpm-workspace.yaml
├── tsconfig.json
├── biome.json
├── vitest.config.ts
│
├── docs/
│   ├── ARCHITETTURA.md           # questo documento
│   ├── PROTOCOLLO-SOSTANZE.md    # schema di un profilo sostanza (versione, campi, esempi)
│   ├── API.md                    # endpoint proxy + estensioni (header di dosing)
│   └── skills/
│       └── 01-substance-authoring.md   # skill interna: come si scrive una sostanza
│
├── config/
│   ├── providers.yaml            # upstream: openai, ollama, lmstudio, vllm
│   └── substances/               # una sostanza = un file YAML
│       ├── sinestesia-concettuale.yaml
│       ├── euforia-creativa.yaml
│       ├── amnesia-anterograda.yaml
│       ├── fissazione-paranoica.yaml
│       └── allucinazione-controllata.yaml
│
├── src/
│   ├── index.ts                  # bootstrap: config → registry → server
│   │
│   ├── server/
│   │   ├── app.ts                # istanza Fastify, plugin, error handler OpenAI-shaped
│   │   ├── routes/
│   │   │   ├── chat-completions.ts   # POST /v1/chat/completions (stream e non-stream)
│   │   │   ├── models.ts             # GET /v1/models
│   │   │   ├── substances.ts         # GET /v1/substances (catalogo, fasi, effetti)
│   │   │   └── health.ts             # GET /healthz, GET /readyz
│   │   └── middleware/
│   │       ├── auth.ts               # API key del proxy (non dell'upstream)
│   │       ├── dosing.ts             # estrae dose/sostanza da header o body esteso
│   │       └── errors.ts             # formato errore compatibile OpenAI
│   │
│   ├── engine/
│   │   ├── substance.ts              # tipo Substance + schema Zod (versione, curve, distorsioni)
│   │   ├── metabolism.ts             # curve dose→tempo: onset, peak, plateau, decay, tolleranza
│   │   ├── session.ts                # stato per sessione (id, dose attiva, storico, redosing)
│   │   └── registry.ts               # caricamento/validazione YAML, hot reload in dev
│   │
│   ├── distorters/
│   │   ├── params.ts                 # temperature, top_p, frequency/presence_penalty
│   │   ├── logit.ts                  # logit_bias: rumore semantico, spinte associative
│   │   ├── context.ts                # riscrittura prompt/history: amnesia, fissazione, sinestesia
│   │   └── streaming.ts              # alterazione incrementale dei chunk in uscita
│   │
│   ├── providers/
│   │   ├── base.ts                   # interfaccia Provider + stream normalizzato
│   │   ├── openai.ts                 # OpenAI e compatibili (vLLM, Together, ...)
│   │   ├── ollama.ts                 # /api/chat
│   │   └── lmstudio.ts               # endpoint OpenAI-compatibile locale
│   │
│   ├── telemetry/
│   │   ├── logger.ts                 # pino
│   │   ├── metrics.ts                # latenza per fase, token/s, distorsioni applicate
│   │   └── trip-report.ts            # riepilogo leggibile della "esperienza" (debug/arte)
│   │
│   └── shared/
│       ├── types.ts                  # tipi contratto OpenAI (subset usato)
│       ├── errors.ts                 # classi errore → HTTP + body OpenAI
│       └── utils.ts
│
├── scripts/
│   ├── new-substance.ts              # scaffold di un profilo YAML valido
│   └── smoke-proxy.ts                # test manuale end-to-end contro Ollama/LM Studio
│
└── tests/
    ├── unit/                         # metabolism, distorter, schema sostanze
    ├── integration/                  # fastify.inject + upstream mockato (SSE)
    └── fixtures/                     # sostanze di prova, risposte upstream registrate
```

Fase 2 (dopo il proxy funzionante) si aggiunge solo:

```
├── apps/web/            # playground React (curve, dosaggio live, trip report)
└── packages/sdk/        # client tipizzato per giochi/app terze
```

---

## 4. Decisioni di design rilevanti

1. **Il dosing viaggia fuori dal contratto OpenAI.** Il body resta quello standard; sostanza e dose arrivano da header dedicati (`X-Substance-Id`, `X-Dose`) o da un campo esteso ignorato dai client ignari, così un client OpenAI qualsiasi continua a funzionare (effetto: nessuna alterazione).
2. **Sessioni esplicite e deterministiche.** `metabolism.ts` è puro: `(curva, dose, t) → fattori`. Lo stato vive in `session.ts` (in memoria, poi opzionale Redis). Rende i test banali e le sostanze riproducibili.
3. **Streaming come caso di prima classe.** Il percorso `stream: true` non deve mai bufferizzare: si altera il delta e si fa `pipe` immediato. Il percorso non-stream riusa lo stesso layer di distorsione sull'output completo.
4. **Ogni sostanza è dato, non codice.** Il profilo YAML dichiara curva e pesi delle distorsioni; vietato inserire funzioni arbitrarie (niente `eval`), così un profilo condiviso non è codice che gira sulla tua macchina.
5. **Errori e payload sempre OpenAI-shaped.** Un client esistente non deve accorgersi che c'è un proxy in mezzo, nemmeno quando fallisce.

---

## 5. Roadmap di scaffolding proposta

| Passo | Contenuto | Output verificabile |
|---|---|---|
| M1 | Scaffolding pnpm + TS + Fastify, `/healthz`, `/v1/models` | `pnpm dev` risponde, test verde |
| M2 | Pass-through SSE verso Ollama/LM Studio con mock upstream | test integrazione streaming |
| M3 | Engine sostanze + `sinestesia-concettuale.yaml` + `/v1/substances` | curva dose/tempo testata |
| M4 | Distorters `params` e `context` (amnesia, fissazione) | snapshot payload alterati |
| M5 | `logit` distorter + adattatore tokenizzatore opzionale | `logit_bias` valido per upstream che lo supporta |
| M6 | Telemetria, trip report, script `new-substance` | smoke test end-to-end `scripts/smoke-proxy.ts` |

---

## 6. Questioni aperte (da confermare con il committente)

1. Stack: TypeScript/Fastify (raccomandato) vs Python/FastAPI vs ibrido.
2. Provider prioritario per i test reali (Ollama locale? LM Studio? OpenAI cloud?).
3. La fase 2 (playground web) è in scope fin da subito o dopo M3?
