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
- Workspace (`pnpm-workspace.yaml`): `apps/*`, `packages/*`, `tools/*`. Oggi esistono `apps/agent`, `apps/server`, `apps/web`,
  `packages/dvw-parser`, `packages/shared`, `packages/volley-stats`, `tools/dvw-simulator`, `tools/carico` (vedi
  `docs/architettura.md`).

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

### Test del server e `ws`
`apps/server/vitest.config.ts` non usa le condizioni di `vitest.shared.ts` ma solo `@sir/source`, `node` e `default`
(per `resolve` e `ssr.resolve`): togliere `import` e `module` serve perché vitest passa le condizioni anche a Node per le
dipendenze CommonJS, e con `import` il `require('ws')` dentro `@fastify/websocket` caricherebbe il wrapper ESM di `ws`,
che non ha `WebSocket.Server`. Timeout di test e hook: 30 s.

### Build dei pacchetti con script di installazione
`pnpm-workspace.yaml` ha `allowBuilds` con `argon2: false` e `esbuild: false`: nessuno script di installazione viene
eseguito. `argon2` ha binari precompilati (caricati a runtime) ed `esbuild` (usato da drizzle-kit e tsx) installa il
binario della piattaforma come dipendenza opzionale.

### Sicurezza HTTP del server
`@fastify/helmet` è in `apps/server/package.json` con intervallo `^13.1.2` e il lockfile lo risolve a 13.1.2 (con
`helmet` 8.3.0). Il motivo: la 13.2.0 non passava il controllo pnpm sull'età minima del rilascio, quindi si resta sulla
13.1.2. Un cambio di versione va controllato sulle intestazioni inviate dal server (`docs/server.md`).

### Docker
- `docker-compose.yml` (radice): servizi `postgres` (immagine `postgres:17`, volume `pgdata`), `server` (porta 8090,
  pubblicata su `SERVER_BIND`, di default `127.0.0.1`) e `web` (nginx con il portale, pubblicato su
  `${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}`). `web` parte quando `server` è sano. nginx è l'unico ingresso per browser
  e agente; `CORS_ORIGIN` e `PUBLIC_BASE_URL` di default seguono `WEB_PORT` e `TRUST_PROXY` vale `true`. Dettagli e
  comandi in `docs/server.md`, il portale in `docs/portale.md`.
- `docker/web.Dockerfile`, `docker/web.nginx.conf`, `docker/web.security-headers.conf`: immagine del portale (build Vite
  con pnpm, poi `nginxinc/nginx-unprivileged` sulla porta 8080 con utente non root), proxy di `/api` e `/ws`, CSP.
- `docker/web.nginx.main.conf`: `nginx.conf` principale copiata dal Dockerfile; per gli spettatori ha `worker_processes
  auto`, `worker_rlimit_nofile 40000`, `worker_connections 16384`, `multi_accept on` (pid e file temporanei in `/tmp`).
  Il servizio `web` di `docker-compose.yml` ha `ulimits.nofile` a 65536 (soft e hard), altrimenti nginx non può aprire
  tanti descrittori. Sintassi verificata con nginx 1.28; **da ricontrollare al primo build** con la 1.29 unprivileged
  (`docker compose up -d --build`, poi `docker compose logs web`). Dettagli in `docs/portale.md`.
- `docker/server.Dockerfile`: build multi-stage con Node 24 slim. Lo stadio `build` esegue
  `pnpm install --frozen-lockfile`, `pnpm --filter "@sir/server..." build` e `pnpm --filter @sir/server deploy --prod /out`;
  lo stadio `runtime` copia `/out`, gira come utente `node` ed esegue `node dist/main.js` con un healthcheck su
  `/api/health`.
- `.dockerignore`: esclude dal contesto `node_modules`, `dist`, `coverage`, log, `.git`, `.env` e `.env.*` (tranne
  `.env.example`), `.claude`, `docs` e `samples`.
- Provato il 2026-10-14: `docker compose -p sirrealtime up -d --build` con `.env` da `.env.example`: `postgres`, `server`
  e `web` healthy. Esiti completi del collaudo in `docs/portale.md`.

