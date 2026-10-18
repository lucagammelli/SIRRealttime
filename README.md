# SIRRealtime

Legge in tempo reale i file di scout DataVolley (`.dvw`) di una partita di pallavolo e ne mostra l'andamento e le
statistiche in un portale web. Il progetto è un monorepo TypeScript; il piano completo è in `docs/piano.md`.

## Requisiti

- Node 24
- corepack (incluso in Node), che attiva il pnpm fissato in `package.json`
- Docker e Docker Compose solo per eseguire server, Postgres e portale (nginx) insieme (vedi `docs/server.md`)

## Comandi

```bash
# --- variabili ---
FILE_OUT="/tmp/partita.dvw"   # file .dvw sintetico da generare

# --- comandi ---
corepack enable                 # una sola volta
pnpm install
pnpm test
scripts/ci_locale.sh            # lint, typecheck, test e build come in CI
pnpm build
node tools/dvw-simulator/dist/cli.js generate --out "$FILE_OUT" --seed 1 --sets 3
```

## Server in sviluppo

Con un database PGlite in memoria, senza Docker (il database si perde a ogni riavvio):

```bash
# --- variabili ---
ADMIN_EMAIL_DEV="admin@example.com"      # email del primo admin, creato all'avvio
ADMIN_PASSWORD_DEV="password-di-prova-1" # password del primo admin, almeno 12 caratteri

# --- comandi ---
DATABASE_URL="pglite:memory" COOKIE_SECURE="false" \
  ADMIN_EMAIL="$ADMIN_EMAIL_DEV" ADMIN_PASSWORD="$ADMIN_PASSWORD_DEV" \
  pnpm --filter @sir/server dev
```

Il server ascolta su `http://127.0.0.1:8090` (controllo: `/api/health`). Variabili, endpoint, login, token agente, link
pubblici e Docker Compose sono in `docs/server.md`.

## Portale in sviluppo

La demo avvia server, agente e una partita simulata in un solo processo; il portale si avvia in un secondo terminale e
si apre su `http://localhost:5173` (gli indirizzi dei link sono stampati dalla demo):

```bash
# --- variabili ---
DEMO_SPEED="15" # accelerazione della partita simulata

# --- comandi (primo terminale) ---
DEMO_SPEED="$DEMO_SPEED" pnpm --filter @sir/web demo
```

```bash
# --- comandi (secondo terminale) ---
pnpm --filter @sir/web dev
```

Pagine, variabili della demo, Docker e punti ancora da verificare sono in `docs/portale.md`.

## Documenti

- `docs/piano.md`: piano e architettura
- `docs/architettura.md`: flusso dei dati, pacchetti e contratti
- `docs/agente.md`: agente Windows (lettura del `.dvw`, coda offline, installazione come servizio)
- `docs/server.md`: server (ingest, accessi, endpoint, WebSocket, database, Docker)
- `docs/portale.md`: portale web (pagina pubblica, area riservata, demo, nginx)
- `docs/infrastruttura.md`: monorepo, build, test, CI, Docker, installazione in produzione
- `docs/dvw-parser.md`: parser DVW
- `docs/simulatore.md`: simulatore DataVolley
- `docs/decisioni.md`: decisioni con data e motivo
- `docs/regole/`: regole di lavoro (codice, formato DVW, documentazione, job e rilasci)
