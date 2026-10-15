# Portale

## A cosa serve
`@sir/web` (`apps/web/`) è il portale di SIRRealtime: una applicazione a pagina singola (React, Vite, Tailwind 4,
ECharts) che mostra la partita in tempo reale. Ha due parti: la **pagina pubblica** `/live/:token`, raggiunta con un
link di condivisione e senza accesso, e l'**area riservata** `/admin` per chi gestisce partite, link, agenti e utenti.
Non calcola nulla: riceve dal server lo `MatchState` di `@sir/volley-stats` (`docs/statistiche.md`) e lo disegna.

## Come funziona

### Pagina pubblica `/live/:token` (`src/pages/LivePage.tsx`)
Un token che non rispetta `SHARE_TOKEN_PATTERN` (`@sir/shared`) mostra subito «Link non valido o scaduto», senza aprire
connessioni. Con un token valido la pagina si collega a `/ws/public/<token>` e mostra (`src/components/MatchView.tsx`):

| Blocco | Contenuto |
|---|---|
| Tabellone | punteggio del set, set vinti, pallino della battuta, parziali dei set, «Ultimo punto», «Serie in corso», «Timeout nel set», «Cambi nel set», «Vince» a partita finita |
| Andamento del set | vantaggio punto per punto, selettore «Set» |
| Confronto squadre | statistiche delle due squadre, selettore «Periodo» |
| Statistiche giocatori | tabella per squadra («Squadra») e per set («Set») |
| Mappe di campo | frecce partenza → arrivo di attacchi e battute; filtri «Squadra», «Fondamentale» (Attacco, Battuta), «Giocatore», «Valutazione» |
| Rotazioni | «Punti vinti e persi per posizione del palleggiatore» |

Nell'intestazione ci sono il pulsante «Schermo intero» (diventa «Esci da schermo intero») e il cambio tema.
La pagina pubblica non ha nessun collegamento all'area riservata.

**Modalità maxischermo.** Con `?tv=1` nell'URL, oppure dopo «Schermo intero», il layout riempie lo schermo senza
scorrimento: tabellone ingrandito, «Andamento del set» e «Confronto squadre» (compatto). Giocatori, mappe di campo e
rotazioni non compaiono. Se la Fullscreen API non è disponibile o fallisce, il pulsante attiva comunque il layout.

**Stati** (`src/components/LiveMatch.tsx`, `ConnectionBadge.tsx`, `StatusScreen.tsx`):

| Situazione | Messaggio |
|---|---|
| connessione in corso | «Connessione alla partita» (indicatore «Connessione…») |
| server giù o rete assente, senza dati | «Server non raggiungibile», con il numero del tentativo; la pagina si ricollega da sola |
| già mostrata una partita e connessione persa | i dati restano a video, l'indicatore passa a «Riconnessione…» |
| partita in corso e connessione attiva | l'indicatore mostra «In diretta» (solo mentre si gioca) |
| partita conclusa e connessione attiva | l'indicatore mostra «Risultato finale», in stile neutro |
| nessuna partita live | «Nessuna partita in corso»: la partita appare appena inizia, senza ricaricare |
| link revocato, scaduto o inesistente | «Link non valido o scaduto» (indicatore «Link non valido») |
| sessione admin terminata (solo area riservata) | «Sessione terminata» (indicatore «Sessione terminata») |
| errore del server sullo stato | riquadro «Aggiornamento non disponibile: …» sopra la partita |
| qualsiasi altro indirizzo | «SIRRealtime»: «Per seguire una partita apri il link che ti è stato inviato.» |

### Area riservata `/admin` (`src/pages/admin/`)
Prima si verifica la sessione («Verifica della sessione…»); senza sessione compare il login «Area riservata»
(email e password), se il server non risponde «Area riservata non disponibile» con «Riprova». La barra di navigazione:

| Voce | Percorso | Chi la vede | Contenuto |
|---|---|---|---|
| Partita live | `/admin/live` | admin e viewer | la partita live via `/ws/admin`, con gli stessi componenti della pagina pubblica |
| Partite | `/admin/partite`, `/admin/partite/:id` | admin e viewer | elenco delle partite ricevute e dettaglio (`MatchDetailSchema`: «Stato», «Righe di scout», «Versione», «Aggiornata») |
| Link pubblici | `/admin/link` | solo admin | «Nuovo link pubblico» (etichetta, partita o live, «Scadenza (facoltativa)»), «Link creati», «Revoca» |
| Agenti | `/admin/agenti` | solo admin | «Nuovo agente» («Crea token», mostrato una sola volta con «Copia config.json»), «Agenti», «Revoca» |
| Utenti | `/admin/utenti` | solo admin | «Nuovo utente» (email, password di almeno 12 caratteri, ruolo), «Utenti» |
| Esci | - | tutti | chiude la sessione |

