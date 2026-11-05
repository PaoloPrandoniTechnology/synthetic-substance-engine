# Skill 01 — Substance Authoring

> **Quando usarla:** ogni volta che si crea, modifica o valida un profilo sostanza in
> `config/substances/`, si implementa il caricatore (`src/engine/substance.ts`) o si discute il
> comportamento di una "droga" sintetica.
> **Regola d'oro:** una sostanza è **dato dichiarativo**, mai codice. Nessuna funzione, nessun
> `eval`, nessun accesso di rete dentro un profilo.

---

## 1. Contratto minimo di un profilo

Ogni file `config/substances/<id>.yaml` descrive una sostanza con questa forma:

```yaml
schema: 1                      # versione dello schema: obbligatoria, oggi "1"
id: euforia-creativa           # kebab-case, identico al nome del file
name: Euforia Creativa
family: stimolante             # stimolante | dissociativo | delirante | sedativo
intensity: 0.7                 # 0..1, forza massima raggiungibile al picco
onsetSeconds: 0
peakSeconds: 30
plateauSeconds: 120
decaySeconds: 240              # da picco a effetto nullo (half-life lineare)

# Fattori applicati al picco (0 = nessun effetto), interpolati dalle curve.
distortions:
  params:
    temperature: +0.35         # delta additivo sul valore richiesto dal client
    topP: +0.10
    frequencyPenalty: +0.20
    presencePenalty: +0.30
    maxTemperature: 1.6        # tetto di sicurezza sempre rispettato
  logit:
    mode: associative-drift    # associative-drift | token-noise | off
    strength: 0.4              # 0..1, quanto spinge i token remoti
    maxBiasedTokens: 64        # limite di voci logit_bias per richiesta
  context:
    amnesia: 0.0               # 0..1, quanta history viene dimenticata
    fixation: 0.5              # 0..1, probabilità di re-iniettare il tema fisso
    fixationToken: "luce"
    synesthesia: 0.3           # 0..1, mescolanza di domini sensoriali nel prompt
  streaming:
    jitter: 0.1                # 0..1, irregolarità ritmica dei chunk

# Effetti dichiarati (documentazione + UI futura), non eseguiti.
effects:
  - "associazioni remote e metafore estreme"
  - "aumento della verbosità"
contraindications:
  - "compiti che richiedono precisione fattuale"
```

### Logit: parole o token id

`logit.tokens` è la forma preferita: si scrive la parola, il proxy la compila con il tokenizer
dichiarato in `targetTokenizer` (`cl100k_base` o `o200k_base`).

```yaml
logit:
  mode: associative-drift
  strength: 0.40
  targetTokenizer: o200k_base
  tokens:
    - text: "sogno"
      bias: 8
      target: first   # default: solo il primo token
```

`tokenIds` resta disponibile per chi conosce già il vocabolario dell'upstream. Regole: dichiarare
sempre `targetTokenizer` quando si usano `tokens`; usare id manuali solo con un tokenizer verificato;
ricordare che su un provider senza tokenizer dichiarato il distorsore viene saltato (in risposta
compare `X-Logit-Status`).

## 2. Regole di validazione (bloccanti)

1. `schema` deve essere `1`; versioni diverse richiedono una migrazione documentata.
2. `id` in **kebab-case**, uguale al nome del file senza `.yaml`, unico nel catalogo.
3. Tutti i tempi in **secondi interi, >= 0**; `onsetSeconds + peakSeconds + plateauSeconds + decaySeconds > 0`.
4. `intensity` e ogni valore di `distortions.*.strength|amnesia|fixation|synesthesia|jitter` in **0..1**.
5. I delta dei parametri sono **relativi** al valore del client, mai assoluti: il client resta sovrano.
6. Ogni sostanza che alza `temperature` **deve** dichiarare `maxTemperature` (default globale 1.6).
7. `logit.maxBiasedTokens` obbligatorio se `logit.mode != off` (default 64).
8. Campi sconosciuti = **errore**, non ignorati: gli YAML si condividono tra utenti.

## 3. Convenzioni di scrittura

- Nome file e `id`: sostantivo + eventuale aggettivo, es. `amnesia-anterograda`, `fissazione-paranoica`.
- Un profilo per file; niente cataloghi multipli.
- Commenti in italiano, una riga sopra il campo quando il valore non è intuibile.
- `effects` e `contraindications` sono **testo per l'utente**: frasi brevi, niente gergo implementativo.
- Non inserire mai chiavi API, URL o path assoluti in un profilo.

## 4. Responsabilità e sicurezza

- Il profilo **non** può disattivare i limiti globali (`maxTemperature`, `maxBiasedTokens`,
  rate limit per sessione): quei tetti vivono nel codice, non nei dati.
- La curva deve essere **pura e deterministica**: `(profilo, dose, t) → fattori`. Stesso input,
  stesso output, sempre — serve per i test e per riprodurre un'"esperienza".
- Non promettere effetti clinici o reali: il dominio è **creativo e artistico**, non medico.

## 5. Checklist prima del commit

- [ ] `id` == nome file, kebab-case, unico (`grep -r "^id:" config/substances`).
- [ ] Profilo validato: `pnpm test` include lo schema, nessun errore sui file di `config/substances/`.
- [ ] Curve monotone: onset → picco → plateau → decay, senza salti.
- [ ] `maxTemperature` presente se si tocca `temperature`.
- [ ] `effects` leggibili da un non-tecnico.
- [ ] Commit con messaggio `feat(substance): <id>`.

## 6. Anti-pattern

| Anti-pattern | Perché è sbagliato |
|---|---|
| Delta assoluti (`temperature: 1.9`) | Sovrascrive la volontà del client e rompe la compatibilità |
| Amnesia = 1.0 senza limite di turni | Contesto vuoto: l'LLM non ha nulla su cui lavorare |
| `logit_bias` enorme senza `maxBiasedTokens` | 400 dall'upstream o degenerazione del testo |
| Sostanza "che fa tutto" | Illeggibile in UI, impossibile da testare, nessuna identità artistica |
| Effetti scritti nel codice e non nel profilo | Impossibile condividerli o mostrarli nel playground |
