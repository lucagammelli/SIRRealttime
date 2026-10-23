# Infrastruttura

## A cosa serve
Il monorepo TypeScript che contiene tutte le sezioni di ArenaLive: gestione dei pacchetti, compilazione, controlli di
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

### Condizione `@arenalive/source` e `dist`
Ogni pacchetto dichiara negli `exports`: `@arenalive/source` → `./src/index.ts`, `types` → `./dist/index.d.ts`,
`default` → `./dist/index.js`.
- **typecheck e vitest** leggono i sorgenti: `tsconfig.base.json` ha `customConditions: ["@arenalive/source"]` e
  `vitest.shared.ts` mette `@arenalive/source` tra le `conditions`. Non serve compilare le dipendenze per provare un pacchetto.
- **build**: `tsconfig.build.json` di ogni pacchetto azzera `customConditions` (`[]`) e quindi compila contro i `.d.ts` in
  `dist` delle dipendenze. Per questo `pnpm -r build` procede in ordine topologico (prima le dipendenze).
- **a runtime** Node non conosce `@arenalive/source` e usa `dist/index.js`: per eseguire un pacchetto (es. la CLI del
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
`apps/server/vitest.config.ts` non usa le condizioni di `vitest.shared.ts` ma solo `@arenalive/source`, `node` e `default`
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
  con pnpm, poi `nginxinc/nginx-unprivileged` sulla porta 8080 con utente non root), proxy di `/api` e `/ws`, CSP (con `worker-src 'self'` per il service worker minimo dell'app installabile, senza cache:
  `docs/portale.md`, «App installabile e schermo intero»). Ogni build scrive `dist/version.json` con l'id della build
  (`buildIdPlugin` in `apps/web/vite.config.ts`), servito da `location /` con `Cache-Control "no-cache"`: il portale lo
  legge per accorgersi di essere superato (`docs/portale.md`).
- `docker/web.nginx.main.conf`: `nginx.conf` principale copiata dal Dockerfile; per gli spettatori ha `worker_processes
  auto`, `worker_rlimit_nofile 40000`, `worker_connections 16384`, `multi_accept on` (pid e file temporanei in `/tmp`).
  Il servizio `web` di `docker-compose.yml` ha `ulimits.nofile` a 65536 (soft e hard), altrimenti nginx non può aprire
  tanti descrittori. Sintassi verificata con nginx 1.28; **da ricontrollare al primo build** con la 1.29 unprivileged
  (`docker compose up -d --build`, poi `docker compose logs web`). Dettagli in `docs/portale.md`. Il suo `log_format
  main` maschera token e codici brevi nel percorso (`/l/[codice]`, `/live/[token]`, `/api|ws/public/[token]`, e dei link di invito e recupero password `/admin/invito|reimposta-password/[token]`, `/api/auth/links/[token]`) e il
  Referer (`[omesso]`).
- `SHARE_CODE_SECRET` in `docker-compose.yml` (servizio `server`) è `${SHARE_CODE_SECRET:?…}`: **senza la variabile nel
  `.env` falliscono tutti i comandi `docker compose`**, anche `down`, `logs` e `config`. Cambiarla cambia tutti i
  codici brevi (QR stampati inutilizzabili). `RATE_LIMIT_SHORT_CODE_INVALID` ha default 1000. Generazione in
  `docs/server.md`, «Docker Compose».
- Volumi: `pgdata` (database) e `assets` (immagini dei clienti, montato su `/data/assets` nel servizio `server`, con
  `ASSETS_DIR=/data/assets` e `ASSETS_QUOTA_MB`, default 50). Le immagini non stanno nel database: il backup copia anche
  il volume `assets`. nginx accetta corpi fino a 3 MB (`client_max_body_size 3m`) per il caricamento di un'immagine
  (`POST /api/admin/assets`, 2 MB in base64) e comprime anche `image/svg+xml`.
- `docker/server.Dockerfile`: build multi-stage con Node 24 slim. Lo stadio `build` esegue
  `pnpm install --frozen-lockfile`, `pnpm --filter "@arenalive/server..." build` e `pnpm --filter @arenalive/server deploy --prod /out`;
  lo stadio `runtime` copia `/out`, crea `/data/assets` di proprietà di `node` (il volume nuovo la eredita), gira come utente `node` ed esegue `node dist/main.js` con un healthcheck su
  `/api/health`.