Un **viewer** (ruolo «sola lettura») vede solo «Partita live» e «Partite»; gli indirizzi riservati agli admin lo
riportano a `/admin/live`. Il ruolo è mostrato accanto all'email («amministratore» o «sola lettura»); la vera
protezione è sempre nel server (`docs/server.md`).

### Connessione WebSocket (`src/lib/liveConnection.ts`, `useLiveSocket.ts`)
- `LiveConnection` tiene aperto il socket e, a ogni (ri)connessione, il server rimanda lo stato intero.
- **Backoff**: dopo una chiusura riprova dopo `backoffDelay` (1 s, raddoppia fino a 30 s, con variazione ±20%).
- **Nessuna riconnessione** su `4404` (link non valido: stato `invalid`) e `4401` (sessione terminata: `unauthorized`).
- **Sonda HTTP**: il browser nasconde il 404/401 dell'upgrade, quindi se il socket si chiude prima di aprirsi (o con
  `1008`) la connessione chiede `probe`: per il link pubblico `GET /api/public/<token>/state` (`probeShareToken`, 404 =
  link non valido), per l'area riservata `GET /api/auth/me` (401 = sessione terminata). Un errore di rete conta come «ok»
  e si riprova con il backoff.
- **Flag `probing`**: mentre la sonda è in corso nient'altro può riconnettere (nemmeno `retryNow`).
- **Versioni vecchie ignorate**: `applyMessage` scarta uno `state` della stessa partita con `version` non maggiore di
  quella a video e uno che `looksLikeMatchState` non riconosce (`src/lib/messages.ts`).
- Quando il browser torna online (evento `online`) si riconnette subito, a meno che il link sia già non valido.

### Dati e grafici
I dati vengono **solo** da `MatchState`: il portale non rifà calcoli di pallavolo. Le trasformazioni da stato a grafico
sono funzioni pure in `src/charts/` (`momentum.ts`, `compare.ts`, `players.ts`, `rotations.ts`, `zones.ts`, `options.ts`)
con test; i componenti ECharts passano da `EChart.tsx`. Le mappe di campo sono SVG (`CourtMap.tsx`) e mostrano le 14
traiettorie più frequenti.

### Tema e stile
Un solo tema: i token (colori, font, raggi) sono scritti **solo** in `src/styles/tokens.css`. Tailwind li legge con
`@theme` in `index.css`; ECharts li legge a runtime (`src/charts/theme.ts`, `usePalette.ts`) e si riadatta al cambio di
tema. Chiaro di default, scuro con `prefers-color-scheme` o con il cambio tema (`ThemeToggle`; scelta salvata in
`localStorage` con chiave `sir-theme`). Con `prefers-reduced-motion: reduce` niente animazioni nei grafici.

### Tooltip e `richSafe`
I tooltip di ECharts usano `renderMode: 'richText'` (`buildEchartsTheme`): sono disegnati nel canvas, senza HTML né stili
inline. Ogni testo che vi entra (nomi di squadre e giocatori) passa da `richSafe` (`src/charts/theme.ts`), che toglie
`{`, `}`, `|` (significato nel rich text di ECharts) e, per difesa in più, `<`, `>`, `&`.

### CSP rigida
`docker/web.security-headers.conf` imposta `Content-Security-Policy` **senza `unsafe-inline` e senza `unsafe-eval`**
(`script-src 'self'; style-src 'self'`), più `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (il token è
nell'URL), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` e `Permissions-Policy`. Per rispettarla:
- zod gira in modalità `jitless` (`z.config({ jitless: true })` in `src/main.tsx`), perché la modalità normale prova
  `new Function`, che sarebbe una violazione `unsafe-eval`;
- i tooltip sono nel canvas (sopra) e gli stili vengono da file della build, non da attributi `style` scritti a mano.

### Stub di `iconv-lite`
`@sir/shared` raggiunge il parser DVW attraverso gli schemi di ingest e il parser usa `iconv-lite`, che in un browser non
funziona (richiede il `Buffer` di Node). Il portale non legge file DVW, quindi in `vite.config.ts` l'alias `iconv-lite`
punta a `src/lib/iconv-browser.ts`, che lancia un errore se chiamato. Inoltre `treeshake.moduleSideEffects` scarta dal
bundle i pacchetti del monorepo non usati.

## Configurazione

