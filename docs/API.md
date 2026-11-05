# API del proxy

Base locale: `http://127.0.0.1:8787`. Il contratto è quello delle API OpenAI: un client
esistente funziona senza modifiche e, senza header di dosaggio, il proxy è un puro pass-through.

## Endpoint

| Metodo | Percorso | Descrizione |
|---|---|---|
| GET | `/healthz` | stato del servizio |
| GET | `/v1/models` | catalogo modelli, id nel formato `provider/modello` |
| GET | `/v1/substances` | catalogo sostanze (nome, famiglia, durata, effetti) |
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
