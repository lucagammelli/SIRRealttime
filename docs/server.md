# Server

## A cosa serve
`@sir/server` (`apps/server/`) è il backend di SIRRealtime. Riceve dall'agente le righe di scout DataVolley (ingest),
le salva in Postgres, ricalcola lo stato della partita con `@sir/dvw-parser` e `@sir/volley-stats` e lo spinge via
WebSocket ai client. Offre anche le API di amministrazione (agenti, link pubblici, utenti, partite) e l'accesso in sola
lettura tramite link pubblici. I contratti sono in `packages/shared` (vedi `docs/architettura.md`).

## Come funziona

### Ingest (`POST /api/ingest`, protocollo 1)
L'agente invia una richiesta `IngestRequest` (`packages/shared/src/ingest.ts`):

- `kind: 'append'`: aggiunge `lines` a partire da `fromIndex`, che deve essere uguale al numero di righe già salvate.
- `kind: 'snapshot'`: sostituisce tutte le righe (`fromIndex` 0, `header` obbligatorio).
- `seq`: cresce di almeno 1 a ogni richiesta della stessa `matchKey`.
- `contentHash`: sha256 esadecimale di tutte le righe risultanti unite con `"\n"` (`hashScoutLines`).
- `header`: testo del file DVW prima di `[3SCOUT]`.

Esiti (`IngestResponse`: `status`, `seq`, `lineCount`, `contentHash` facoltativo):

| `status` | Quando |
|---|---|
| `ok` | richiesta applicata (o righe e header identici a quelli già salvati: solo `seq` e agente aggiornati, nessun push) |
| `duplicate` | `seq` minore o uguale all'ultimo accettato: nessuna modifica, la risposta descrive lo stato del server |
| `needSnapshot` | `append` con `fromIndex` diverso da `lineCount`, header mai ricevuto, oppure `contentHash` diverso da quello calcolato dal server: l'agente deve rimandare uno `snapshot` |

Passi (`apps/server/src/ingest.ts`, `IngestService.ingest`), tutti in una transazione:

1. lock avvisorio `pg_advisory_xact_lock` (le ingest sono serializzate: una sola partita live, nessun deadlock);
2. riga `matches` creata se manca (per `matchKey`) e letta con `for update`;
3. controlli `duplicate` / `needSnapshot` (tabella sopra);
4. righe finali = precedenti + nuove (append) oppure solo le nuove (snapshot); se superano `MATCH_MAX_LINES` risposta 413
   (`MATCH_TOO_MANY_LINES`) e rollback;
5. verifica di `contentHash`; se non coincide `needSnapshot` (rollback);
6. scrittura delle sole righe cambiate: con `snapshot` si cancellano e si reinseriscono le righe dopo il prefisso comune;
7. ricostruzione del file con `buildDvwText(header, righe)` (header + `[3SCOUT]` + righe), poi `parseDvw` e
   `computeMatchState`: lo stato è **ricalcolato da zero a ogni ingest**;
8. la partita diventa la sola `live` (le altre vanno a `live = false`; indice univoco parziale `matches_one_live_idx`),
   `version` aumenta di 1, `state` è salvato;
9. dopo il commit lo stato intero (`StateMessage`) è inviato a tutti i client WebSocket che seguono la partita.

Una piccola cache in memoria (4 partite, verificata con `version` e `lineCount`) evita di rileggere tutte le righe a ogni
richiesta; la fonte di verità resta il database.

Corpo della richiesta: JSON, con `Content-Encoding: gzip` facoltativo (altri valori: 415). Limiti: 2 MB sul filo
(`INGEST_MAX_WIRE_BYTES`), 8 MB dopo la decompressione (`INGEST_MAX_DECODED_BYTES`, contro le zip bomb), massimo 5000
righe per richiesta (`INGEST_MAX_LINES`), 2000 caratteri per riga, header fino a 512 KB. Oltre il limite: 413.
Tutte le altre rotte accettano al massimo 64 KB. Una riga che apre una sezione DVW (`[3NOME]`) o contiene a capo è
rifiutata dallo schema.

