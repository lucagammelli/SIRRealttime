# Infrastruttura

## A cosa serve
Il monorepo TypeScript che contiene tutte le sezioni di SIRRealtime: gestione dei pacchetti, compilazione, controlli di
qualità (lint, typecheck, test, formattazione) e CI. Le regole di codice sono in `docs/regole/codice.md`, quelle su
rami, job e CI in `docs/regole/test-job-rilasci.md`.

## Come funziona

### Strumenti
- **Node 24** (`engines.node` = `>=24` in `package.json`) e **pnpm 12.11.2**, fissato in `packageManager` e attivato
  con corepack.
- **TypeScript `~6.0.3`** e non 7: è la versione compatibile con typescript-eslint 8.71 (vedi `docs/decisioni.md`).
- Workspace (`pnpm-workspace.yaml`): `apps/*`, `packages/*`, `tools/*`. Oggi esistono `packages/dvw-parser`,
  `packages/shared`, `packages/volley-stats`, `tools/dvw-simulator`.

### Script radice
Tutti ricorsivi sui pacchetti che hanno lo script (`pnpm -r --if-present`), tranne i due di formattazione.

| Comando | Cosa fa |
|---|---|
| `pnpm lint` | `eslint .` in ogni pacchetto |
| `pnpm typecheck` | `tsc -p tsconfig.json` (senza emettere file) |
| `pnpm test` | `vitest run` in ogni pacchetto |
| `pnpm build` | `tsc -p tsconfig.build.json`, emette `dist/` |
| `pnpm format` | `prettier --write .` |
| `pnpm format:check` | `prettier --check .` |

### Condizione `@sir/source` e `dist`
Ogni pacchetto dichiara negli `exports`: `@sir/source` → `./src/index.ts`, `types` → `./dist/index.d.ts`,
`default` → `./dist/index.js`.
- **typecheck e vitest** leggono i sorgenti: `tsconfig.base.json` ha `customConditions: ["@sir/source"]` e
  `vitest.shared.ts` mette `@sir/source` tra le `conditions`. Non serve compilare le dipendenze per provare un pacchetto.
- **build**: `tsconfig.build.json` di ogni pacchetto azzera `customConditions` (`[]`) e quindi compila contro i `.d.ts` in
  `dist` delle dipendenze. Per questo `pnpm -r build` procede in ordine topologico (prima le dipendenze).
- **a runtime** Node non conosce `@sir/source` e usa `dist/index.js`: per eseguire un pacchetto (es. la CLI del
  simulatore, `dist/cli.js`) serve prima la build.

### tsconfig
Due file per pacchetto, entrambi estendono `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `module` NodeNext):
- `tsconfig.json`: `noEmit`, include `src`, `test`, `vitest.config.ts`; usato da typecheck ed ESLint;
- `tsconfig.build.json`: `rootDir` `src`, `outDir` `dist`, esclude `src/**/*.test.ts`.

### Test
`vitest.shared.ts` (radice) è la configurazione base; ogni pacchetto ha un `vitest.config.ts` che la riusa. Cerca i test
in `src/**/*.test.ts` e `test/**/*.test.ts`, ambiente `node`.

### ESLint e Prettier
- `eslint.config.js` (flat config): `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`
  (con `projectService`), più le regole `no-explicit-any`, `no-non-null-assertion`, `consistent-type-imports`,
  `no-unused-vars` (ignora i nomi che iniziano per `_`) ed `eqeqeq` sempre. Ignora `dist`, `build`, `coverage`,
  `node_modules`; sui file `.js/.mjs/.cjs` niente regole con i tipi.
- Prettier: `.prettierrc` e `.prettierignore`; `.editorconfig` per l'editor.

### CI
La CI è solo locale: `scripts/ci_locale.sh` esegue 5 passi: 1/5 `pnpm install --frozen-lockfile`,
2/5 `pnpm -r --if-present lint`, 3/5 typecheck, 4/5 test, 5/5 build. Non c'è CI su GitHub (nessuna GitHub Action);
lo script va lanciato prima di ogni PR e da `scripts/job.sh unisci`. Richiede Node 24 e corepack.

## Configurazione
- `.env.example` è ancora vuoto: nessuna variabile d'ambiente richiesta finora.
- Non c'è `docker-compose.yml` né altro in `docker/` per ora.

## Come si usa / si prova
```bash
# --- variabili ---
RADICE="/percorso/del/repository"   # radice del repository o del worktree del job
PACCHETTO="dvw-parser"              # nome del pacchetto dopo @sir/ (dvw-parser, dvw-simulator, shared, volley-stats)

# --- comandi ---
cd "$RADICE"
corepack enable                       # una sola volta: attiva il pnpm fissato in packageManager
pnpm install                          # dipendenze di tutti i pacchetti
pnpm --filter "@sir/$PACCHETTO" test  # test di un solo pacchetto
scripts/ci_locale.sh                  # i 5 passi della CI, da lanciare prima di ogni PR
```

## Riferimenti
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `tsconfig.base.json`, `packages/*/tsconfig.json`, `packages/*/tsconfig.build.json`
- `vitest.shared.ts`, `packages/*/vitest.config.ts`
- `eslint.config.js`, `.prettierrc`, `.editorconfig`
- `scripts/ci_locale.sh`, `.env.example`
- Sezioni che ne dipendono: `docs/dvw-parser.md`, `docs/simulatore.md`
