# SIRRealtime

Legge in tempo reale i file di scout DataVolley (`.dvw`) di una partita di pallavolo e ne mostra l'andamento e le
statistiche in un portale web. Il progetto è un monorepo TypeScript; il piano completo è in `docs/piano.md`.

## Requisiti
- Node 24
- corepack (incluso in Node), che attiva il pnpm fissato in `package.json`

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

## Documenti
- `docs/piano.md`: piano e architettura
- `docs/infrastruttura.md`: monorepo, build, test, CI
- `docs/dvw-parser.md`: parser DVW
- `docs/simulatore.md`: simulatore DataVolley
- `docs/decisioni.md`: decisioni con data e motivo
- `docs/regole/`: regole di lavoro (codice, formato DVW, documentazione, job e rilasci)