### Sviluppo (`apps/web/vite.config.ts`)
- `vite dev` ascolta sulla porta **5173** (`strictPort`: se è occupata non ne cerca un'altra).
- Proxy verso il server: `/api` e `/ws` (con WebSocket) vanno a `SIR_SERVER_URL`, default `http://localhost:8090`. Il
  browser vede una sola origine, quindi cookie di sessione e controllo `Origin` funzionano con `CORS_ORIGIN` e
  `PUBLIC_BASE_URL` = `http://localhost:5173` (default del server, `docs/server.md`).
- Build: `pnpm --filter @sir/web build` scrive in `apps/web/dist`; ECharts ha un chunk a parte (`echarts`).

### Demo (`apps/web/scripts/demo.ts`)
Avvia in un solo processo un server con PGlite in memoria, un agente vero e il simulatore che suona una partita sintetica.
Tutto si perde con Ctrl+C. Variabili, tutte facoltative:

| Variabile | Default | Significato |
|---|---|---|
| `DEMO_SPEED` | `15` | accelerazione del simulatore (numero positivo, massimo 10000) |
| `DEMO_SEED` | `1` | seme della partita generata (intero da 0) |
| `DEMO_SETS` | `4` | numero di set: `3`, `4` o `5` |
| `DEMO_PORT` | `8090` | porta del server della demo (deve coincidere con `SIR_SERVER_URL` di vite) |
| `DEMO_ADMIN_EMAIL` | `admin@sir.local` | email dell'admin di prova |
| `DEMO_ADMIN_PASSWORD` | `password-demo-sir` | password dell'admin di prova (almeno 12 caratteri) |

L'admin di prova (`admin@sir.local` / `password-demo-sir`) esiste solo nel database in memoria della demo. La demo
usa `COOKIE_SECURE=false`, `CORS_ORIGIN` e `PUBLIC_BASE_URL` = `http://localhost:5173` e limiti di richieste molto alti.

### Docker
- `docker/web.Dockerfile`: stadio `build` (Node 24, `pnpm install --frozen-lockfile`, `pnpm --filter @sir/web build`),
  stadio `runtime` `nginxinc/nginx-unprivileged` (utente 101, porta 8080 nel container, healthcheck su `/healthz`).
- `docker/web.nginx.conf`: serve la SPA (ogni percorso non-file riceve `index.html`, senza cache; `/assets/` con cache
  immutabile), fa da proxy di `/api/` e `/ws/` verso `server:8090`, risponde a `/healthz`, accetta corpi fino a 3 MB
  (l'ingest dell'agente ne ammette 2 sul filo). Sovrascrive `X-Forwarded-For` con l'IP reale del client.
- `docker/web.security-headers.conf`: le intestazioni di sicurezza (sezione «CSP rigida»).
- Servizio `web` in `docker-compose.yml`: parte quando il server è sano, pubblica `${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}:8080`.
  Dietro compose, `CORS_ORIGIN` e `PUBLIC_BASE_URL` di default **seguono `WEB_PORT`** (`http://localhost:<WEB_PORT>`):
  con un dominio vero vanno impostati in `.env` (`https://…`). `TRUST_PROXY` vale `true` di default **solo perché il
  server sta dietro nginx**.
- **nginx è l'unico ingresso**: la porta 8090 del server è pubblicata solo su `127.0.0.1` (`SERVER_BIND`). Mai su
  `0.0.0.0`: con `TRUST_PROXY=true` un client che arriva diretto potrebbe inviare un `X-Forwarded-For` falso ed eludere il
  rate limit.
- **L'agente passa dal portale**: il suo `serverUrl` è l'URL del portale (es. `https://<host>/`) e invia a
  `<serverUrl>/api/ingest`, che nginx inoltra al server (`docs/agente.md`). Non serve esporre la 8090.

## Come si usa / si prova

### Demo in locale
Due terminali dalla radice del repository. Primo (server, agente e simulatore):

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
DEMO_SPEED="15"                          # accelerazione della partita simulata
DEMO_SEED="1"                            # seme della partita
DEMO_SETS="4"                            # set: 3, 4 o 5
DEMO_PORT="8090"                         # porta del server della demo
DEMO_ADMIN_EMAIL="admin@sir.local"       # email dell'admin di prova
DEMO_ADMIN_PASSWORD="password-demo-sir" # password dell'admin di prova, almeno 12 caratteri

# --- comandi ---
cd "$RADICE"
corepack enable
pnpm install
DEMO_SPEED="$DEMO_SPEED" DEMO_SEED="$DEMO_SEED" DEMO_SETS="$DEMO_SETS" DEMO_PORT="$DEMO_PORT" \
  DEMO_ADMIN_EMAIL="$DEMO_ADMIN_EMAIL" DEMO_ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD" \
  pnpm --filter @sir/web demo
```

La demo stampa l'indirizzo della pagina pubblica (`http://localhost:5173/live/<token>`), quello per il maxischermo
(`…?tv=1`) e dell'area riservata. Secondo terminale (il portale):

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
DEMO_PORT="8090"                         # la stessa porta usata dalla demo

# --- comandi ---
cd "$RADICE"
SIR_SERVER_URL="http://localhost:$DEMO_PORT" pnpm --filter @sir/web dev
```

Poi si apre `http://localhost:5173` nel browser, con l'indirizzo stampato dalla demo.

### Con Docker Compose
Variabili e comandi di `docker compose` sono in `docs/server.md`; il portale è su `http://localhost:8080` (o
`WEB_PORT`). Controllo: `http://localhost:8080/healthz` risponde `ok`.

### Comandi del pacchetto (`apps/web/package.json`)

| Comando | Cosa fa |
|---|---|
| `pnpm --filter @sir/web dev` | Vite in sviluppo su 5173 |
| `pnpm --filter @sir/web build` | build in `apps/web/dist` |
| `pnpm --filter @sir/web preview` | serve la build sulla 5173 |
| `pnpm --filter @sir/web demo` | demo (sopra) |
| `pnpm --filter @sir/web test` | `vitest run` (jsdom) |

### Collaudo del 2026-10-14
- **Compose**: `docker compose -p sirrealtime up -d --build` con `.env` da `.env.example` (`POSTGRES_PASSWORD`, `ADMIN_*`,
  `WEB_PORT=8085` perché la 8080 era occupata, `COOKIE_SECURE=false` in http locale). `postgres`, `server` e `web` healthy;
  health diretto e attraverso nginx, intestazioni di sicurezza, login, token agente e link pubblico (URL sulla porta del
  portale) funzionano.
- **Dal vivo su PostgreSQL attraverso nginx**: simulatore `play` (seed 7, 4 set, ×40, `atomic`, correzioni), agente in
  continuo e client WebSocket pubblico: 48 stati con versioni crescenti; lo stato finale pubblicato è identico a
  `computeMatchState(parseDvw(file finale))`.
- **Resistenza**: server fermato per 20 s a metà partita (simulatore `direct`): l'agente ha tenuto i dati in coda e li ha
  consegnati alla ripartenza, con stato finale identico.
- **Browser**: screenshot reali con Chromium headless pilotato via CDP: 360 px senza scroll orizzontale, 1440 px, tema
  scuro, `?tv=1` a 1920×1080, login admin. Nota pratica: `--window-size` di Chromium headless non scende sotto circa
  500 px; per il mobile serve `Emulation.setDeviceMetricsOverride`.

### Scansione DAST dello stack (`stackhawk-portale.yml`)
Come quella del solo server (`docs/server.md`), ma con host il portale (`APP_HOST`, default `http://localhost:8085`):
stessa specifica `stackhawk/openapi.yaml`, Ajax Spider con `seedPaths` `/admin` e `LIVE_PATH` (default
`/live/token-non-valido-per-la-scansione`: va dato il percorso di un link valido), token agente in `AGENT_AUTH_HEADER`,
login `admin@sir.local` / `SCAN_PASSWORD`, logout escluso, WebSocket non coperti. Nel `.env` locale vanno alzati i
`RATE_LIMIT_*` (es. 100000) e il servizio `server` ricreato. Esito: PASS, 25 URI raggiunti (API, `/admin`,
`/live/<token>`, asset), un solo risultato Low, già segnato come falso positivo (email nelle rotte autenticate), 0 errori
500 nei log.

### Da rifinire
- in `?tv=1` il confronto squadre viene tagliato in fondo a 1080 px;
- nella mappa di campo le frecce coprono le etichette delle zone.

## Riferimenti
- `apps/web/src/App.tsx` (rotte), `main.tsx` (zod jitless, tema), `pages/LivePage.tsx`, `pages/admin/*`
- `apps/web/src/lib/liveConnection.ts` (`LiveConnection`, `applyMessage`, `backoffDelay`), `useLiveSocket.ts`, `messages.ts`, `api.ts`, `theme.ts`, `iconv-browser.ts`
- `apps/web/src/components/` (`MatchView`, `LiveMatch`, `Scoreboard`, `MomentumChart`, `TeamComparison`, `PlayerTable`, `CourtMap`, `Rotations`)
- `apps/web/src/charts/` (trasformazioni pure, `theme.ts` con `buildEchartsTheme` e `richSafe`), `src/styles/tokens.css`
- `apps/web/vite.config.ts`, `apps/web/scripts/demo.ts`
- `docker/web.Dockerfile`, `docker/web.nginx.conf`, `docker/web.security-headers.conf`, `docker-compose.yml`, `.env.example`
- Contratti: `ServerMessageSchema`, `MatchStateSchema`, `MatchDetailSchema` in `packages/shared` (`docs/architettura.md`)
- `docs/server.md` (WebSocket, accessi, Docker), `docs/agente.md` (`serverUrl`), `docs/infrastruttura.md`, `docs/statistiche.md`, `docs/decisioni.md`
- Regole di interfaccia: `docs/regole/interfaccia.md`