### Accessi
- **Token agente**: segreto casuale da 256 bit (base64url) creato da un admin; si salva solo l'hash sha256. L'agente lo
  invia come `Authorization: Bearer <token>`; un token revocato è rifiutato (401). Aggiorna `lastSeenAt`.
- **Link pubblici** (`share_tokens`): token casuale in `/live/<token>` (URL composto con `PUBLIC_BASE_URL`). Se `matchId`
  è `null` il link **segue la partita live corrente**; con un `matchId` mostra quella partita fissa. `expiresAt`
  facoltativa. Un token non valido, revocato o scaduto dà sempre 404; la revoca chiude i WebSocket già aperti (codice
  4404). Nei log il token è mascherato (`/api/public/[token]`).
- **Sessioni admin e viewer**: login con email e password (argon2id) su `/api/auth/login`; cookie `sir_session`
  (`httpOnly`, `SameSite=Lax`, `Secure` secondo `COOKIE_SECURE`), durata `SESSION_TTL_HOURS`. Ruoli: `viewer` (vede le
  partite) e `admin` (tutto il resto). Le scritture dal browser (`POST`/`DELETE` su `/api/auth/*` e `/api/admin/*`)
  richiedono corpo JSON e, se presente, `Origin` uguale a `CORS_ORIGIN` (protezione CSRF). Il primo admin si crea
  all'avvio da `ADMIN_EMAIL` / `ADMIN_PASSWORD`, solo se non esiste nessun utente.
- Risposte d'errore: `{ "error": "<testo>" }` (`ApiErrorSchema`), mai stack trace.

### Endpoint

| Metodo | Percorso | Protezione | Ruolo |
|---|---|---|---|
| GET | `/api/health` | nessuna (verifica il database; 503 se non raggiungibile) | - |
| POST | `/api/ingest` | rate limit, poi token agente | agente |
| POST | `/api/auth/login` | rate limit login | - |
| POST | `/api/auth/logout` | rate limit admin | - (chiude i WebSocket della sessione) |
| GET | `/api/auth/me` | sessione | viewer |
| GET | `/api/public/:token/state` | link pubblico (404 se non valido) | - |
| GET | `/api/admin/matches` | sessione | viewer |
| GET | `/api/admin/matches/:id` | sessione | viewer |
| POST | `/api/admin/agents` | sessione | admin |
| GET | `/api/admin/agents` | sessione | admin |
| DELETE | `/api/admin/agents/:id` | sessione | admin |
| POST | `/api/admin/share-tokens` | sessione | admin |
| GET | `/api/admin/share-tokens` | sessione | admin |
| DELETE | `/api/admin/share-tokens/:id` | sessione | admin |
| POST | `/api/admin/users` | sessione | admin |
| GET | `/api/admin/users` | sessione | admin |
| GET (WebSocket) | `/ws/public/:token` | link pubblico | - |
| GET (WebSocket) | `/ws/admin` | sessione + controllo `Origin` | viewer |

La creazione di agenti e link restituisce 201 con il token in chiaro **una sola volta** (`CreateAgentResponse`,
`CreateShareTokenResponse` con `url`). `DELETE` revoca (204), non cancella. `expiresAt` deve essere nel futuro e
`matchId`, se dato, deve esistere (altrimenti 400). La lista partite ha al massimo 200 elementi, ordinati per
aggiornamento. Una email già presente dà 409; la password ha almeno 12 caratteri.

### WebSocket
Messaggi server→client (`ServerMessage`):

- `state`: `{ type, matchId, version, state }`, stato intero; inviato alla connessione e a ogni aggiornamento. Uno stato
  con `version` non maggiore dell'ultimo inviato per la stessa partita è saltato.
- `noMatch`: nessuna partita disponibile (link "live" senza partita live).
- `error`: `{ type, message }`, ad esempio se lo stato iniziale non è leggibile.