- Volume `downloads` (o cartella dell'host `AGENT_DOWNLOAD_HOST_DIR`): montato **in sola lettura** su `/data/downloads` nel
  servizio `server`, con `AGENT_DOWNLOAD_DIR=/data/downloads`. Lo riempiono solo gli script di costruzione: in produzione `scripts/pubblica-agente-produzione.sh` (agente C#, passo 8), a mano `scripts/costruisci-agente.sh` (agente Node, sotto);
  vuoto, il portale dice che l'agente non è pubblicato. Il server non lo scrive mai.
- Campionati: il servizio `server` di `docker-compose.yml` passa `LEAGUE_SYNC` (default `on`), `LEAGUE_CONTACT` (vuoto: il
  server usa `PUBLIC_BASE_URL`) e `RATE_LIMIT_LEAGUE_SYNC` (6). Il server **esce in https** verso `www.legavolley.it`
  (l'unico host ammesso): in una rete con uscita filtrata va consentito. I loghi scaricati stanno in `_leagues` dentro il
  volume `assets` (`ASSETS_DIR`): il backup del volume li comprende. Descrizione in `docs/server.md` («Campionati»).
- Loghi di sistema: la migrazione `0016_loghi_sistema.sql` crea `system_logos` e la `0017_loghi_sistema_varianti.sql`
  aggiunge la variante positivo/negativo (si applicano da sole all'avvio del server);
  i file stanno in `_system` dentro lo stesso volume `assets`, quindi il backup del volume li comprende
  (`docs/server.md`, «Loghi di sistema»).
- `.dockerignore`: esclude dal contesto `node_modules`, `dist`, `coverage`, log, `.git`, `.env` e `.env.*` (tranne
  `.env.example`), `.claude`, `docs` e `samples`.
- Provato il 2026-10-14: `docker compose -p arenalive up -d --build` con `.env` da `.env.example`: `postgres`, `server`
  e `web` healthy. Esiti completi del collaudo in `docs/portale.md`.
- Stack di prova locale: dal 2026-10-20 gira come progetto compose **`arenalive`** (volumi `arenalive_pgdata` e
  `arenalive_assets`, database e utente `arenalive`). I dati dello stack precedente stanno nei volumi `sir-realtime_*` e
  vanno copiati a mano nei nuovi (compose non li riconosce).

### Dipendenze del portale (`apps/web`)
`echarts` (`^6.0.0`) pesa circa 60 MB su disco in `node_modules` ma nel bundle entra solo ciò che è importato: circa
185 KB gzip, in un chunk a parte (`echarts`, vedi `manualChunks` in `apps/web/vite.config.ts`) che resta in cache tra un
rilascio e l'altro. Il bundle principale è di circa 132 KB gzip. Le altre dipendenze sono `react`, `react-dom`,
`react-router`, `zod`, `qrcode` (QR dei link brevi, generato nel browser), `tailwindcss` con `@tailwindcss/vite`
(`docs/portale.md`, `docs/decisioni.md`); in sviluppo anche `@types/qrcode` e `jsqr` (decodifica il QR nei test).

## Configurazione
- `.env.example` elenca le variabili del server (`DATABASE_URL`, `PORT`, `HOST`, `CORS_ORIGIN`, `COOKIE_SECURE`,
  `SESSION_TTL_HOURS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_BASE_URL`, `LOG_LEVEL`, `TRUST_PROXY`,
  `RATE_LIMIT_LOGIN`, `RATE_LIMIT_INGEST`, `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_PUBLIC_WS`, `RATE_LIMIT_PUBLIC_INVALID`, `RATE_LIMIT_SHORT_CODE_INVALID`, `RATE_LIMIT_ADMIN`, `RATE_LIMIT_REGISTER`, `SHARE_CODE_SECRET`,
  `RATE_LIMIT_AGENT_DOWNLOAD`, `WS_MAX_PER_IP`, `WS_MAX_TOTAL`, `MATCH_MAX_LINES`, `DEFAULT_TENANT_SLUG`, `ASSETS_DIR`,
  `ASSETS_QUOTA_MB`, `AGENT_DOWNLOAD_DIR`, `RATE_LIMIT_LEAGUE_SYNC`, `LEAGUE_SYNC`, `LEAGUE_CONTACT`, `RATE_LIMIT_PASSWORD_RESET`, `SETTINGS_ENCRYPTION_KEY`) e quelle di Docker Compose (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
  `SERVER_BIND`, `WEB_BIND`, `WEB_PORT`, `AGENT_DOWNLOAD_HOST_DIR`).
  Descrizione e default in `docs/server.md`. Il file `.env` vero non va mai nel repository.
- Posta: il servizio `server` di `docker-compose.yml` passa `RATE_LIMIT_PASSWORD_RESET` (default 10, richieste al minuto
  per IP sulle rotte dei link di invito e recupero password) e `SETTINGS_ENCRYPTION_KEY` (vuota di default: senza, la
  pagina «Posta» non salva la password SMTP). La chiave è di 32 byte in base64 (`openssl rand -base64 32`, script in
  `docs/server.md`); se cambia, la password del server di posta va reinserita. Il server di posta non si configura nel
  `.env` ma nel portale (`docs/server.md`, «Posta, inviti e recupero password»); il server esce verso l'SMTP scelto, che
  in una rete con uscita filtrata va consentito.
- `DEFAULT_TENANT_SLUG` (cliente degli hostname sconosciuti, default `predefinito`) è commentata in `.env.example` e
  passata dal servizio `server` di `docker-compose.yml` con `${DEFAULT_TENANT_SLUG-predefinito}`: se in `.env` è
  definita ma vuota resta vuota (hostname sconosciuto = 404, `docs/server.md`).
- Multi-cliente in produzione: nginx (`docker/web.nginx.conf`, `server_name _`) accetta ogni hostname e passa `Host` al
  server; i certificati https per ogni hostname li emette Caddy (`ARENALIVE_HOSTNAMES` all'avvio, gli hostname dei clienti on demand), vedi «Modalità dei certificati».
- `CORS_ORIGIN`, `PUBLIC_BASE_URL` e `TRUST_PROXY` sono **commentate** in `.env.example` di proposito: lasciate così
  valgono i default giusti per ogni modo di avvio (con compose `http://localhost:${WEB_PORT}` e `true`, perché il server
  è dietro nginx; con `pnpm --filter @arenalive/server dev` e `vite dev` `http://localhost:5173` e `false`). Una riga attiva
  nel `.env` li sovrascriverebbe anche in compose, e un `TRUST_PROXY=false` o un'origine sbagliata rompono rate limit e
  login. Si decommentano solo per un dominio vero.

## Come si usa / si prova
```bash
# --- variabili ---
RADICE="/percorso/del/repository"   # radice del repository o del worktree del job
PACCHETTO="dvw-parser"              # nome del pacchetto dopo @arenalive/ (dvw-parser, dvw-simulator, shared, volley-stats)

# --- comandi ---
cd "$RADICE"
corepack enable                       # una sola volta: attiva il pnpm fissato in packageManager
pnpm install                          # dipendenze di tutti i pacchetti
pnpm --filter "@arenalive/$PACCHETTO" test  # test di un solo pacchetto
scripts/ci_locale.sh                  # i 5 passi della CI, da lanciare prima di ogni PR
```

### Agente scaricabile (`scripts/costruisci-agente.sh`)
Costruisce da Linux `arenalive-agent.exe` (Node SEA per Windows x64) e lo pubblica dove il server lo offre dal portale
(`docs/server.md`, «Agente scaricabile»). Passi: bundle esbuild dell'agente → download di `node.exe` per Windows e di
`SHASUMS256.txt` da nodejs.org in una cartella temporanea (rimossa alla fine) con verifica dello sha256 → blob SEA →
iniezione con `postject` in una copia di `node.exe` → `arenalive-agent.exe` e `arenalive-agent.json` in `USCITA`, pubblicati con
`mv` (rename) così il server non vede mai un exe a metà. Sono gli stessi passi di `apps/agent/scripts/build-exe.ps1`.

- **Versione** = versione di `apps/agent/package.json` + commit corto (`<versione>-<commit>`, «locale» senza git).
- **Il `node` locale deve avere la stessa versione di `node.exe`** (`NODE_VERSIONE`, di default quella di `node --version`),
  perché il blob SEA dipende dalla versione: altrimenti lo script si ferma.
- **Rifiuta un'`USCITA` dentro il repository** (percorso risolto con `realpath -m`).
- `postject` stampa l'avviso «signature corrupted»: è atteso, l'exe non è firmato (la firma è nel piano, «Agente: da
  rifare in seguito»). Provato: circa 24 s, exe di circa 94,7 MB.
- Serve: Node 24, pnpm (`corepack enable`), `pnpm install` già fatto, `curl`, `sha256sum`, `npx`; scarica circa 30 MB.

```bash
# --- variabili ---
RADICE="/percorso/del/repository"       # radice del repository o del worktree del job
USCITA="/srv/arenalive/downloads"             # cartella d'uscita: AGENT_DOWNLOAD_HOST_DIR del .env (fuori dal repository)
NODE_VERSIONE="$(node --version | sed 's/^v//')"   # versione di node.exe: deve essere quella del node locale (è già il default dello script)

# --- comandi ---
cd "$RADICE"
USCITA="$USCITA" NODE_VERSIONE="$NODE_VERSIONE" scripts/costruisci-agente.sh
# il server legge i file ad ogni richiesta: non serve riavviarlo
```

`USCITA` e `NODE_VERSIONE` possono anche restare vuote: i default sono `$HOME/arenalive-agent-download` e la versione del node
locale.

### Agente C# (`scripts/costruisci-agente-dotnet.sh`)
Costruisce da Linux l'agente C# (`apps/agent-dotnet`, `docs/agente.md`): prima i test xUnit della libreria core, poi
`dotnet publish` di `arenalive-agent.exe` (win-x64, exe unico autosufficiente e compresso, circa 48 MB). Tutto in un container
temporaneo `mcr.microsoft.com/dotnet/sdk:10.0` (sul server non si installa nulla); i sorgenti sono copiati in una cartella
`~/.arenalive-agent-dotnet-XXXXXX` (non in `/tmp`, che è in RAM). Prima di partire controlla Docker e lo spazio libero su `/`
(almeno 5 GB, `SPAZIO_MINIMO_GB`); la prima volta scarica circa 1,5 GB. Output: `dist/arenalive-agent-<versione>.exe` (`dist/` è
escluso da git) con messaggio finale di versione (`<versione>+<commit>`), dimensione e sha256.
**Pulizia**: alla fine (anche in caso di errore) rimuove container e cartella temporanea; con `RIMUOVI_IMMAGINE=1`
(default) rimuove anche l'immagine SDK, ma solo se l'ha scaricata questa build (se c'era già, resta); con `0` la tiene
sempre per la build successiva.
Le variabili `VERSIONE` (a.b.c, default: la versione del `package.json` alla radice, via `scripts/versione.mjs`; `ARENALIVE_COMMIT` forza il
commit mostrato), `USCITA` (default `<radice>/dist`) e `RIMUOVI_IMMAGINE` si passano
dall'ambiente.

```bash
# --- variabili ---
RADICE="/percorso/del/repository"   # radice del repository o del worktree del job
VERSIONE="1.0.0"                    # versione dell'agente: numeri a.b.c (vuota: quella del package.json alla radice)
USCITA="$RADICE/dist"               # cartella dell'exe prodotto
RIMUOVI_IMMAGINE="1"                # 1 = rimuove l'immagine SDK alla fine se l'ha scaricata la build; 0 = la tiene sempre

# --- comandi ---
cd "$RADICE"
VERSIONE="$VERSIONE" USCITA="$USCITA" RIMUOVI_IMMAGINE="$RIMUOVI_IMMAGINE" scripts/costruisci-agente-dotnet.sh
```

**La CI locale non compila il C#** (`scripts/ci_locale.sh` esegue solo i passi Node). Proposta: un passo facoltativo, attivo
solo se c'è Docker, che lancia questo script. Per i contratti, invece, la CI locale (test di `@arenalive/shared`) controlla già che
gli schemi in `apps/agent-dotnet/schemas/` siano aggiornati.

### Prova di carico (`tools/carico`, `@arenalive/carico`)
Apre N WebSocket pubblici contro un server, riproduce una partita `.dvw` tramite `POST /api/ingest` (un ingest ogni
`--interval` ms) e misura latenza di consegna, byte per aggiornamento, connessioni respinte o chiuse, CPU e memoria del
server. Due comandi, da lanciare con `pnpm --filter @arenalive/carico carico <comando>`:

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
ADMIN_EMAIL_PROVA="admin@example.com"    # admin di un cliente o superadmin (crea agente e link); il superadmin entra prima nel cliente con l’hostname di SERVER, altrimenti in quello predefinito
ADMIN_PASSWORD_PROVA="<password>"        # password di quell'utente
SERVER_PID="<pid>"                       # pid del processo del server (es. pgrep -f "dist/main.js"); solo Linux
CLIENTI="1000"                           # spettatori simultanei
RISULTATI="/tmp/carico.json"             # file dove scrivere il rapporto JSON

# --- comandi ---
cd "$RADICE"
ulimit -n 65536                          # un descrittore per spettatore
pnpm --filter @arenalive/carico carico dimensioni --dvw "$DVW"
pnpm --filter @arenalive/carico carico prova --url "$SERVER" \
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

### Scansione di sicurezza DAST (`scripts/dast_zap.sh`)
Sostituisce StackHawk (piano scaduto). Avvia un server di prova (`apps/server` con `tsx`, database PGlite in memoria) sulla
porta **18090**, crea l'utente `scan@arenalive.local` (admin del cliente «Predefinito») e un token agente tramite l'API, poi
esegue `zap-api-scan.py` di OWASP ZAP nell'immagine Docker `ghcr.io/zaproxy/zaproxy:2.17.0` con la specifica
`scripts/dast/openapi.yaml`. Cookie `arenalive_session` e `Authorization: Bearer` sono passati a ZAP con il `replacer`; `/api/auth/logout`
è escluso (e tolto dalla specifica). Il server di prova ha tutti i `RATE_LIMIT_*` a 100000 tranne `RATE_LIMIT_LEAGUE_SYNC`
(lasciato al predefinito per non caricare legavolley.it) e `LEAGUE_SYNC=off`. Non coperti: WebSocket e portale/nginx.
- **Requisiti**: `docker`, `node` 24, `pnpm` (lo script prova `corepack enable`), `curl`; `pnpm install` già fatto. Porta 18090
  libera (altrimenti esce con 2). **Disco**: l'immagine ZAP pesa circa 2 GB, scaricata alla prima esecuzione e lasciata nella
  cache Docker; controllare lo spazio libero su `/` prima di lanciarla (lo script non lo verifica).
- **Uscite**: 0 pulito; 1 avvisi di rischio Alto o Medio; 2 preparazione fallita (strumenti mancanti, server che non parte,
  login, ZAP senza report).
- **Report** (HTML e JSON, `zap.log`, `server.log`): `~/arenalive-dast-report/`, o `DAST_REPORT_DIR`; una cartella non vuota che
  non sia un report precedente viene rifiutata. Restano fuori dal repository.
- **Falsi positivi**: solo in `scripts/dast/zap-regole.tsv` (id plugin, `IGNORE`, motivo); oggi nessuna regola.
- Le altre variabili (porta, credenziali di prova, immagine, minuti massimi) sono nel blocco in alto dello script.

```bash
# --- variabili ---
RADICE="/percorso/del/repository"          # radice del repository o del worktree del job
DAST_REPORT_DIR="$HOME/arenalive-dast-report"    # dove scrivere i report (fuori dal repository)

# --- comandi ---
cd "$RADICE"
DAST_REPORT_DIR="$DAST_REPORT_DIR" scripts/dast_zap.sh
```
Dettagli sulle rotte e l'esito in `docs/server.md` («Scansione di sicurezza (DAST)»), regole in `docs/regole/sicurezza.md`.

## Installazione in produzione
Guida passo passo per mettere ArenaLive su un server vero, con HTTPS e backup. Si fa con cinque script in `scripts/`
(`installa-produzione.sh`, `aggiorna-produzione.sh`, `backup-produzione.sh`, `pubblica-agente-produzione.sh`,
`ripristina-produzione.sh`) e tre file in
`docker/` (`compose.produzione.yml`, `Caddyfile`, `web.realip.conf`). Come è fatto lo stack: **Caddy** (unico servizio
esposto, porte 80 e 443) emette i certificati (Let's Encrypt, oppure una CA interna di Caddy se i domini non sono ancora pubblici: «Modalità dei certificati») e inoltra a `web` (nginx), che a sua volta parla con
`server` e `postgres` nella rete interna di Docker. Server e web non pubblicano nessuna porta sull'host.

### 1. Cosa serve prima
- Un server **Ubuntu Server 24.04 o 26.04 LTS** appena installato (anche «minimized»), `x86_64` o `aarch64`, con systemd. Su 26.04 la suite del repository Docker è `resolute` (lo script la verifica e si ferma se non esiste).
- **Spazio libero**: almeno 20 GB su `/var/lib` (`SPAZIO_MIN_GB`; immagini Docker, database, build dell'agente, circa 5 GB
  temporanei). **Memoria**: almeno 1800 MB tra RAM e swap (`MEMORIA_MIN_MB`; la build del portale usa circa 1,5 GB). Con
  meno RAM si aggiunge un file di swap. Lo script si ferma con un messaggio se non bastano.
- Un **dominio** per il portale e, per ogni cliente che ha un proprio indirizzo, un hostname: per ognuno un record DNS **A**
  (IPv4) e, se il server ha un IPv6 pubblico, **AAAA**, che punta a questo server. L'IPv6 funziona con l'IP vero del client perché
  lo script imposta in `/etc/docker/daemon.json` `ip6tables: true` e `userland-proxy: false` (unisce le chiavi a un file
  esistente e riavvia Docker solo se cambia) e la rete di compose ha la sottorete ULA `fd29:250::/64`; senza queste impostazioni
  i client IPv6 arriverebbero tutti con l'IP del gateway e dividerebbero lo stesso limite di richieste. Se non vuoi IPv6, non
  creare il record AAAA. Senza DNS già propagato Let's Encrypt non
  emette il certificato (lo script avvisa e puoi rilanciarlo più tardi).
- Le porte **80 e 443** (TCP; 443 anche UDP) raggiungibili da Internet e libere sul server; la porta SSH nota.
- Accesso **SSH** al server con un utente che può usare `sudo`.
- Il repository è privato: serve poter aggiungere una chiave di deploy su GitHub (passo 3).
- Non deve esserci il pacchetto Ubuntu `docker.io` (lo script si ferma e lo dice): lo script installa Docker ufficiale.

### 2. Portare lo script sul server e compilare le variabili
Copia `scripts/installa-produzione.sh` sul server (da un PC con il repository: `scp`; in alternativa incolla il contenuto con
un editor). Aprilo e compila **solo** il blocco `--- variabili ---` in alto; ogni `"<…>"` va sostituito.

| Variabile | Cosa mettere | Dove trovarla |
|---|---|---|
| `CERTIFICATI` | `interno` (CA locale di Caddy, per hostname privati) o `letsencrypt` (certificato pubblico); vedi «Modalità dei certificati» | scelta tua |
| `DOMINIO_PORTALE` | dominio del portale, solo il nome (es. `portale.example.org`, no `https://`, no IP; con `interno` anche nomi privati come `realtime.local`) | il tuo registrar DNS, o il tuo file hosts |
| `ALTRI_HOSTNAME` | facoltativo: hostname dei clienti separati da spazio, il cui certificato si chiede già all'avvio; vuoto va bene (i nuovi clienti non ne hanno bisogno, vedi passo 7) | stesso pannello DNS |
| `EMAIL_LETSENCRYPT` | email per gli avvisi di scadenza; obbligatoria solo con `letsencrypt` | la tua |
| `ADMIN_EMAIL` | email del superadmin iniziale | la tua |
| `ADMIN_PASSWORD` | vuota = generata e mostrata una volta; altrimenti almeno 12 caratteri tra lettere, cifre e `@ % + = . , : ! _ -` | scelta tua |
| `REPO_URL` | indirizzo SSH (repo privato) o https (pubblico) | GitHub, pulsante «Code» |
| `REPO_RIFERIMENTO` | ramo o tag da installare (default `main`) | GitHub, «Branches» o «Tags» |
| `CHIAVE_DEPLOY` | percorso di una chiave privata SSH già sul server; vuoto = ne crea una lo script | di norma vuoto |
| `HOSTKEY_GITHUB_SHA256` | impronta ed25519 di GitHub; già compilata, controllala | docs.github.com, «GitHub's SSH key fingerprints»; vuota con repo https |
| `CARTELLA_INSTALLAZIONE` | dove sta il codice e il `.env` (default `/opt/arenalive`) | scelta tua |
| `CARTELLA_BACKUP` | dove vanno i backup (default `/var/backups/arenalive`) | scelta tua |
| `BACKUP_DA_TENERE` | quanti backup tenere per tipo (default 14) | scelta tua |
| `FUSO_ORARIO` | fuso del server (default `Europe/Rome`) | `timedatectl list-timezones` |
| `PORTA_SSH` | porta di `sshd`; resta aperta nel firewall (se è sbagliata lo script si ferma prima di chiuderti fuori) | `ss -tlnp \| grep sshd` |
| `UTENTE_SERVIZIO` | utente di sistema senza login, proprietario di codice e chiave (default `arenalive`) | scelta tua |
| `SPAZIO_MIN_GB`, `MEMORIA_MIN_MB` | soglie minime (default 20 e 1800) | di norma non si toccano |
| `DOCKER_GPG_FPR` | impronta della chiave apt di Docker; già compilata | docs.docker.com/engine/install/ubuntu |
| `CONFIG_SISTEMA`, `LOG` | file delle impostazioni non segrete e registro dell'installazione | di norma non si toccano |

Poi si lancia come root:
```bash
# --- variabili ---
SCRIPT="/home/ubuntu/installa-produzione.sh"   # dove hai copiato lo script sul server

# --- comandi ---
sudo bash "$SCRIPT"
```

### Modalità dei certificati
`CERTIFICATI` nel blocco variabili sceglie come Caddy emette i certificati (nel `.env`: `ARENALIVE_TLS_MODE`, riallineata a ogni
esecuzione; `docker/Caddyfile` importa lo snippet `modo_<valore>`).
- **`letsencrypt`**: certificati pubblici Let's Encrypt; servono hostname con DNS pubblico e porte 80/443 raggiungibili da
  Internet, e `EMAIL_LETSENCRYPT` valida. Senza record DNS lo script avvisa.
- **`interno`**: `tls internal`, certificati firmati da una **radice generata da Caddy sul server** (volume `caddy_data`). Per
  hostname non pubblici (`realtime.local`, o nomi non ancora in DNS risolti dal file hosts dei PC). `EMAIL_LETSENCRYPT` può
  restare vuota, l'assenza del record DNS è solo informativa e la verifica finale usa `curl --resolve --cacert` con la radice
  esportata (mai `-k`). Lo script copia **solo il certificato pubblico** (mai la chiave) in
  `/etc/arenalive/ca-pubblica/arenalive-ca.crt`, lo rende scaricabile da `https://<DOMINIO_PORTALE>/arenalive-ca.crt`
  (solo in questa modalità) e stampa nel riepilogo l'impronta SHA-256. I cookie restano `Secure` (c'è HTTPS).
- **Hostname dei clienti: certificato «on demand»** (vale in entrambe le modalità). Gli hostname di `ARENALIVE_HOSTNAMES`
  (portale e `ALTRI_HOSTNAME`) ottengono il certificato all'avvio. Per **qualunque altro hostname** Caddy lo chiede alla prima
  connessione HTTPS, ma solo dopo aver chiesto al server `GET http://server:8090/internal/tls/ask?domain=<host>`: risponde 200
  se l'hostname è assegnato a un cliente in «Clienti», 404 (o 400, 429) altrimenti, e allora non c'è certificato (con
  `interno` si usa `tls internal { on_demand }`). Così non si possono far emettere certificati per nomi arbitrari. La rotta è
  interna: nginx non la inoltra (`docs/server.md`, «Certificati on demand per gli hostname dei clienti»). Il **primo accesso**
  a un dominio nuovo richiede qualche secondo, il tempo di emettere il certificato; servono DNS pubblico verso il server e
  porte 80 e 443 aperte. Ogni altro hostname in HTTP è reindirizzato a HTTPS (308; le verifiche HTTP-01 di Let's Encrypt
  sono risposte da Caddy prima del redirect).
- **Passare da `interno` a `letsencrypt`**: imposta `CERTIFICATI="letsencrypt"`, compila `EMAIL_LETSENCRYPT`, usa hostname con
  DNS pubblico e rilancia `installa-produzione.sh`: riallinea `ARENALIVE_TLS_MODE`, `ACME_EMAIL`, `PUBLIC_BASE_URL` e `CORS_ORIGIN` nel `.env` (questi due derivano da `DOMINIO_PORTALE` e si rimettono a ogni esecuzione), riavvia Caddy, che
  chiede i certificati pubblici e smette di servire la radice. Il passo inverso funziona allo stesso modo. Dopo il passaggio la
  radice interna non serve più e si può togliere dai PC.

#### Radice della CA interna su Windows (agente e browser)
L'agente Windows (`apps/agent-dotnet`) valida il certificato TLS e **non va indebolito**: con la CA interna la radice va
installata in «Autorità di certificazione radice attendibili» del **computer**. Stessa cosa per Chrome e Edge su Windows, che
usano quell'archivio (Firefox ha il suo; sui telefoni la radice si installa a mano dalle impostazioni, oppure si accetta
l'avviso). Prima si confronta l'impronta con quella del riepilogo dello script. PowerShell **come amministratore**:
```powershell
# --- variabili ---
$UrlRadice = "https://realtime.local/arenalive-ca.crt"   # indirizzo del portale + /arenalive-ca.crt (il PC deve risolvere il nome, es. dal file hosts)
$FileRadice = ""                                           # in alternativa un file già copiato sul PC (es. C:\Temp\arenalive-ca.crt); se compilato, l'URL non si usa
$ImprontaAttesa = "<impronta SHA-256 dal riepilogo dello script>"   # con o senza i due punti, maiuscole o minuscole

# --- comandi ---
$ErrorActionPreference = "Stop"
if ($ImprontaAttesa -like "*<*") { throw "Compila ImprontaAttesa con l'impronta stampata dallo script." }
if ($FileRadice -eq "") {
    $FileRadice = Join-Path $env:TEMP "arenalive-ca.crt"
    # Il download avviene prima di fidarsi della radice: serve solo a ottenere il file, la fiducia dipende dall'impronta controllata sotto.
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        Invoke-WebRequest -Uri $UrlRadice -OutFile $FileRadice -SkipCertificateCheck
    } else {
        # Windows PowerShell 5.1: controllo disattivato solo per questa richiesta e subito ripristinato.
        [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        try {
            Invoke-WebRequest -Uri $UrlRadice -OutFile $FileRadice -UseBasicParsing
        } finally {
            [Net.ServicePointManager]::ServerCertificateValidationCallback = $null
        }
    }
}
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($FileRadice)
$impronta = (Get-FileHash -Algorithm SHA256 -InputStream ([IO.MemoryStream]::new($cert.RawData))).Hash
$atteso = ($ImprontaAttesa -replace "[:\s]", "").ToUpper()
if ($impronta -ne $atteso) {
    throw "Impronta diversa dall'attesa ($impronta): non importo il certificato."
} else {
    Import-Certificate -FilePath $FileRadice -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Write-Host "Radice importata: $($cert.Subject) (SHA-256 $impronta)"
}
```
Dopo l'import si riavvia l'agente e il browser. Per rimuoverla: `Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq "<thumbprint>" | Remove-Item`.

### 3. Primo avvio, chiave di deploy e rilancio
Lo script è **idempotente**: se si ferma, risolto il problema si rilancia e riparte senza rifare ciò che è fatto. Fa: controlli
del sistema, pacchetti e aggiornamenti di sicurezza automatici (senza riavvio), Docker ufficiale (impronta della chiave
verificata), utente di servizio, firewall `ufw` (SSH, 80, 443), fuso orario, clone del codice, `.env`, servizi systemd, poi
chiama `aggiorna-produzione.sh` (build e avvio) e verifica l'HTTPS.

Con un repository SSH privato il **primo avvio si ferma** al clone e stampa una chiave pubblica. Aggiungila su GitHub:
repository > **Settings > Deploy keys > Add deploy key**, incollando la chiave e **lasciando deselezionato «Allow write
access»** (sola lettura). Poi rilancia lo stesso comando del passo 2: il clone riesce e l'installazione prosegue. La prima
build richiede diversi minuti. Il registro è in `/var/log/arenalive-installazione.log`.

### 4. Password del superadmin e primo accesso
Se `ADMIN_PASSWORD` era vuota, la password generata compare **una sola volta** nel riepilogo finale dello script (non è nel
registro); resta anche nel `.env` (`CARTELLA_INSTALLAZIONE/.env`, permessi 600, `ADMIN_PASSWORD`). Se la prima esecuzione si ferma prima del
riepilogo la password viene mostrata alla prima esecuzione che arriva in fondo. Dopo il riepilogo esiste la marca
`/etc/arenalive/superadmin-mostrato`: le esecuzioni successive non generano né mostrano nessuna nuova password (il
superadmin esiste già; il server lo crea solo se non ce n'è nessuno). Si accede a
`https://<DOMINIO_PORTALE>/admin` con `ADMIN_EMAIL` e quella password. Al primo accesso:
1. cambia la password: il superadmin vede «Utenti» solo dentro un cliente («Entra nel cliente» da «Clienti»); lì, accanto
   al tuo utente, c'è «Cambia password» (in alternativa usa «Password dimenticata?» dopo aver configurato la posta);
2. configura la posta in «Posta» (`docs/server.md`) per inviti e recupero password;
3. crea il primo cliente in «Clienti» con i suoi hostname (passo 7).

### 5. Aggiornamenti e rollback
```bash
# --- variabili ---
CARTELLA_INSTALLAZIONE="/opt/arenalive"   # la stessa dell'installazione
RIFERIMENTO="main"                           # ramo o tag da installare (GitHub, «Branches» o «Tags»)

# --- comandi ---
sudo "$CARTELLA_INSTALLAZIONE/scripts/aggiorna-produzione.sh" "$RIFERIMENTO"
```
**Aggiornare a una release**: `RIFERIMENTO="v1.0.0"` (il tag creato da `scripts/rilascia.sh --tagga`,
`docs/regole/test-job-rilasci.md`). Lo script scarica anche i tag, mostra `release: <tag>` (o «nessun tag» se installa un
ramo) e passa ai build Docker il commit corto (`ARENALIVE_COMMIT`, perché nei build non c'è `.git`; `docker-compose.yml` lo
inoltra come build arg di `server` e `web`, vuoto se manca). Dopo l'aggiornamento `GET /api/health` mostra `version` e
`commit`, e il portale la versione in fondo al menu. Per tornare a una release precedente basta rilanciare con il suo
tag (le migrazioni del database non tornano indietro: vedi sotto).
Senza argomento usa `REPO_RIFERIMENTO` di `/etc/arenalive/produzione.conf`. Passi (registro
`/var/log/arenalive-aggiornamento.log`): 1) backup `pre-aggiornamento`, 2) scarica ramo o tag, 3) build e avvio (le
migrazioni del database girano all'avvio del server), 4) attesa che `postgres`, `server` e `web` siano «healthy» e che
`/api/health` risponda (fino a `ATTESA_SALUTE_SECONDI`, default 300), 5) pubblica l'agente (passo 8). A aggiornamento riuscito
libera il disco (`docker image prune -f` e cache di build più vecchia di 7 giorni). Un solo aggiornamento alla volta (lock).

**Rollback automatico e suoi limiti.** Se la nuova versione non diventa sana lo script torna al commit precedente,
ricostruisce e riavvia, e lo dice. Ma **il database non torna indietro**: le migrazioni già applicate dalla nuova versione
restano. Se la versione precedente non è sana (messaggio «ERRORE GRAVE») o i dati sono danneggiati, si ripristina dal backup
`…-pre-aggiornamento` (passo 6). Alla prima installazione non c'è nulla a cui tornare e il backup è saltato.

### 6. Backup e ripristino
- **Quando**: ogni giorno alle 03:30 (con ritardo casuale fino a 15 minuti) dal timer `arenalive-backup.timer`; a mano con
  `sudo systemctl start arenalive-backup.service`; in più prima di ogni aggiornamento.
- **Dove**: `CARTELLA_BACKUP` (default `/var/backups/arenalive`, cartella 700, file 600, solo root).
- **Cosa**, con la stessa data nel nome: `arenalive-db-<data>.dump` (database, formato `pg_dump -Fc`, verificato prima di essere
  tenuto), `arenalive-assets-<data>.tar.gz` (immagini dei clienti), `arenalive-env-<data>` (il `.env`). Il `.env` serve: senza
  `SETTINGS_ENCRYPTION_KEY` e `SHARE_CODE_SECRET` un ripristino perde la password della posta e i QR stampati. Quelli
  prima di un aggiornamento hanno `-pre-aggiornamento` nel nome.
- **Quanti**: gli ultimi `BACKUP_DA_TENERE` (default 14) per ciascun tipo; i più vecchi si cancellano.
- **Avvertenza**: i backup stanno **sullo stesso server**. Se il disco si rompe o il server sparisce si perdono insieme ai
  dati, e contengono i segreti. **Copiali ogni tanto fuori dal server**, in un posto protetto.

Ripristino (fermano il portale per qualche minuto):
```bash
# --- variabili ---
CARTELLA_INSTALLAZIONE="/opt/arenalive"      # dove sta il codice con il .env
CARTELLA_BACKUP="/var/backups/arenalive"     # dove sono i backup
DATA_BACKUP="<data-e-ora del backup, es. 20261018-033000 o 20261018-101500-pre-aggiornamento>"  # parte del nome dopo «arenalive-db-» (ls CARTELLA_BACKUP)
RIPRISTINA_ENV="no"                             # "si" solo se il .env è perso: sovrascrive quello attuale con il salvato
NOME_PROGETTO="arenalive"                    # nome del progetto compose (volume «<nome>_assets»)

# --- comandi ---
set -Eeuo pipefail
[[ "$DATA_BACKUP" != *"<"* ]] || { echo "Compila DATA_BACKUP"; exit 1; }
cd "$CARTELLA_INSTALLAZIONE"
for f in "arenalive-db-$DATA_BACKUP.dump" "arenalive-assets-$DATA_BACKUP.tar.gz" "arenalive-env-$DATA_BACKUP"; do
    [[ -f "$CARTELLA_BACKUP/$f" ]] || { echo "Manca $CARTELLA_BACKUP/$f"; exit 1; }
done
if [[ "$RIPRISTINA_ENV" == "si" ]]; then
    install -m 0600 -o "$(stat -c %U .env 2>/dev/null || echo root)" "$CARTELLA_BACKUP/arenalive-env-$DATA_BACKUP" .env
fi
DB_UTENTE="$(grep -E '^POSTGRES_USER=' .env | tail -n 1 | cut -d= -f2-)"; DB_UTENTE="${DB_UTENTE:-arenalive}"
DB_NOME="$(grep -E '^POSTGRES_DB=' .env | tail -n 1 | cut -d= -f2-)"; DB_NOME="${DB_NOME:-arenalive}"
docker compose up -d postgres
docker compose stop caddy web server
docker compose exec -T postgres pg_restore -U "$DB_UTENTE" -d "$DB_NOME" --clean --if-exists --no-owner \
    <"$CARTELLA_BACKUP/arenalive-db-$DATA_BACKUP.dump"
IMMAGINE_PG="$(docker inspect -f '{{.Config.Image}}' "$(docker compose ps -q postgres)")"
docker run --rm -i --entrypoint sh -v "${NOME_PROGETTO}_assets:/dati" "$IMMAGINE_PG" \
    -c 'find /dati -mindepth 1 -delete && tar -xzf - -C /dati' <"$CARTELLA_BACKUP/arenalive-assets-$DATA_BACKUP.tar.gz"
docker compose up -d
echo "Ripristino completato. Controlla: docker compose ps"
```
Su un server nuovo si installa prima con `installa-produzione.sh` e poi si ripristina con `RIPRISTINA_ENV="si"`.

#### Migrare i dati dalla vecchia produzione (`scripts/ripristina-produzione.sh`)
Caso del 2026-10-20: la produzione di ArenaLive è nata **sullo stesso server** (`185.105.208.42`) della vecchia
(`rt.istante.info` e `sir.istante.info`), con portale admin `admin.arenalive.studio`, cliente SIR `sir.arenalive.studio` e
Let's Encrypt (stessa email ACME). Il nuovo stack ha nomi diversi (cartelle, progetto compose, utente di servizio, database),
quindi non si ripristina con lo script del passo 6 ma con `ripristina-produzione.sh`, che porta nella nuova installazione
i dati della vecchia: dump del database, immagini e i soli segreti che servono ai dati. Procedura:
1. **Sul vecchio**: fai un backup (`sudo systemctl start sir-backup.service`, o lo script di backup della vecchia
   installazione) e copia dalla sua cartella dei backup, con la stessa data, il `.dump` del database, l'archivio `.tar.gz`
   delle immagini e il file `.env` salvato (nel vecchio sistema i file si chiamavano `sir-db-…`, `sir-assets-…`, `sir-env-…`).
2. **Copia i tre file** sul server nuovo (stessa macchina: una cartella fuori dal repository, es. `/root/vecchia/`, permessi
   600). Contengono segreti: vanno cancellati a migrazione finita.
3. **Installa il nuovo** con `installa-produzione.sh` (passo 2), con `DOMINIO_PORTALE="admin.arenalive.studio"`,
   `ALTRI_HOSTNAME="sir.arenalive.studio"`, `CERTIFICATI="letsencrypt"` e la stessa `EMAIL_LETSENCRYPT`; i record DNS A (e AAAA)
   dei due nomi devono già puntare al server.
4. **Ripristina**: compila il blocco variabili di `scripts/ripristina-produzione.sh` e lancialo come root (sotto).

Variabili del blocco in alto dello script:

| Variabile | Cosa mette | Default |
|---|---|---|
| `DUMP_DATABASE` | dump `pg_dump -Fc` della vecchia produzione | da compilare |
| `ARCHIVIO_IMMAGINI` | `tar.gz` del vecchio volume delle immagini | da compilare |
| `ENV_VECCHIO` | `.env` della vecchia produzione (backup `sir-env-…`); vuoto = non riporta i segreti | da compilare |
| `HOSTNAME_DA_CAMBIARE` | coppie `vecchio=nuovo` separate da spazio (hostname salvati nei clienti); vuoto = nessun cambio | `rt.istante.info=admin.arenalive.studio sir.istante.info=sir.arenalive.studio` |
| `SEGRETI_DA_RIPORTARE` | chiavi del vecchio `.env` da copiare nel nuovo | `SHARE_CODE_SECRET SETTINGS_ENCRYPTION_KEY` |
| `CONFERMA` | `si` = sovrascrive davvero database e immagini della nuova installazione | `no` |
| `CONFIG_SISTEMA` | file scritto dall'installazione; se leggibile lo script lo carica (prevale sulle variabili omonime) | `/etc/arenalive/produzione.conf` |
| `CARTELLA_INSTALLAZIONE`, `NOME_PROGETTO` | codice con `.env`; progetto compose (volume `<nome>_assets`) | `/opt/arenalive`, `arenalive` |
| `ATTESA_SALUTE_SECONDI`, `LOG` | attesa massima dello stato «healthy»; registro | `300`, `/var/log/arenalive-ripristino.log` |

I sette passi dello script (si ferma al primo errore; senza `CONFERMA="si"`, senza i file o con hostname non validi non
tocca nulla):
1. avvia `postgres`, controlla che il dump sia leggibile da `pg_restore -l` e fa un **backup della nuova installazione**
   (`backup-produzione.sh pre-ripristino`) se c'era già qualcosa;
2. ferma `caddy`, `web` e `server` (resta solo il database);
3. **ricrea il database** (`DROP DATABASE … WITH (FORCE)`, `CREATE DATABASE` con l'utente del `.env`) e ripristina il dump con
   `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction`: il vecchio utente e il vecchio nome del
   database («sir») non servono;
4. sostituisce gli hostname dei clienti in `tenants.hostnames` per ogni coppia di `HOSTNAME_DA_CAMBIARE` e stampa
   l'elenco `slug, name, hostname`;
5. svuota il volume `<NOME_PROGETTO>_assets` e vi estrae l'archivio delle immagini (mantiene il proprietario del volume);
6. se `ENV_VECCHIO` è compilato, salva `.env.pre-ripristino-<data>` e copia nel nuovo `.env` i segreti di
   `SEGRETI_DA_RIPORTARE`: **`SHARE_CODE_SECRET`** (senza, i QR e i link brevi stampati non funzionano più) e
   **`SETTINGS_ENCRYPTION_KEY`** (senza, la password della posta salvata non si decifra); vuoto, li lascia nuovi e lo dice;
7. `docker compose up -d` (le migrazioni girano all'avvio del server) e attende che `postgres`, `server` e `web` siano
   «healthy» e che `/api/health` risponda; altrimenti stampa gli ultimi log del server ed esce con errore.

```bash
# --- variabili (stesse del blocco in alto di scripts/ripristina-produzione.sh: si compila il file, non l'ambiente) ---
CARTELLA_INSTALLAZIONE="/opt/arenalive"   # dove sta il codice sul server nuovo
DOMINIO_PORTALE="admin.arenalive.studio"  # come in installa-produzione.sh

# --- comandi ---
cd "$CARTELLA_INSTALLAZIONE"
sudo nano scripts/ripristina-produzione.sh    # compila DUMP_DATABASE, ARCHIVIO_IMMAGINI, ENV_VECCHIO e CONFERMA="si"
sudo bash scripts/ripristina-produzione.sh
curl -fsS "https://$DOMINIO_PORTALE/api/health"
```
Dopo: controlla dal browser i due portali e i link dei clienti, poi cancella i file copiati dalla vecchia produzione. Gli
**agenti** non vanno migrati (nessuno era installato) e l'etichetta HMAC dei codici brevi è rimasta quella di prima apposta,
perché i codici dei link ripristinati restino validi (`docs/server.md`).

### 7. Aggiungere l'hostname di un nuovo cliente
1. Crea il record DNS A (e AAAA) dell'hostname verso il server.
2. Nel portale, in «Clienti», assegna l'hostname al cliente (campo «Hostname», solo il nome senza `https://`).

Nessuno script da rilanciare: alla prima visita HTTPS Caddy chiede al server se l'hostname è di un cliente e, se sì, emette
il certificato (qualche secondo al primo accesso; vedi «Modalità dei certificati»). Se il certificato non arriva: controlla
che il DNS punti al server e le porte 80/443 siano aperte, che l'hostname sia scritto uguale (minuscolo, senza porta) nel
cliente, e leggi `docker compose logs caddy` (e `docker compose logs server` per il consenso: «certificato on demand consentito»).

Un hostname che nessun cliente elenca (e che non è in `ARENALIVE_HOSTNAMES`) non ottiene il certificato; uno elencato in
`ARENALIVE_HOSTNAMES` ma non assegnato risponde col cliente di `DEFAULT_TENANT_SLUG` (`docs/server.md`).

### 8. Agente scaricabile
`scripts/pubblica-agente-produzione.sh` costruisce l'agente C# per Windows **solo con Docker** (container temporaneo
dell'SDK .NET, rimosso a fine build; sul server non si installa .NET) e pubblica `arenalive-agent.exe` e `arenalive-agent.json` nella
cartella `AGENT_DOWNLOAD_HOST_DIR` del `.env` (default `/var/lib/<UTENTE_SERVIZIO>/downloads`), che il server legge in sola
lettura. Lo chiama `aggiorna-produzione.sh`; **ricostruisce solo se la versione cambia** (campo `version` del `package.json` alla
radice, la stessa del rilascio: l'agente esce quindi a ogni nuova release) o se i file mancano. Un suo errore non annulla l'aggiornamento.
```bash
# --- variabili ---
CARTELLA_INSTALLAZIONE="/opt/arenalive"   # la stessa dell'installazione
FORZA="--forza"                              # "--forza" = ricostruisce anche con versione invariata; vuoto = solo se cambia

# --- comandi ---
cd "$CARTELLA_INSTALLAZIONE"
sudo scripts/pubblica-agente-produzione.sh $FORZA
```

### 9. Log e controlli
```bash
# --- variabili ---
CARTELLA_INSTALLAZIONE="/opt/arenalive"   # la stessa dell'installazione
SERVIZIO="server"                            # server, web, postgres o caddy
DOMINIO_PORTALE="<dominio del portale>"      # come in installa-produzione.sh

# --- comandi ---
cd "$CARTELLA_INSTALLAZIONE"
sudo docker compose ps                                  # stato dei servizi (colonna Health)
sudo docker compose logs -f --tail 100 "$SERVIZIO"      # log di un servizio (a rotazione: 10 MB x 5 file)
curl -fsS "https://$DOMINIO_PORTALE/api/health"         # salute vista da fuori
sudo systemctl status arenalive.service arenalive-backup.timer
sudo tail -n 50 /var/log/arenalive-aggiornamento.log
sudo ufw status
```
Riavvio: `sudo systemctl restart arenalive.service` (lo stack riparte da solo anche al riavvio del server). **Caddy non
scrive access log** (e i suoi log di errore non contengono l'oggetto `request`, quindi nemmeno l'URI): nel percorso ci sono i token dei link (`/live/<token>`, `/l/<codice>`) che i log di nginx mascherano.
Se un certificato non arriva: `docker compose logs caddy` (di solito DNS non puntato o porte 80/443 chiuse; per un hostname
di un cliente anche hostname non assegnato in «Clienti», passo 7).
`aggiorna-produzione.sh` riavvia Caddy se `docker/Caddyfile` è cambiato (è montato come file singolo; i certificati restano nel volume).

### 10. File nuovi e variabili del `.env` di produzione
| File | A cosa serve |
|---|---|
| `scripts/installa-produzione.sh` | installa sistema, Docker, firewall, `.env`, servizi systemd; avvia lo stack |
| `scripts/aggiorna-produzione.sh` | backup, aggiornamento, verifica di salute, rollback del codice |
| `scripts/backup-produzione.sh` | backup con rotazione (timer systemd e prima degli aggiornamenti) |
| `scripts/pubblica-agente-produzione.sh` | costruisce e pubblica l'agente scaricabile |
| `scripts/ripristina-produzione.sh` | porta in una nuova installazione i dati della vecchia (database, immagini, segreti, hostname) |
| `docker/compose.produzione.yml` | sovrapposizione a `docker-compose.yml`: Caddy, nessuna porta di server e web, log a rotazione, sottoreti fisse `172.29.250.0/24` e `fd29:250::/64` (IPv6) |
| `docker/Caddyfile` | HTTPS automatico per `ARENALIVE_HOSTNAMES` (Let's Encrypt o CA interna, secondo `ARENALIVE_TLS_MODE`) e on demand per gli hostname dei clienti (`ask` al server), redirect 80 → 443, header HSTS, nessun access log |
| `docker/web.realip.conf` | nginx si fida di `X-Forwarded-For` solo dalla sottorete di Caddy (IP vero per rate limit) |
| `/etc/arenalive/produzione.conf` | impostazioni non segrete lette dagli script e da systemd |
| `arenalive.service`, `arenalive-backup.service`, `arenalive-backup.timer` | unit systemd (avvio automatico, backup 03:30) |

Il `.env` di produzione lo crea lo script (permessi 600) e **non lo sovrascrive mai**: aggiunge solo le variabili mancanti.
Segreti generati la prima volta: `POSTGRES_PASSWORD`, `SHARE_CODE_SECRET`, `SETTINGS_ENCRYPTION_KEY`.

| Variabile | Valore | Note |
|---|---|---|
| `COMPOSE_FILE` | `docker-compose.yml:docker/compose.produzione.yml` | rimessa a ogni esecuzione; fa sì che ogni `docker compose` usi la produzione |
| `COMPOSE_PROJECT_NAME` | `arenalive` | rimessa a ogni esecuzione; dà il nome ai volumi (`arenalive_assets`) |
| `ARENALIVE_HOSTNAMES` | elenco separato da virgole | rimessa a ogni esecuzione da `DOMINIO_PORTALE` e `ALTRI_HOSTNAME` (solo certificati richiesti all'avvio) |
| `ARENALIVE_TLS_MODE` | `CERTIFICATI` (`interno` o `letsencrypt`) | rimessa a ogni esecuzione |
| `ACME_EMAIL` | `EMAIL_LETSENCRYPT` (vuota ammessa con `interno`) | rimessa a ogni esecuzione |
| `CA_PUBBLICA_DIR` | `/etc/arenalive/ca-pubblica` | rimessa a ogni esecuzione; cartella della radice pubblica servita da Caddy (solo `interno`) |
| `AGENT_DOWNLOAD_HOST_DIR` | `/var/lib/<UTENTE_SERVIZIO>/downloads` | solo se manca; cartella dell'agente scaricabile |
| `PUBLIC_BASE_URL`, `CORS_ORIGIN` | `https://<DOMINIO_PORTALE>` | rimesse a ogni esecuzione; `PUBLIC_BASE_URL` costruisce i link di invito |
| `LEAGUE_CONTACT` | `https://<DOMINIO_PORTALE>` | solo se manca |
| `COOKIE_SECURE`, `TRUST_PROXY` | `true` | solo se mancano |
| `LEAGUE_SYNC`, `LOG_LEVEL`, `SESSION_TTL_HOURS` | `on`, `info`, `12` | solo se mancano |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | dallo script | scritte solo se una delle due manca |
| `POSTGRES_DB`, `POSTGRES_USER`, `SERVER_BIND`, `WEB_BIND` | `arenalive`, `arenalive`, `127.0.0.1`, `127.0.0.1` | solo se mancano (nessuna porta è pubblicata comunque) |

Dopo l'installazione le altre variabili del server (`docs/server.md`) si cambiano nel `.env` e si applicano con
`sudo systemctl restart arenalive.service`. Collegamenti: `docs/server.md` (variabili, «Agente scaricabile», «Posta»),
`docs/portale.md` (nginx, «Clienti»).

## Riferimenti
- `scripts/installa-produzione.sh`, `scripts/aggiorna-produzione.sh`, `scripts/backup-produzione.sh`,
  `scripts/pubblica-agente-produzione.sh`, `scripts/ripristina-produzione.sh`, `docker/compose.produzione.yml`, `docker/Caddyfile`, `docker/web.realip.conf`
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `tsconfig.base.json`, `packages/*/tsconfig.json`, `packages/*/tsconfig.build.json`
- `vitest.shared.ts`, `packages/*/vitest.config.ts`
- `eslint.config.js`, `.prettierrc`, `.editorconfig`
- `scripts/dast_zap.sh`, `scripts/dast/openapi.yaml`, `scripts/dast/zap-regole.tsv`
- `scripts/rilascia.sh` (rilascio e tag), `scripts/versione.mjs` e `scripts/scrivi-versione.mjs` (lettura e scrittura della versione), `scripts/ci_locale.sh`, `scripts/costruisci-agente.sh`, `scripts/costruisci-agente-dotnet.sh`, `.env.example`
- `docker-compose.yml`, `docker/server.Dockerfile`, `docker/web.Dockerfile`, `docker/web.nginx.conf`,
  `docker/web.nginx.main.conf`, `docker/web.security-headers.conf`, `.dockerignore`, `apps/server/vitest.config.ts`
- `tools/carico/src/cli.ts` (comandi `prova` e `dimensioni`), `spectators.ts` (processi degli spettatori), `metrics.ts`
- Sezioni che ne dipendono: `docs/dvw-parser.md`, `docs/simulatore.md`, `docs/server.md`, `docs/portale.md`,
  `docs/architettura.md`
