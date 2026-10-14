# Decisioni

Una riga per decisione: data, scelta, motivo.

- 2026-10-14: monorepo con pnpm workspaces e condizione di export `@sir/source`, perché typecheck e test leggono i
  sorgenti senza compilare le dipendenze mentre build e runtime usano `dist` (`docs/infrastruttura.md`).
- 2026-10-14: TypeScript `~6.0.3` al posto di 7, perché typescript-eslint 8.71 non è compatibile con la 7.
- 2026-10-14: layout DV4 delle righe `[3SCOUT]` e `[3PLAYERS-*]` secondo il progetto openvolley/datavolley, perché è la
  descrizione più completa del formato disponibile (`docs/dvw-parser.md`).
- 2026-10-14: CI solo locale con `scripts/ci_locale.sh`, nessuna GitHub Action (scelta di Luca).
- 2026-10-14: campione sintetico (`samples/partita-sintetica.dvw`) generato dal simulatore, perché non ci sono ancora file
  DataVolley reali; i layout non confermati sono elencati in `docs/dvw-parser.md`.
- 2026-10-14: statistiche ricalcolate da zero a ogni aggiornamento (funzione pura, ~ms), rapporti 0-1
  (`docs/statistiche.md`).
- 2026-10-14: Fastify + Drizzle per il server, con PGlite (Postgres in WebAssembly) per i test, perché i test girano
  senza un Postgres installato con lo stesso SQL e le stesse migrazioni (`docs/server.md`).
- 2026-10-14: stato della partita ricalcolato a ogni ingest e inviato intero via WebSocket, perché il calcolo è puro e
  veloce e i client non devono gestire differenze o perdite di messaggi (`docs/server.md`).
- 2026-10-14: autenticazione dopo il rate limit (controlli in `preParsing`/`preValidation`/`preHandler`), perché
  i tentativi rifiutati devono essere contati e limitati anch'essi (`docs/server.md`).
- 2026-10-14: link pubblici "live" (`matchId` nullo) che seguono la partita corrente, perché il link da condividere
  resta lo stesso da una partita all'altra (`docs/server.md`).
- 2026-10-14: specifica OpenAPI per la DAST scritta a mano in `stackhawk/openapi.yaml` (nessuna generazione dal codice
  per ora), da aggiornare quando cambiano le rotte (`docs/server.md`).