Il client non deve inviare nulla (payload massimo 4 KB). Codici di chiusura: `4401` sessione admin terminata (logout o
scadenza), `4404` link pubblico revocato o scaduto, `1008` richiesta senza credenziali valide dopo l'upgrade, `1001`
arresto del server. `/ws/admin` rifiuta (403) un `Origin` diverso da `CORS_ORIGIN`, perché CORS non vale per i WebSocket.
Un client con più di 1 MB ancora da inviare è disconnesso subito (troppo lento). L'heartbeat gira ogni 30 s: manda un
ping, disconnette chi non ha risposto al precedente e chiude i client con credenziale scaduta o revocata.
`/ws/admin` segue sempre la partita live.

### Rate limit
Per indirizzo IP e per minuto. Default (`DEFAULT_RATE_LIMITS`, `apps/server/src/context.ts`), modificabili con le variabili
`RATE_LIMIT_LOGIN`, `RATE_LIMIT_INGEST`, `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_ADMIN`: login 10, ingest 600, rotte
pubbliche 120, rotte admin 300 (incluse `/api/auth/logout`, `/api/auth/me`, `/ws/admin`). Oltre il limite: 429.
**L'autenticazione arriva dopo il rate limit**: i controlli con un costo (token agente, Origin, tipo del corpo) stanno in
`preParsing`/`preValidation`/`preHandler`, così anche le richieste rifiutate sono contate. Dietro un reverse proxy serve
`TRUST_PROXY=true`, altrimenti tutti i client condividono l'IP del proxy.

### Validazione delle stringhe
Helper in `packages/shared/src/strings.ts` (`hasNoNul`, `hasNoControlChars`, `containsNul`, `safeString`, `plainText`):

- il carattere NUL è rifiutato ovunque con 400, perché PostgreSQL non lo può salvare: dagli schemi (password,
  righe e header DVW) e anche da un hook `preValidation` globale (`rejectNulBody` in `apps/server/src/security.ts`,
  registrato in `app.ts`) che controlla ogni corpo JSON, chiavi comprese;
- i caratteri di controllo U+0000-U+001F e U+007F sono rifiutati in email, nome dell'agente ed etichetta del link;
- le righe di scout ammettono il tab ma non NUL, `\r` e `\n`; l'header DVW ammette il tab (e gli a capo, è un testo
  su più righe) ma non NUL;
- l'email del login è ripulita dagli spazi (`trim`) prima del confronto.

Altre protezioni: intestazioni di sicurezza `@fastify/helmet`, CORS solo per `CORS_ORIGIN` (metodi GET, POST, DELETE),
log pino con cookie, `Authorization`, password e token oscurati.

## Configurazione
Variabili d'ambiente lette da `apps/server/src/config.ts` (`loadConfig`) e riportate in `.env.example`. Una variabile
vuota vale come assente. Se qualcuna non è valida l'avvio fallisce e il messaggio elenca solo i nomi, mai i valori.

| Variabile | Default | Significato |
|---|---|---|
| `DATABASE_URL` | obbligatoria | `postgres://…`, oppure `pglite:memory` / `pglite:<cartella>` (solo sviluppo e test) |
| `PORT` | `8090` | porta HTTP |
| `HOST` | `127.0.0.1` | indirizzo di ascolto (`0.0.0.0` nel container) |
| `CORS_ORIGIN` | `http://localhost:5173` | unica origine ammessa da CORS e dal controllo `Origin` |
| `COOKIE_SECURE` | `true` | cookie con attributo `Secure` (`false` solo in sviluppo su http) |
| `SESSION_TTL_HOURS` | `12` | durata della sessione (massimo 720) |
| `ADMIN_EMAIL` | assente | primo admin; va impostata insieme a `ADMIN_PASSWORD` |
| `ADMIN_PASSWORD` | assente | almeno 12 caratteri |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | base dei link pubblici `<base>/live/<token>` |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `TRUST_PROXY` | `false` | `true` solo dietro un reverse proxy fidato |
| `RATE_LIMIT_LOGIN` | `10` | richieste al minuto per IP su `/api/auth/login` (intero da 1 a 100000) |
| `RATE_LIMIT_INGEST` | `600` | richieste al minuto per IP su `/api/ingest` (intero da 1 a 100000) |
| `RATE_LIMIT_PUBLIC` | `120` | richieste al minuto per IP sulle rotte pubbliche (intero da 1 a 100000) |
| `RATE_LIMIT_ADMIN` | `300` | richieste al minuto per IP sulle rotte admin (intero da 1 a 100000) |
| `MATCH_MAX_LINES` | `20000` | righe scout massime per partita (massimo 1.000.000); oltre, 413 |