### Dipendenze del portale (`apps/web`)
`echarts` (`^6.0.0`) pesa circa 60 MB su disco in `node_modules` ma nel bundle entra solo ciò che è importato: circa
185 KB gzip, in un chunk a parte (`echarts`, vedi `manualChunks` in `apps/web/vite.config.ts`) che resta in cache tra un
rilascio e l'altro. Il bundle principale è di circa 132 KB gzip. Le altre dipendenze sono `react`, `react-dom`,
`react-router`, `zod`, `tailwindcss` con `@tailwindcss/vite` (`docs/portale.md`, `docs/decisioni.md`).

## Configurazione
- `.env.example` elenca le variabili del server (`DATABASE_URL`, `PORT`, `HOST`, `CORS_ORIGIN`, `COOKIE_SECURE`,
  `SESSION_TTL_HOURS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_BASE_URL`, `LOG_LEVEL`, `TRUST_PROXY`,
  `RATE_LIMIT_LOGIN`, `RATE_LIMIT_INGEST`, `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_PUBLIC_WS`, `RATE_LIMIT_PUBLIC_INVALID`, `RATE_LIMIT_ADMIN`, `RATE_LIMIT_REGISTER`,
  `WS_MAX_PER_IP`, `WS_MAX_TOTAL`, `MATCH_MAX_LINES`, `DEFAULT_TENANT_SLUG`) e quelle di
  Docker Compose (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SERVER_BIND`, `WEB_BIND`, `WEB_PORT`).
  Descrizione e default in `docs/server.md`. Il file `.env` vero non va mai nel repository.
- `DEFAULT_TENANT_SLUG` (cliente degli hostname sconosciuti, default `predefinito`) è commentata in `.env.example` e
  passata dal servizio `server` di `docker-compose.yml` con `${DEFAULT_TENANT_SLUG-predefinito}`: se in `.env` è
  definita ma vuota resta vuota (hostname sconosciuto = 404, `docs/server.md`).
- Multi-cliente in produzione: nginx (`docker/web.nginx.conf`, oggi `server_name _`) va configurato con i `server_name`
  espliciti dei clienti e un `default_server` per il resto, passando `Host $host` al server; i certificati https per ogni
  hostname sono a cura del deploy.
- `CORS_ORIGIN`, `PUBLIC_BASE_URL` e `TRUST_PROXY` sono **commentate** in `.env.example` di proposito: lasciate così
  valgono i default giusti per ogni modo di avvio (con compose `http://localhost:${WEB_PORT}` e `true`, perché il server
  è dietro nginx; con `pnpm --filter @sir/server dev` e `vite dev` `http://localhost:5173` e `false`). Una riga attiva
  nel `.env` li sovrascriverebbe anche in compose, e un `TRUST_PROXY=false` o un'origine sbagliata rompono rate limit e
  login. Si decommentano solo per un dominio vero.

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

### Prova di carico (`tools/carico`, `@sir/carico`)
Apre N WebSocket pubblici contro un server, riproduce una partita `.dvw` tramite `POST /api/ingest` (un ingest ogni
`--interval` ms) e misura latenza di consegna, byte per aggiornamento, connessioni respinte o chiuse, CPU e memoria del
server. Due comandi, da lanciare con `pnpm --filter @sir/carico carico <comando>`:

- `prova`: `--url` (obbligatorio); `--token` (link pubblico) oppure `--admin-email` e `--admin-password` (crea agente e
  link); `--agent-token`; `--clients` (1000), `--rate` connessioni al secondo (200), `--workers` processi (2), `--gzip`
  (aggiunge `?enc=gzip`), `--dvw`, `--step point|line` (un ingest per punto o per riga), `--interval` (300),
  `--max-steps`, `--verify` spettatori che applicano i patch e confrontano lo stato finale (3), `--settle` (3000),
  `--server-pid` (CPU e memoria da `/proc`, solo Linux), `--json` (scrive il rapporto in un file);
- `dimensioni`: `--dvw`, byte dello stato completo e dei patch punto per punto, in chiaro e con gzip.

