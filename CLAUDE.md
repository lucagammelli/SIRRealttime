# SIRRealtime: regole del progetto

DataVolley 4 (Windows) scrive in tempo reale il file di scout `.dvw` su una pennina USB. SIRRealtime lo legge mentre
cambia, lo invia a un backend e lo pubblica su un portale web con grafici: punteggio live, statistiche giocatori,
andamento della partita, grafici di campo. Piano completo e decisioni: `docs/piano.md`.

**Obbligo: prima di creare o modificare un file, leggi il file di dettaglio del suo argomento** (tabella sotto; se un
file tocca più argomenti, leggili tutti). Nel rapporto si dice quali file di dettaglio si sono letti.

| Se tocchi… | Leggi prima |
|---|---|
| Qualsiasi codice TypeScript, `package.json`, configurazioni di build/lint/test | `docs/regole/codice.md` |
| `packages/dvw-parser/`, `tools/dvw-simulator/`, file `.dvw` di esempio | `docs/regole/dvw.md` |
| `apps/server/` (API, WebSocket, DB, autenticazione, token), `apps/agent/` (token, invio, config) | `docs/regole/sicurezza.md` |
| `apps/web/` (pagine, componenti, grafici, stile) | `docs/regole/interfaccia.md` |
| Documenti in `docs/` (non `docs/regole/`) | `docs/regole/documentazione.md` |
| Rami, job, worktree, PR, CI, `scripts/`, `docker-compose.yml`, `.github/` | `docs/regole/test-job-rilasci.md` |

## Sezioni, aree e documenti
| Sezione | Aree (prefissi di percorso) | Documento |
|---|---|---|
| Parser DVW | `packages/dvw-parser/` | `docs/dvw-parser.md` |
| Statistiche | `packages/volley-stats/` | `docs/statistiche.md` |
| Contratti | `packages/shared/` | `docs/architettura.md` |
| Agente Windows | `apps/agent/` | `docs/agente.md` |
| Server | `apps/server/` | `docs/server.md` |
| Portale | `apps/web/` | `docs/portale.md` |
| Simulatore | `tools/dvw-simulator/` | `docs/simulatore.md` |
| Infrastruttura | `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `docker-compose.yml`, `docker/`, `scripts/`, `.github/` | `docs/infrastruttura.md` |

## Architettura (riassunto)
- Monorepo **pnpm workspaces**, TypeScript ovunque, Node 24, ESM.
- `packages/dvw-parser` (parser puro, niente I/O) → `packages/volley-stats` (funzioni pure: stato e statistiche)
  → `packages/shared` (tipi e schemi zod dei messaggi agente↔server↔web, unica fonte dei contratti).
- `apps/agent`: legge il `.dvw` (polling, il file viene riscritto per intero), calcola il diff delle righe
  `[3SCOUT]` (`append` o `snapshot`, con `seq` e hash), coda offline, invio HTTPS con token agente. Eseguibile Windows.
- `apps/server`: Fastify + WebSocket, Postgres con Drizzle, ingest idempotente, ricalcolo con `volley-stats`, push ai client.
- `apps/web`: React + Vite, ECharts, campo in SVG, Tailwind. Pagina pubblica `/live/:shareToken`, area `/admin` con login.
- Una partita live per volta; lo storico resta per `matchId`.

## Regole vincolanti
- **Riuso**: prima di scrivere cerca ciò che esiste e estendilo. Tipi e schemi dei messaggi solo in `packages/shared`;
  calcoli di punteggio/statistiche solo in `packages/volley-stats` (mai duplicati in server o web).
- **Funzioni pure** in parser e statistiche: nessun I/O, nessuna data corrente, deterministiche e testate.
- **Robustezza del parser**: una riga malformata non blocca mai la partita (diventa un'azione `unknown`).
- **Sicurezza**: input validati con zod a ogni confine; token salvati solo come hash; niente segreti nel codice
  (solo `.env`, con `.env.example` aggiornato); nessun SQL a stringhe; nessun `dangerouslySetInnerHTML`.
- **Test**: ogni modifica a parser, statistiche, ingest e diff dell'agente ha test vitest. Prima di una PR passa
  `scripts/ci_locale.sh` (lint, typecheck, test, build).
- **Lingua**: codice e identificatori in inglese; testi a video, documenti, commit e PR in italiano.
- **Lavoro con Claude**: un job = un ramo = un worktree (`scripts/job.sh`); la cartella principale resta su `main`
  e pulita. Dettaglio in `docs/regole/test-job-rilasci.md`.