Le quattro `RATE_LIMIT_*` sono anche in `.env.example` e `docker-compose.yml`.

Variabili solo per Docker Compose: `POSTGRES_DB` (`sir`), `POSTGRES_USER` (`sir`), `POSTGRES_PASSWORD` (obbligatoria),
`SERVER_BIND` (`127.0.0.1`).

### Database
Schema in `apps/server/src/db/schema.ts` (Drizzle):

| Tabella | Contenuto |
|---|---|
| `users` | `email` (minuscola, unica), `password_hash` (argon2id), `role` (`admin`/`viewer`) |
| `sessions` | `token_hash` (sha256 del cookie), `user_id`, `expires_at` |
| `agents` | `name`, `token_hash`, `revoked`, `last_seen_at` |
| `matches` | `match_key` (unica), `header`, `line_count`, `content_hash`, `last_seq`, `agent_id`, `live`, `state` (jsonb), `version` |
| `scout_lines` | `match_id`, `idx`, `text` (chiave primaria `match_id` + `idx`) |
| `share_tokens` | `token_hash`, `match_id` (null: segue la live), `label`, `expires_at`, `revoked` |

Le migrazioni generate (`pnpm --filter @sir/server db:generate`) stanno in `apps/server/drizzle` e sono applicate
all'avvio (`database.migrate()` in `src/main.ts`). Il driver dipende da `DATABASE_URL` (`src/db/index.ts`,
`createDatabase`): `pg` per `postgres://…`, PGlite per `pglite:`. I token sono salvati solo come hash sha256.

## Come si usa / si prova

### Sviluppo con PGlite in memoria
Il database in memoria si perde a ogni riavvio. Primo terminale:

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
ADMIN_EMAIL_DEV="admin@example.com"      # email del primo admin (creato all'avvio)
ADMIN_PASSWORD_DEV="password-di-prova-1" # almeno 12 caratteri

# --- comandi ---
cd "$RADICE"
corepack enable
pnpm install
DATABASE_URL="pglite:memory" COOKIE_SECURE="false" \
  ADMIN_EMAIL="$ADMIN_EMAIL_DEV" ADMIN_PASSWORD="$ADMIN_PASSWORD_DEV" \
  pnpm --filter @sir/server dev
```

Secondo terminale (login con cookie, token agente, link pubblico, stato):

```bash
# --- variabili ---
SERVER="http://127.0.0.1:8090"           # indirizzo del server (PORT di default 8090)
ADMIN_EMAIL_DEV="admin@example.com"      # la stessa email usata all'avvio
ADMIN_PASSWORD_DEV="password-di-prova-1" # la stessa password usata all'avvio
COOKIE_JAR="/tmp/sir-cookie.txt"         # file dove curl salva il cookie di sessione

# --- comandi ---
curl -s -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL_DEV\",\"password\":\"$ADMIN_PASSWORD_DEV\"}" \
  "$SERVER/api/auth/login"

# token agente: la risposta contiene "token", mostrato una sola volta
curl -s -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d '{"name":"PC scout"}' "$SERVER/api/admin/agents"

# link pubblico che segue la partita live, senza scadenza: la risposta contiene "token" e "url"
curl -s -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d '{"label":"Tribuna","matchId":null,"expiresAt":null}' "$SERVER/api/admin/share-tokens"
```

Per leggere lo stato con il link ottenuto, in un terzo comando:

```bash
# --- variabili ---
SERVER="http://127.0.0.1:8090"   # indirizzo del server
TOKEN_PUBBLICO="<token>"         # campo "token" della risposta di /api/admin/share-tokens