Una prova da migliaia di client da una sola macchina va fatta con `ulimit -n` alto, e i limiti per IP del server
(`WS_MAX_PER_IP`, `RATE_LIMIT_PUBLIC_WS`) vanno alzati se tutti i client arrivano dallo stesso IP.

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
DVW="samples/partita-sintetica.dvw"      # partita da riprodurre (percorso dalla radice)
SERVER="http://127.0.0.1:8090"           # indirizzo del server già avviato
ADMIN_EMAIL_PROVA="admin@example.com"    # superadmin/admin del cliente dell'hostname (crea agente e link)
ADMIN_PASSWORD_PROVA="<password>"        # password di quell'utente
SERVER_PID="<pid>"                       # pid del processo del server (es. pgrep -f "dist/main.js"); solo Linux
CLIENTI="1000"                           # spettatori simultanei
RISULTATI="/tmp/carico.json"             # file dove scrivere il rapporto JSON

# --- comandi ---
cd "$RADICE"
ulimit -n 65536                          # un descrittore per spettatore
pnpm --filter @sir/carico carico dimensioni --dvw "$DVW"
pnpm --filter @sir/carico carico prova --url "$SERVER" \
  --admin-email "$ADMIN_EMAIL_PROVA" --admin-password "$ADMIN_PASSWORD_PROVA" \
  --clients "$CLIENTI" --gzip --dvw "$DVW" --step point --interval 300 \
  --server-pid "$SERVER_PID" --json "$RISULTATI"
```

Il server della prova va avviato con i limiti alzati, ad esempio `RATE_LIMIT_PUBLIC_WS`, `RATE_LIMIT_INGEST` e
`WS_MAX_PER_IP` (variabili in `docs/server.md`).

**Numeri misurati** (2026-10-15; partita reale Suntory, 122 punti, un ingest ogni 300 ms; server su 2 core con PGlite;
tutti i client dallo stesso IP):

| Prova | Esito |
|---|---|
| Prima, limiti di default (`RATE_LIMIT_PUBLIC` 120), 1000 client | 120 connessi su 1000 |
| Prima, 1000 client | 35,7 KB per punto per spettatore, 4,2 GB in tutto |
| Prima, 3000 client | 59 connessioni respinte, latenza p95 192 ms, 12,3 GB |
| Dopo (patch + gzip), 1000 client | 1,0 KB per punto, 121 MB in tutto, CPU 14% |
| Dopo, 3000 client | latenza p50/p95/p99 58/143/183 ms, 364 MB, CPU 23% |
| Dopo, 5000 client | latenza p50/p95/p99 86/229/266 ms, 607 MB, CPU 30%, memoria massima 687 MB, nessun client chiuso |
| Dopo, solo testo (senza gzip), 3000 client | 4,6 KB per punto, 1,86 GB in tutto |
| Limiti di default (`WS_MAX_PER_IP`) | 2000 connessi dallo stesso IP, gli altri 503 |

**Configurazione consigliata**: un server da 2 vCPU e 2 GB di RAM regge fino a circa 5000 spettatori; oltre servono più
copie del server (ultimo punto del lavoro `scalabilita` in `docs/piano.md`, non ancora fatto: `StatePublisher` via
Postgres LISTEN/NOTIFY).

## Riferimenti
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `tsconfig.base.json`, `packages/*/tsconfig.json`, `packages/*/tsconfig.build.json`
- `vitest.shared.ts`, `packages/*/vitest.config.ts`
- `eslint.config.js`, `.prettierrc`, `.editorconfig`
- `scripts/ci_locale.sh`, `.env.example`
- `docker-compose.yml`, `docker/server.Dockerfile`, `docker/web.Dockerfile`, `docker/web.nginx.conf`,
  `docker/web.nginx.main.conf`, `docker/web.security-headers.conf`, `.dockerignore`, `apps/server/vitest.config.ts`
- `tools/carico/src/cli.ts` (comandi `prova` e `dimensioni`), `spectators.ts` (processi degli spettatori), `metrics.ts`
- Sezioni che ne dipendono: `docs/dvw-parser.md`, `docs/simulatore.md`, `docs/server.md`, `docs/portale.md`,
  `docs/architettura.md`
