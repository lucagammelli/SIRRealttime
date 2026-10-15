# Server

## A cosa serve
`@sir/server` (`apps/server/`) è il backend di SIRRealtime. Riceve dall'agente le righe di scout DataVolley (ingest),
le salva in Postgres, ricalcola lo stato della partita con `@sir/dvw-parser` e `@sir/volley-stats` e lo spinge via
WebSocket ai client. Offre anche le API di amministrazione (agenti, link pubblici, utenti, partite) e l'accesso in sola
lettura tramite link pubblici. I contratti sono in `packages/shared` (vedi `docs/architettura.md`).

## Come funziona

### Clienti (multi-cliente)
Il server serve più **clienti** (tenant, tabella `tenants`) separati: ogni agente, registrazione, partita, link e utente
appartiene a un cliente e nessuna query legge o cambia righe di un altro (filtro unico `tenantScope`,
`apps/server/src/tenancy.ts`).

- **Cliente della richiesta** (`hostTenant`): quello che elenca nel suo `hostnames` l'hostname dell'header `Host`
  (porta, maiuscole e punto finale sono normalizzati da `hostnameFromHeader`); se nessuno lo elenca vale il cliente di
  `DEFAULT_TENANT_SLUG` (default `predefinito`). nginx imposta `Host` con `$host`; `X-Forwarded-Host` non è **mai** letto.
  Con `DEFAULT_TENANT_SLUG` vuota un hostname sconosciuto dà 404 sulle rotte pubbliche e sulla registrazione degli agenti,
  e il login è possibile solo al superadmin.
- **Ruoli**: `superadmin` (senza cliente: crea i clienti e lavora su uno alla volta), `admin` e `viewer` (di un solo
  cliente). Un utente di un cliente entra e resta valido solo dagli hostname del proprio cliente (al login e a ogni
  richiesta); il superadmin da ogni hostname. Il superadmin nasce da `ADMIN_EMAIL`/`ADMIN_PASSWORD` (se l'utente esiste
  già viene promosso e tiene la password); la creazione utenti non accetta `superadmin` (`TenantUserRoleSchema`).
  L'email utente è unica su **tutti** i clienti (limite noto: il 409 rivela che esiste in un altro cliente).