# --- comandi ---
curl -s "$SERVER/api/public/$TOKEN_PUBBLICO/state"   # {"type":"noMatch"} finché nessuna partita è live
```

Il token agente va nell'intestazione `Authorization: Bearer <token>` di `POST /api/ingest` (l'agente non è ancora
scritto: per esempi di richieste complete vedere `apps/server/test/ingest.test.ts`).

### Comandi del pacchetto (`apps/server/package.json`)

| Comando | Cosa fa |
|---|---|
| `pnpm --filter @sir/server dev` | `tsx watch --conditions=@sir/source src/main.ts` (legge i sorgenti) |
| `pnpm --filter @sir/server build` | compila in `dist/` |
| `pnpm --filter @sir/server start` | `node dist/main.js` (serve la build) |
| `pnpm --filter @sir/server test` | `vitest run` con PGlite in memoria, non serve Postgres |
| `pnpm --filter @sir/server db:generate` | `drizzle-kit generate` dopo una modifica a `schema.ts` |

I test (`apps/server/test/`: `auth`, `config`, `hub`, `ingest`, `limits`, `public`) usano PGlite. Per la configurazione
di vitest vedi `docs/infrastruttura.md`.

### Docker Compose
`docker-compose.yml` (nome progetto `sir-realtime`) ha due servizi:

- `postgres` (immagine `postgres:17`, volume `pgdata`, healthcheck `pg_isready`);
- `server` (build da `docker/server.Dockerfile`, parte quando Postgres è sano, healthcheck su `/api/health`, porta
  `${SERVER_BIND:-127.0.0.1}:8090:8090`). `DATABASE_URL` è composta da `POSTGRES_*`; `HOST` è `0.0.0.0`.

```bash
# --- variabili (nel file .env alla radice, copiato da .env.example) ---
# POSTGRES_PASSWORD  obbligatoria: solo lettere, cifre, - e _ (entra nell'URL)
# ADMIN_EMAIL        primo admin
# ADMIN_PASSWORD     almeno 12 caratteri
# CORS_ORIGIN        origine del portale
# PUBLIC_BASE_URL    indirizzo pubblico del portale

