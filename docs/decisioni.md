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
