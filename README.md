# Triage Agent — P1

Classificazione di email/ticket, estrazione dati, bozza di risposta, coda di approvazione umana, audit trail e dashboard KPI.

**Stato:** live su Cloudflare Workers. Demo pubblica e benchmark congelato con metodo e limiti dichiarati.

## Dichiarazione dati

Tutti i 120 ticket sono **generati da questo repository** (`src/synthetic.ts`, seed `20261116`). Nomi, ordini, importi e indirizzi sono inventati. Nessun messaggio reale di un cliente viene letto dal sistema.

Il campo `baselineHandlingSec` è un'**assunzione dichiarata** (150–480 secondi per ticket), non una misura di lavoro umano. Serve solo a rendere esplicito il confronto. Nessuna percentuale di risparmio viene presentata come risultato reale.

## Cosa dimostra

- Human-in-the-loop con blocchi di policy: bassa confidenza, reclamo ad alta priorità o ordine mancante → revisione obbligatoria.
- Audit trail: ogni passaggio (ingresso, classificazione, decisione, invio simulato) è registrato con attore e timestamp.
- Fallback: Gemini API → Workers AI → motore deterministico. Senza chiavi il motore deterministico funziona da solo.
- Misurabilità: benchmark riproducibile su 120 ticket sintetici con accuratezza, copertura audit e latenza misurate.

## Architettura

```
ticket sintetico
   → normalizzazione (lowercase, rimozione diacritici)
   → classificazione + estrazione JSON (motore deterministico)
   → [opzionale] Gemini API → [opzionale] Workers AI → fallback deterministico
   → soglia di confidenza + regole di policy
   → coda di approvazione umana (dashboard)
   → decisione (approve / reject) → invio SIMULATO
   → D1: tickets, audit_log, benchmarks
   → dashboard HTML + /api/kpis
```

Nessuna casella Gmail reale è collegata. `POST /api/tickets/:id/send` scrive `sent_at` e un evento `simulated_send` con `realEmailSent: false`.

## Avvio locale (nessun account richiesto)

```bash
node projects/triage-agent/src/dev-server.ts
# http://localhost:8788
```

```bash
# test del motore
node --test projects/triage-agent/tests/*.test.ts

# benchmark completo + results/benchmark.json
node projects/triage-agent/scripts/benchmark.ts 120

# smoke test HTTP (server locale in esecuzione)
node projects/triage-agent/scripts/smoke.ts
```

Richiede Node ≥ 20 (testato con Node 26). Nessuna dipendenza da installare.

## API

| Metodo | Path | Funzione |
|---|---|---|
| `GET` | `/` | Dashboard HTML: KPI, coda, ultimo benchmark |
| `GET` | `/health` | Health check |
| `GET` | `/api/kpis` | KPI aggregati |
| `GET` | `/api/tickets` | Elenco ticket con previsione e stato |
| `POST` | `/api/tickets` | Ingerisce un ticket sintetico (`{count: n}` o `{ticket: {...}}`) |
| `POST` | `/api/tickets/:id/decide` | Approva/scarta (`{decision, actor, note, reviewSeconds}`) |
| `POST` | `/api/tickets/:id/send` | Invio simulato, richiede approvazione |
| `GET` | `/api/audits` | Audit trail (filtra con `?ticket=ID`) |
| `POST` | `/api/benchmark` | Esegue il benchmark e salva il risultato |
| `GET` | `/api/benchmarks` | Storico dei benchmark |

Con `AGENT_TOKEN` impostato, tutti i `POST` richiedono `x-agent-token` o `Authorization: Bearer <token>`.

## Deploy su Cloudflare free tier

```bash
cd projects/triage-agent
wrangler d1 create triage-agent
# incolla il database_id stampato in wrangler.toml
wrangler d1 migrations apply triage-agent --local
wrangler d1 migrations apply triage-agent --remote
wrangler secret put AGENT_TOKEN
# opzionali:
wrangler secret put GEMINI_API_KEY
wrangler secret put WORKERS_AI_ACCOUNT_ID
wrangler secret put WORKERS_AI_API_TOKEN
wrangler deploy
```

Il Worker espone anche `/` (dashboard), con un modulo pubblico **“Prova il triage”**: incolla un ticket inventato e ottieni classificazione, confidenza, bozza, motivo del blocco e JSON copiabile. Le demo vengono salvate in D1 con `demo_submitted` nel log. I costi rientrano nel free tier di Workers e D1; l'aggiunta di Gemini/Workers AI resta opzionale e va monitorata.

## Benchmark congelato e link pubblici

- ID: `bench-1794868562337` — 16 novembre 2026, seed `20261116`.
- 120 ticket sintetici · accuratezza tipo **92,5%** · auto-route **88,3%** · accuratezza su auto-route 100% · copertura audit **100%** · soglia confidenza 0,72.
- Riproduzione: `node scripts/benchmark.ts 120`. Output versionato: `results/benchmark.json`.
- Demo live: https://triage-agent.riccardobozzato.workers.dev/
- Caso con metodo, matrice di confusione e limiti: https://riccardobozzato.com/casi/triage-agent
- Autore: https://riccardobozzato.com/ — dati sintetici dichiarati, nessun cliente reale.

## Metriche misurate — benchmark 16 novembre 2026

Riproducibili con `node projects/triage-agent/scripts/benchmark.ts 120`. Sorgente: `results/benchmark.json`.

| Metrica | Valore | Natura del numero |
|---|---|---|
| Ticket nel campione | 120 | Conto reale su dataset sintetico |
| Accuratezza tipo (tutti i ticket) | 92,5% | Misurata su etichette sintetiche |
| Accuratezza tipo (solo auto-route) | 100% | Misurata sul sottoinsieme instradato automaticamente |
| Accuratezza urgenza | 100% | Misurata su etichette sintetiche |
| Precisione/recall campi | 100% | Misurati sui campi dichiarati presenti nel testo |
| Auto-route | 88,3% | Misurato |
| Revisione umana obbligatoria | 11,7% | Misurato (14 ticket, inclusi 11 ambigui) |
| Copertura audit | 100% | Misurata |
| Latenza media | 0,59 ms | Misurata nel processo locale |
| Baseline manuale dichiarato | 321 s/ticket | **Assunzione sintetica, non misura** |
| Risparmio di tempo reale | — | **Non misurato**: servono reviewer umani e un periodo di osservazione |

I 11 ticket ambigui sono instradati a revisione con confidenza 0,05: sono contati come "non classificati" nell'accuratezza complessiva perché il motore si rifiuta di indovinare. È una scelta deliberata, documentata nel caso.

## Limiti dichiarati

- Solo dati sintetici; nessuna casella reale collegata.
- Nessun OCR degli allegati.
- Italiano e inglese.
- Soglia di confidenza da tarare su un campione reale prima di qualsiasi uso in produzione.
- Il baseline manuale è un'assunzione: non trasformarlo in un ROI senza misurare reviewer umani.
- Il modello deterministico è governabile e auditabile, ma non ha la flessibilità di un LLM: gli adapter opzionali migliorano la copertura solo se validati sullo stesso dataset.

## Gate di uscita P1

- [x] Codice completo, test e benchmark riproducibile
- [x] Dati sintetici dichiarati
- [x] Log e dashboard funzionanti
- [x] Metriche misurate con metodo
- [x] URL pubblico (deploy) — https://triage-agent.riccardobozzato.workers.dev
- [x] Caso pubblicato sul sito — `/casi/triage-agent`
- [ ] Video, short, articolo e post LinkedIn pubblicati

Il progetto successivo (P2 Synapse Ops) non inizia finché questi gate non sono chiusi.