# --- comandi ---
cd "/percorso/del/repository"   # radice del repository
cp .env.example .env            # poi compilare i valori sopra
docker compose up -d --build
docker compose logs -f server
docker compose down             # i dati restano nel volume pgdata
```

Stato della verifica: **Docker Compose non è ancora stato provato** (disco pieno durante lo sviluppo) e **PostgreSQL
vero non è ancora stato provato**: finora tutto è verificato con PGlite.

### Scansione di sicurezza (DAST)
Configurazione HawkScan (StackHawk) in `stackhawk.yml` alla radice; specifica OpenAPI in `stackhawk/openapi.yaml`,
**ricavata a mano dalle rotte**: va aggiornata quando si aggiungono o cambiano rotte. App StackHawk «SIRRealtime»,
ambiente `Development` (`APP_ID`, `APP_ENV`, `APP_HOST` hanno un default nel file).

- Target: server con PGlite in memoria e limiti `RATE_LIMIT_*` a 100000, per non falsare la scansione.
- Autenticazione: login JSON su `/api/auth/login` (campi `email` e `password`), cookie `sir_session`, prova su
  `/api/auth/me`; `/api/auth/logout` è escluso per non chiudere la sessione.
- Token agente: creato con `POST /api/admin/agents` e passato in `AGENT_AUTH_HEADER` (`Bearer <token>`), che il
  replacer mette nell'intestazione `Authorization` per raggiungere `/api/ingest`.
- I WebSocket (`/ws/public/:token`, `/ws/admin`) **non sono coperti** dalla scansione.

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
ADMIN_EMAIL_SCAN="admin@sir.local"       # email dell'admin di prova (default di SCAN_USERNAME in stackhawk.yml)
ADMIN_PASSWORD_SCAN="password-di-prova"  # password dell'admin di prova (default di SCAN_PASSWORD)
SERVER="http://localhost:8090"           # indirizzo del server (APP_HOST)
COOKIE_JAR="/tmp/sir-scan-cookie.txt"    # file dove curl salva il cookie di sessione
API_KEY="<chiave API>"                   # chiave API StackHawk dell'organizzazione, in HAWK_API_KEY

# --- avvio del server in un altro terminale ---
# cd "$RADICE/apps/server" && DATABASE_URL="pglite:memory" COOKIE_SECURE="false" \
#   ADMIN_EMAIL="$ADMIN_EMAIL_SCAN" ADMIN_PASSWORD="$ADMIN_PASSWORD_SCAN" CORS_ORIGIN="http://localhost:5173" \
#   RATE_LIMIT_LOGIN=100000 RATE_LIMIT_ADMIN=100000 RATE_LIMIT_PUBLIC=100000 RATE_LIMIT_INGEST=100000 pnpm dev

# --- comandi ---
cd "$RADICE"
curl -s -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL_SCAN\",\"password\":\"$ADMIN_PASSWORD_SCAN\"}" "$SERVER/api/auth/login" > /dev/null
TOKEN_AGENTE=$(curl -s -b "$COOKIE_JAR" -H "Content-Type: application/json" -d '{"name":"scansione"}' \
  "$SERVER/api/admin/agents" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
AGENT_AUTH_HEADER="Bearer $TOKEN_AGENTE"
docker run --rm --network host -v "$PWD:/hawk:rw" -e API_KEY="$API_KEY" -e AGENT_AUTH_HEADER="$AGENT_AUTH_HEADER" \
  stackhawk/hawkscan:latest scan --json-output stackhawk.yml
```

Esito del 2026-10-14: 3 scansioni, soglia PASS. Due risultati di gravità Low sono segnati come falsi positivi:

- «Information Leak - Email Address»: per progetto le rotte autenticate restituiscono l'email dell'utente in sessione
  (`/api/auth/me`, `/api/auth/login`), mentre l'elenco utenti e l'utente appena creato (`GET`/`POST /api/admin/users`)
  vanno solo all'admin;
- «Private IP Disclosure» su `GET /api/admin/agents`: l'IP era nel nome di un agente inserito dallo scanner stesso
  durante la scansione e poi restituito dall'elenco admin. Il server non espone nessun IP interno.

Un difetto vero è emerso dai log: un NUL in un corpo JSON dava 500. È corretto (400 con `rejectNulBody`, vedi
«Validazione delle stringhe») e verificato: 0 errori 500 nella scansione finale.

## Riferimenti
- `stackhawk.yml`, `stackhawk/openapi.yaml`
- `apps/server/src/main.ts` (avvio), `app.ts` (`buildApp`, plugin, gestione errori), `config.ts` (`loadConfig`),
  `context.ts` (limiti, cookie `sir_session`), `ingest.ts` (`IngestService`), `hub.ts` (`LiveHub`, codici di chiusura),
  `security.ts` (`requireRole`, `browserWriteGuard`, `sameOriginGuard`, `authenticateAgent`), `state.ts`, `seed.ts`
- Rotte: `src/routes/health.ts`, `ingest.ts`, `auth.ts`, `admin.ts`, `public.ts`
- Database: `src/db/schema.ts`, `src/db/index.ts` (`createDatabase`), `src/db/pglite.ts`, `apps/server/drizzle/`
- Contratti: `packages/shared/src/ingest.ts`, `messages.ts`, `admin.ts` (`docs/architettura.md`)
- Calcoli: `docs/dvw-parser.md`, `docs/statistiche.md`; simulatore: `docs/simulatore.md`
- Infrastruttura e Docker: `docs/infrastruttura.md`; regole di sicurezza: `docs/regole/sicurezza.md`
- Decisioni: `docs/decisioni.md`
