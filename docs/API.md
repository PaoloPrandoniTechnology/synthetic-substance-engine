# API del proxy

Base locale: `http://127.0.0.1:8787`. Il contratto è quello delle API OpenAI: un client
esistente funziona senza modifiche e, senza header di dosaggio, il proxy è un puro pass-through.

## Endpoint

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/healthz` | stato del servizio |
| GET | `/playground` | interfaccia web per dosare dal browser (`/` reindirizza qui) |
| GET | `/v1/models` | catalogo modelli, id nel formato `provider/modello` |
| GET | `/v1/substances` | catalogo sostanze (nome, famiglia, durata, effetti) |
| GET | `/v1/substances/:id/source` | profilo YAML grezzo dell'editor |
| POST | `/v1/substances/validate` | valida un profilo senza salvarlo |
| PUT | `/v1/substances/:id` | crea o aggiorna un profilo (201 nuovo, 200 esistente) |
| DELETE | `/v1/substances/:id` | elimina profilo e file su disco |
| GET | `/v1/substances/:id/trip-report` | referto simulato: `?dose=0..1` e `?elapsed=secondi` |
| GET | `/v1/sessions/:id/trip-report` | referto della sessione reale (timer e richieste) |
| POST | `/v1/chat/completions` | proxy chat, `stream: true` supportato |

## Header di dosaggio (opzionali)

| Header | Valori | Default | Effetto |
|---|---|---|---|
| `X-Substance-Id` | id di una sostanza | assente | senza header nessuna alterazione |
| `X-Dose` | `0`..`1` | `1` | moltiplica l'inviluppo della curva |
| `X-Session-Id` | stringa libera | `default` | separa le sessioni: ognuna ha il proprio inizio |
| `X-Substance-Elapsed` | secondi `>= 0` | dal timer di sessione | forza il punto della curva (utile per test e playground) |

Esempio con Ollama locale:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -H "x-substance-id: fissazione-paranoica" \
  -H "x-dose: 0.8" \
  -H "x-substance-elapsed: 40" \
  -d '{"model":"ollama-local/llama3.1:8b","messages":[{"role":"user","content":"Descrivi una stanza vuota"}],"stream":true}'
```

## Curva della sostanza

```
latenza (onset) ─▶ salita (peak) ─▶ plateau ─▶ svanimento (decay) ─▶ fine
```

L'inviluppo vale `curva(t) × dose × intensity` e resta in `0..1`: ogni distorsione del profilo
viene moltiplicata per quel valore. `X-Substance-Elapsed` permette di saltare direttamente al plateau.

## Header di risposta (solo con sostanza attiva)

| Header | Esempio | Significato |
|---|---|---|
| `X-Substance-Id` | `fissazione-paranoica` | sostanza applicata |
| `X-Dose` | `0.8` | dose effettiva |
| `X-Substance-Elapsed` | `40` | secondi di curva applicati |
| `X-Effect-Envelope` | `0.612` | inviluppo corrente `0..1` |
| `X-Effect-Phase` | `plateau` | fase della curva: `latente`, `salita`, `plateau`, `svanimento`, `fine` |
| `X-Logit-Status` | `skipped-no-tokenizer` | esito del logit: `applied`, `skipped-no-tokenizer`, `skipped-tokenizer-mismatch` |

## Logit e tokenizer

`logit_bias` parla solo il vocabolario del modello: gli id sono numeri, non parole. Per questo il
profilo dichiara **parole** e il proxy le compila, mentre il provider dichiara il proprio tokenizer.
Se i due non coincidono il distorsore viene **saltato**, mai indovinato.

```yaml
# config/providers.yaml
- id: openai-cloud
  kind: openai
  tokenizer: o200k_base
```

```yaml
# config/substances/allucinazione-controllata.yaml
logit:
  mode: associative-drift
  strength: 0.40
  targetTokenizer: o200k_base
  tokens:
    - text: "sogno"
      bias: 8
    - text: "specchio"
      bias: 5
      target: all   # tutti i sub-token, non solo il primo
```

`X-Logit-Status` in risposta dice cosa è successo: `applied`, `skipped-no-tokenizer` (provider senza
tokenizer) o `skipped-tokenizer-mismatch` (vocabolari diversi). Token id manuali (`tokenIds`) restano
possibili per chi conosce già il vocabolario dell'upstream.

## Jitter dello streaming

`streaming.jitter` (0..1) introduce un ritardo deterministico tra i chunk SSE, in
`[0, jitter × 90 ms]`, derivato da `hash(seed + indice chunk)`. Stesso profilo, stesso ritmo.
Non altera il contenuto e non ritarda il `[DONE]`; con `jitter: 0` (default) lo streaming resta
byte-identico all'upstream.

## Trip report

```bash
# simulazione: nessuna sessione necessaria
curl "http://127.0.0.1:8787/v1/substances/euforia-creativa/trip-report?dose=0.8&elapsed=60"

# sessione reale, dopo qualche richiesta con X-Session-Id
curl "http://127.0.0.1:8787/v1/sessions/la-mia-sessione/trip-report"
```

Risposta con `phase`, `envelope`, `percent`, `applied` (delta concreti di ogni distorsore) e
`summary`, una frase leggibile tipo:

```json
{
  "substanceId": "euforia-creativa",
  "phase": "plateau",
  "percent": 56,
  "summary": "Euforia Creativa — plateau (56%) · dose 0.8 · 60s dall'inizio: temperatura +0.2, presence 0.22, fissazione 2%."
}
```

## Catalogo modificabile

Il playground crea e aggiorna sostanze senza riavviare il proxy. Il profilo passa dallo **stesso
loader dell'avvio** (schema Zod, regole trasversali, compilazione dei token logit) e solo dopo la
validazione viene scritto in `config/substances/<id>.yaml` in modo atomico.

```bash
# prova a secco: nessuna scrittura
curl -X POST http://127.0.0.1:8787/v1/substances/validate \
  -H "content-type: application/json" \
  -d '{"yaml": "schema: 1\nid: prova\nname: Prova\n"}'
# → { "ok": false, "errors": ["id: id in kebab-case", ...] }

# salva: 201 se è nuovo, 200 se sostituisce un profilo esistente
curl -X PUT http://127.0.0.1:8787/v1/substances/prova \
  -H "content-type: application/json" \
  -d '{"yaml": "schema: 1\nid: prova\n..."}'
```

Codici di errore: `invalid_body` (manca `yaml`), `invalid_substance` (schema o regole violate, con
l'elenco dei problemi nel messaggio), `id_mismatch` (l'id del profilo non coincide con il percorso),
`substance_not_found` (sostanza inesistente).

## Tetti non aggirabili dai profili

- `MAX_TEMPERATURE` (default `1.6`) — massimo globale di `temperature`.
- `MAX_BIASED_TOKENS` (default `64`) — numero massimo di voci `logit_bias` inoltrate.
- `temperature` è sempre `0..2`, `top_p` `0.01..1`, penalties `-2..2`.

## Errori

Sempre nel formato OpenAI:

```json
{ "error": { "message": "...", "type": "invalid_request_error", "param": null, "code": "invalid_body" } }
```

Codici usati dal proxy: `invalid_body`, `invalid_dose`, `invalid_elapsed`, `substance_not_found`,
`upstream_unreachable`, `not_found`, `internal_error`. Gli errori dell'upstream vengono inoltrati
con lo status e il body originali.