- **Cliente su cui lavora il superadmin**: `POST /api/admin/active-tenant` (`{ tenantId }`, `null` = torna al cliente
  dell'hostname) lo salva nella sessione (`sessions.active_tenant_id`), quindi vale per ogni rotta admin e per
  `/ws/admin`. Senza cliente le rotte admin rispondono 400 «Seleziona un cliente». Un admin su queste rotte: 403.
- **Gestione clienti** (solo superadmin): `GET`/`POST /api/admin/tenants`, `PATCH /api/admin/tenants/:id` (nome e
  hostname; lo slug non cambia). L'unicità degli hostname fra tutti i clienti è controllata dal server sotto lock
  (`pg_advisory_xact_lock`), non da un vincolo del database (conflitto: 409).
- **Ingest e WebSocket**: l'ingest usa il cliente dell'agente; la partita live è una per cliente
  (`matches_one_live_per_tenant_idx`) e `hub.publish(tenantId, …)` spinge lo stato solo ai WebSocket di quel cliente. La
  registrazione degli agenti appartiene al cliente dell'hostname da cui arriva.
- **Origin ammessi** (`originAllowed`): `CORS_ORIGIN` oppure un hostname del cliente dell'host della richiesta.
- **Link pubblici**: l'URL usa `PUBLIC_BASE_URL` se il suo hostname è del cliente (o il cliente non ha hostname), altrimenti
  il primo hostname del cliente con schema e porta di `PUBLIC_BASE_URL` (`publicBaseUrlFor`).
- **Produzione**: in nginx elencare i `server_name` espliciti dei clienti e chiudere il resto con un `default_server`
  (oggi `docker/web.nginx.conf` ha `server_name _`); i certificati https per ogni hostname sono a cura del deploy.
- **Documenti di configurazione** (`branding`, `layout`, `intermissions`, `overlays`, jsonb): schemi `{ version: 1 }`
  strict ancora vuoti, riempiti dai lavori successivi (`docs/piano.md`).

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

1. lock avvisorio `pg_advisory_xact_lock` (le ingest sono serializzate: una sola partita live per cliente, nessun deadlock);
2. riga `matches` creata se manca (per cliente e `matchKey`) e letta con `for update`;
3. controlli `duplicate` / `needSnapshot` (tabella sopra);
4. righe finali = precedenti + nuove (append) oppure solo le nuove (snapshot); se superano `MATCH_MAX_LINES` risposta 413
   (`MATCH_TOO_MANY_LINES`) e rollback;
5. verifica di `contentHash`; se non coincide `needSnapshot` (rollback);
6. scrittura delle sole righe cambiate: con `snapshot` si cancellano e si reinseriscono le righe dopo il prefisso comune;
7. ricostruzione del file con `buildDvwText(header, righe)` (header + `[3SCOUT]` + righe), poi `parseDvw` e
   `computeMatchState`: lo stato è **ricalcolato da zero a ogni ingest**;
8. la partita diventa la sola `live` del cliente (le altre dello stesso cliente vanno a `live = false`; indice univoco
   parziale `matches_one_live_per_tenant_idx`), `version` aumenta di 1, `state` è salvato;
9. dopo il commit lo stato intero (`StateMessage`) è inviato ai client WebSocket di quel cliente che seguono la partita.

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
- **Auto-registrazione dell'agente** (abbinamento), alternativa alla creazione manuale del token:
  1. l'agente chiede `POST /api/agents/registrations` con `{ name }` (pubblica, nessuna autenticazione); la risposta 201
     (`CreateRegistrationResponse`) ha `registrationId`, `secret` (segreto da 256 bit tenuto dall'agente, nel database solo
     l'hash), `pairingCode` (6 caratteri, alfabeto `PAIRING_CODE_ALPHABET` senza 0/O/1/I, da mostrare sul PC) ed `expiresAt`
     (24 h);
  2. l'admin vede la richiesta nel portale (`docs/portale.md`), confronta il codice con quello sul PC e preme «Abilita» o
     «Rifiuta» (`GET /api/admin/agent-registrations`, `POST .../:id/approve`, `POST .../:id/reject`; 404 se la richiesta non
     è in attesa o è scaduta);
  3. l'agente interroga ogni 5 s `POST /api/agents/registrations/status` con `Authorization: Bearer <segreto>` e corpo
     JSON `{}` obbligatorio (segreto errato: 401). Stati (`RegistrationStatusResponse`): `pending`; `approved` con `token` e
     `agentId`; `rejected`; `expired`; `consumed`;
  4. alla prima interrogazione dopo l'abilitazione il server crea l'agente (un agente normale, revocabile con la revoca
     esistente) e restituisce il token **una sola volta**: un `update` condizionato `approved` → `consumed` in transazione
     fa sì che due interrogazioni insieme non lo consegnino due volte. Le successive rispondono `consumed` senza token (se è
     andato perso, si registra di nuovo).

  Casi limite: una richiesta non approvata, o approvata e non ritirata, entro 24 h diventa `expired` (stato derivato da
  `expiresAt`, non salvato); `rejected` e `consumed` restano tali. Le richieste scadute da oltre 7 giorni sono cancellate
  quando ne arriva una nuova. Le rotte pubbliche rifiutano un `Origin` estraneo (403) e un corpo non JSON (415).
  **Limite di 20 richieste in attesa** (`MAX_PENDING_REGISTRATIONS`): oltre, 429 `TOO_MANY_PENDING`. Rischio accettato: un
  solo IP può riempirlo in circa 2 minuti (rate limit 10/min) e bloccare le registrazioni fino a 24 h; per un portale
  piccolo o in LAN va bene, e il rimedio è rifiutare dal portale le richieste in coda.
- **Link pubblici** (`share_tokens`): token casuale in `/live/<token>` (URL composto con `PUBLIC_BASE_URL`). Se `matchId`
  è `null` il link **segue la partita live corrente**; con un `matchId` mostra quella partita fissa. `expiresAt`
  facoltativa. Un token non valido, revocato o scaduto dà sempre 404; la revoca chiude i WebSocket già aperti (codice
  4404). Nei log il token è mascherato (`/api/public/[token]`).
- **Sessioni admin e viewer**: login con email e password (argon2id) su `/api/auth/login`; cookie `sir_session`
  (`httpOnly`, `SameSite=Lax`, `Secure` secondo `COOKIE_SECURE`), durata `SESSION_TTL_HOURS`. Ruoli: `viewer` (vede le
  partite), `admin` (tutto il resto del proprio cliente) e `superadmin` (anche i clienti; vedi «Clienti»). Le scritture
  dal browser (`POST`/`PATCH`/`DELETE` su `/api/auth/*` e `/api/admin/*`) richiedono corpo JSON e, se presente, un `Origin`
  ammesso (`CORS_ORIGIN` o un hostname del cliente; protezione CSRF). Il primo superadmin si crea all'avvio da
  `ADMIN_EMAIL` / `ADMIN_PASSWORD`, solo se non esiste già un superadmin.
- Risposte d'errore: `{ "error": "<testo>" }` (`ApiErrorSchema`), mai stack trace.

### Endpoint

| Metodo | Percorso | Protezione | Ruolo |
|---|---|---|---|
| GET | `/api/health` | nessuna (verifica il database; 503 se non raggiungibile) | - |
| POST | `/api/ingest` | rate limit, poi token agente | agente |
| POST | `/api/agents/registrations` | rate limit registrazione, `Origin` | - (pubblica) |
| POST | `/api/agents/registrations/status` | rate limit ingest, `Origin`, segreto di registrazione | agente in registrazione |
| POST | `/api/auth/login` | rate limit login | - |
| POST | `/api/auth/logout` | rate limit admin | - (chiude i WebSocket della sessione) |
| GET | `/api/auth/me` | sessione (risposta con `tenant`, il cliente corrente) | viewer |
| GET | `/api/admin/tenants` | sessione | superadmin |
| POST | `/api/admin/tenants` | sessione | superadmin |
| PATCH | `/api/admin/tenants/:id` | sessione | superadmin |
| POST | `/api/admin/active-tenant` | sessione | superadmin |
| GET | `/api/public/:token/state` | link pubblico (404 se non valido) | - |
| GET | `/api/admin/matches` | sessione | viewer |
| GET | `/api/admin/matches/:id` | sessione | viewer |
| POST | `/api/admin/agents` | sessione | admin |
| GET | `/api/admin/agents` | sessione | admin |
| DELETE | `/api/admin/agents/:id` | sessione | admin |
| GET | `/api/admin/agent-registrations` | sessione | admin |
| POST | `/api/admin/agent-registrations/:id/approve` | sessione | admin |
| POST | `/api/admin/agent-registrations/:id/reject` | sessione | admin |
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
arresto del server. `/ws/admin` rifiuta (403) un `Origin` non ammesso (`CORS_ORIGIN` o hostname del cliente), perché CORS non vale per i WebSocket.
Un client con più di 1 MB ancora da inviare è disconnesso subito (troppo lento). L'heartbeat gira ogni 30 s: manda un
ping, disconnette chi non ha risposto al precedente e chiude i client con credenziale scaduta o revocata.
`/ws/admin` segue sempre la partita live del cliente della sessione (il superadmin che cambia cliente si riconnette).

### Rate limit
Per indirizzo IP e per minuto. Default (`DEFAULT_RATE_LIMITS`, `apps/server/src/context.ts`), modificabili con le variabili
`RATE_LIMIT_LOGIN`, `RATE_LIMIT_INGEST`, `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_ADMIN`, `RATE_LIMIT_REGISTER`: login 10,
ingest 600, rotte pubbliche 120, rotte admin 300, creazione di una registrazione agente 10 (la rotta `/status` usa il
limite dell'ingest, perché l'agente interroga ogni 5 s) (incluse `/api/auth/logout`, `/api/auth/me`, `/ws/admin`). Oltre il limite: 429.
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
log pino con cookie, `Authorization`, password, token e `*.secret` oscurati.

## Configurazione
Variabili d'ambiente lette da `apps/server/src/config.ts` (`loadConfig`) e riportate in `.env.example`. Una variabile
vuota vale come assente. Se qualcuna non è valida l'avvio fallisce e il messaggio elenca solo i nomi, mai i valori.

| Variabile | Default | Significato |
|---|---|---|
| `DATABASE_URL` | obbligatoria | `postgres://…`, oppure `pglite:memory` / `pglite:<cartella>` (solo sviluppo e test) |
| `PORT` | `8090` | porta HTTP |
| `HOST` | `127.0.0.1` | indirizzo di ascolto (`0.0.0.0` nel container) |
| `CORS_ORIGIN` | `http://localhost:5173` (compose: `http://localhost:${WEB_PORT}`) | origine ammessa da CORS e dal controllo `Origin`, oltre agli hostname del cliente dell'host |
| `COOKIE_SECURE` | `true` | cookie con attributo `Secure` (`false` solo in sviluppo su http) |
| `SESSION_TTL_HOURS` | `12` | durata della sessione (massimo 720) |
| `ADMIN_EMAIL` | assente | primo superadmin (se l'utente esiste viene promosso e tiene la password); va impostata insieme a `ADMIN_PASSWORD` |
| `DEFAULT_TENANT_SLUG` | `predefinito` | cliente degli hostname sconosciuti; vuota: 404 sulle rotte pubbliche e sulla registrazione, login solo per il superadmin |
| `ADMIN_PASSWORD` | assente | almeno 12 caratteri |
| `PUBLIC_BASE_URL` | `http://localhost:5173` (compose: `http://localhost:${WEB_PORT}`) | base dei link pubblici `<base>/live/<token>` (se il suo hostname non è del cliente si usa il primo hostname del cliente) |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `TRUST_PROXY` | `false` (compose: `true`) | `true` solo dietro un reverse proxy fidato (con compose, nginx del servizio `web`) |
| `RATE_LIMIT_LOGIN` | `10` | richieste al minuto per IP su `/api/auth/login` (intero da 1 a 100000) |
| `RATE_LIMIT_INGEST` | `600` | richieste al minuto per IP su `/api/ingest` (intero da 1 a 100000) |
| `RATE_LIMIT_PUBLIC` | `120` | richieste al minuto per IP sulle rotte pubbliche (intero da 1 a 100000) |
| `RATE_LIMIT_ADMIN` | `300` | richieste al minuto per IP sulle rotte admin (intero da 1 a 100000) |
| `RATE_LIMIT_REGISTER` | `10` | richieste al minuto per IP su `POST /api/agents/registrations` (intero da 1 a 100000) |
| `MATCH_MAX_LINES` | `20000` | righe scout massime per partita (massimo 1.000.000); oltre, 413 |

Le cinque `RATE_LIMIT_*` sono anche in `.env.example` e `docker-compose.yml`.

Variabili solo per Docker Compose: `POSTGRES_DB` (`sir`), `POSTGRES_USER` (`sir`), `POSTGRES_PASSWORD` (obbligatoria),
`SERVER_BIND` (`127.0.0.1`, indirizzo su cui è pubblicata la 8090), `WEB_BIND` (`127.0.0.1`) e `WEB_PORT` (`8080`) per il
portale (`docs/portale.md`).

### Database
Schema in `apps/server/src/db/schema.ts` (Drizzle):

| Tabella | Contenuto |
|---|---|
| `tenants` | `slug` (unico), `name`, `hostnames` (`text[]` con indice GIN, unici fra clienti per controllo del server), `branding`, `layout`, `intermissions`, `overlays` (jsonb, default `{}`), `created_at` (migrazione `0002_tenants.sql`) |
| `users` | `tenant_id` (null solo per il superadmin; CHECK `superadmin` ⇔ `tenant_id` nullo), `email` (minuscola, unica su tutti i clienti), `password_hash` (argon2id), `role` (`superadmin`/`admin`/`viewer`) |
| `sessions` | `token_hash` (sha256 del cookie), `user_id`, `expires_at`, `active_tenant_id` (cliente scelto dal superadmin, `ON DELETE SET NULL`) |
| `agents` | `tenant_id`, `name`, `token_hash`, `revoked`, `last_seen_at` |
| `matches` | `tenant_id`, `match_key` (unica per `tenant_id` + `match_key`), `header`, `line_count`, `content_hash`, `last_seq`, `agent_id`, `live` (una per cliente), `state` (jsonb), `version` |
| `scout_lines` | `match_id`, `idx`, `text` (chiave primaria `match_id` + `idx`) |
| `share_tokens` | `tenant_id`, `token_hash`, `match_id` (null: segue la live), `label`, `expires_at`, `revoked` |
| `agent_registrations` | `tenant_id`, `name`, `secret_hash` (unico), `pairing_code`, `ip`, `status` (enum `agent_registration_status`: `pending`/`approved`/`rejected`/`consumed`), `agent_id`, `created_at`, `expires_at`, `decided_at` (migrazione `0001_agent_registrations.sql`) |

La migrazione `0002_tenants.sql` crea il cliente «Predefinito» (slug `predefinito`), gli assegna tutti i dati esistenti e
solo dopo rende `tenant_id` NOT NULL.

Le migrazioni generate (`pnpm --filter @sir/server db:generate`) stanno in `apps/server/drizzle` e sono applicate
all'avvio (`database.migrate()` in `src/main.ts`). Il driver dipende da `DATABASE_URL` (`src/db/index.ts`,
`createDatabase`): `pg` per `postgres://…`, PGlite per `pglite:`. I token sono salvati solo come hash sha256.

## Come si usa / si prova

### Sviluppo con PGlite in memoria
Il database in memoria si perde a ogni riavvio. Primo terminale:

```bash
# --- variabili ---
RADICE="/percorso/del/repository"        # radice del repository o del worktree del job
ADMIN_EMAIL_DEV="admin@example.com"      # email del superadmin (creato o promosso all'avvio)
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

Prova dell'auto-registrazione (stesso server e stesso `COOKIE_JAR`; l'abilitazione si può fare anche dal portale):

```bash
# --- variabili ---
SERVER="http://127.0.0.1:8090"   # indirizzo del server
COOKIE_JAR="/tmp/sir-cookie.txt" # cookie di sessione admin ottenuto con il login sopra
NOME_AGENTE="PC scout"           # nome dell'agente che chiede la registrazione
SEGRETO="<secret>"               # campo "secret" della risposta alla prima chiamata
ID_REGISTRAZIONE="<id>"          # campo "id" della richiesta in GET /api/admin/agent-registrations

# --- comandi ---
curl -s -H "Content-Type: application/json" -d "{\"name\":\"$NOME_AGENTE\"}" "$SERVER/api/agents/registrations"
curl -s -b "$COOKIE_JAR" "$SERVER/api/admin/agent-registrations"
curl -s -b "$COOKIE_JAR" -H "Content-Type: application/json" -X POST \
  "$SERVER/api/admin/agent-registrations/$ID_REGISTRAZIONE/approve"
curl -s -H "Authorization: Bearer $SEGRETO" -H "Content-Type: application/json" -d '{}' \
  "$SERVER/api/agents/registrations/status"   # la prima volta contiene "token", poi "consumed"
```

Il token agente va nell'intestazione `Authorization: Bearer <token>` di `POST /api/ingest` (l'agente è in
`apps/agent`, vedi `docs/agente.md`; per esempi di richieste complete vedere `apps/server/test/ingest.test.ts`).

### Comandi del pacchetto (`apps/server/package.json`)

| Comando | Cosa fa |
|---|---|
| `pnpm --filter @sir/server dev` | `tsx watch --conditions=@sir/source src/main.ts` (legge i sorgenti) |
| `pnpm --filter @sir/server build` | compila in `dist/` |
| `pnpm --filter @sir/server start` | `node dist/main.js` (serve la build) |
| `pnpm --filter @sir/server test` | `vitest run` con PGlite in memoria, non serve Postgres |
| `pnpm --filter @sir/server db:generate` | `drizzle-kit generate` dopo una modifica a `schema.ts` |

I test (`apps/server/test/`: `auth`, `config`, `hub`, `ingest`, `limits`, `migration`, `public`, `registration`, `tenants`) usano PGlite. Per la configurazione
di vitest vedi `docs/infrastruttura.md`.

### Docker Compose
`docker-compose.yml` (nome progetto `sir-realtime`) ha tre servizi:

- `postgres` (immagine `postgres:17`, volume `pgdata`, healthcheck `pg_isready`);
- `server` (build da `docker/server.Dockerfile`, parte quando Postgres è sano, healthcheck su `/api/health`, porta
  `${SERVER_BIND:-127.0.0.1}:8090:8090`). `DATABASE_URL` è composta da `POSTGRES_*`; `HOST` è `0.0.0.0`;
  `CORS_ORIGIN` e `PUBLIC_BASE_URL` di default sono `http://localhost:${WEB_PORT:-8080}` e `TRUST_PROXY` è `true`;
- `web` (nginx con il portale, `docker/web.Dockerfile`, parte quando il server è sano, porta
  `${WEB_BIND:-127.0.0.1}:${WEB_PORT:-8080}:8080`): serve la SPA e inoltra `/api/` e `/ws/` al server, sovrascrivendo
  `X-Forwarded-For` con l'IP reale del client (`docs/portale.md`).

**Browser e agenti passano da nginx** (servizio `web`), anche per `POST /api/ingest`: a un agente in rete va data l'**URL
del portale** come `serverUrl` (es. `https://<host>/`, vedi `docs/agente.md`). La porta 8090 resta su `127.0.0.1` per
prove locali e scansioni: non va mai pubblicata su `0.0.0.0`, perché con `TRUST_PROXY=true` chi arriva direttamente al server
potrebbe falsificare `X-Forwarded-For` ed eludere il rate limit.

```bash
# --- variabili (nel file .env alla radice, copiato da .env.example) ---
# POSTGRES_PASSWORD  obbligatoria: solo lettere, cifre, - e _ (entra nell'URL)
# ADMIN_EMAIL        superadmin (creato o promosso all'avvio)
# ADMIN_PASSWORD     almeno 12 caratteri
# WEB_BIND, WEB_PORT indirizzo e porta del portale (default 127.0.0.1 e 8080); CORS_ORIGIN e PUBLIC_BASE_URL le seguono
# CORS_ORIGIN, PUBLIC_BASE_URL, TRUST_PROXY: da impostare solo con un dominio vero (https://...), altrimenti lasciarle commentate

# --- comandi ---
cd "/percorso/del/repository"   # radice del repository
cp .env.example .env            # poi compilare i valori sopra
docker compose up -d --build
docker compose logs -f server
docker compose down             # i dati restano nel volume pgdata
```

Stato della verifica: Docker Compose con PostgreSQL vero e nginx è stato provato il 2026-10-14 (collaudo e scansione
DAST dello stack in `docs/portale.md`); i test automatici restano su PGlite.

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
#   RATE_LIMIT_LOGIN=100000 RATE_LIMIT_ADMIN=100000 RATE_LIMIT_PUBLIC=100000 RATE_LIMIT_INGEST=100000 \
#   RATE_LIMIT_REGISTER=100000 pnpm dev

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
- `stackhawk.yml`, `stackhawk-portale.yml` (stack completo, `docs/portale.md`), `stackhawk/openapi.yaml`
- `apps/server/src/main.ts` (avvio), `app.ts` (`buildApp`, plugin, gestione errori), `config.ts` (`loadConfig`),
  `context.ts` (limiti, cookie `sir_session`), `ingest.ts` (`IngestService`), `hub.ts` (`LiveHub`, codici di chiusura),
  `security.ts` (`requireRole`, `browserWriteGuard`, `sameOriginGuard`, `authenticateAgent`, `bearerHash` condivisa con
  l'ingest), `lib/tokens.ts` (`generatePairingCode`), `state.ts`, `seed.ts`
- Clienti: `src/tenancy.ts` (`hostTenant`, `hostnameFromHeader`, `tenantScope`, `adminTenantId`, `publicBaseUrlFor`),
  `src/routes/tenants.ts`, `packages/shared/src/tenant.ts`, `src/seed.ts`
- Rotte: `src/routes/health.ts`, `ingest.ts`, `auth.ts`, `admin.ts`, `public.ts`, `registration.ts`, `tenants.ts`
- Database: `src/db/schema.ts`, `src/db/index.ts` (`createDatabase`), `src/db/pglite.ts`, `apps/server/drizzle/`
- Contratti: `packages/shared/src/ingest.ts`, `messages.ts`, `admin.ts`, `registration.ts` (`docs/architettura.md`)
- Calcoli: `docs/dvw-parser.md`, `docs/statistiche.md`; simulatore: `docs/simulatore.md`
- Portale e nginx: `docs/portale.md` (`docker/web.nginx.conf`)
- Infrastruttura e Docker: `docs/infrastruttura.md`; regole di sicurezza: `docs/regole/sicurezza.md`
- Decisioni: `docs/decisioni.md`
