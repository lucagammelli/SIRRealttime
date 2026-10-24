# Server

## A cosa serve
`@arenalive/server` (`apps/server/`) è il backend di ArenaLive. Riceve dall'agente le righe di scout DataVolley (ingest),
le salva in Postgres, ricalcola lo stato della partita con `@arenalive/dvw-parser` e `@arenalive/volley-stats` e lo spinge via
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
  Con `DEFAULT_TENANT_SLUG` vuota un hostname sconosciuto dà 404 sulle rotte pubbliche e sulla registrazione degli agenti.
  L'hostname non conta per l'area riservata (vedi «Ruoli» e «Cliente su cui lavora il superadmin»).
- **Ruoli**: `superadmin` (senza cliente: crea i clienti e lavora su uno alla volta), `admin` e `viewer` (di un solo
  cliente). Il login (`POST /api/auth/login`, `routes/auth.ts`) funziona da **qualunque hostname**, e la sessione admin
  usa il cliente **dell'utente** (`session.tenantId` in `security.ts`), mai quello dell'hostname: un utente di un cliente
  lavora sempre sul proprio, un superadmin su nessuno finché non entra in un cliente. Il superadmin nasce da `ADMIN_EMAIL`/`ADMIN_PASSWORD` (se l'utente esiste
  già viene promosso e tiene la password); la creazione utenti non accetta `superadmin` (`TenantUserRoleSchema`).
  L'email utente è unica su **tutti** i clienti (limite noto: il 409 rivela che esiste in un altro cliente).
- **Cliente su cui lavora il superadmin** («Entra nel cliente» / «Esci dal cliente» della pagina «Clienti»):
  `POST /api/admin/active-tenant` (`{ tenantId }`, `null` = esce dal cliente) lo salva nella sessione
  (`sessions.active_tenant_id`), quindi vale per ogni rotta admin e per `/ws/admin`; una sessione nuova non è in nessun
  cliente. Fuori da un cliente le rotte con dati di un cliente (`adminTenantId`, `src/tenancy.ts`) rispondono **409**
  `TENANT_REQUIRED` «Scegli prima un cliente» (`TENANT_REQUIRED_MESSAGE`), mai sul cliente dell'hostname. Ogni entrata e
  uscita è nel log (`superadmin entrato nel cliente`, `superadmin uscito dal cliente`, con `userId` e `tenantId`). Un
  cliente inesistente è 404; un admin su questa rotta: 403.
- **Gestione clienti** (solo superadmin): `GET`/`POST /api/admin/tenants`, `PATCH /api/admin/tenants/:id` (nome e
  hostname; lo slug non cambia). L'unicità degli hostname fra tutti i clienti è controllata dal server sotto lock
  (`pg_advisory_xact_lock`), non da un vincolo del database (conflitto: 409). L'elenco riporta `userCount` (utenti del
  cliente, disattivati compresi). `POST` accetta `firstUser` (`email`, `password` facoltativa): il primo utente è creato come `admin`
  nella stessa transazione del cliente; se l'email è già usata la risposta è 409 e non nasce nessun cliente. Senza
  `password` il primo utente è invitato e la risposta (`CreateTenantResponse`) ha `firstUserInvite` (esito della mail o
  link da copiare; vedi «Posta, inviti e recupero password»). La quota
  agenti è letta con `clampAgentQuota` (valore fuori da 0-`AGENT_QUOTA_MAX` riportato al limite più vicino).
- **Opzione «Link e QR per singola partita»** (`tenants.match_links_enabled`, `matchLinksEnabled` in `TenantRef`
  (`MeResponse.tenant`), `TenantSummary` e nel `PATCH /api/admin/tenants/:id`; solo superadmin, migrazione
  `0014_link_partita.sql`). **Spenta** per i clienti nuovi: hanno solo il canale del club col suo QR. La migrazione la
  accende per i clienti che avevano già link per partita validi (del calendario o «partita fissa» non revocati; le
  simulazioni non contano), così i QR già stampati continuano a funzionare. Spegnerla (`revokeMatchLinks`, `club.ts`)
  **revoca per sempre** tutti i link per partita del cliente (calendario e partita fissa; non il canale né le
  simulazioni), chiude i WebSocket di chi li guarda (4404) e svuota le cache (`forgetClubCaches`, `dropShareLinks`).
  Riaccenderla chiama `ensureFixtureLinks(..., { renewRevoked: true })`: ogni partita del calendario senza un link valido
  ne riceve uno **nuovo**, anche se i suoi link erano stati revocati a mano; i revocati restano revocati. Tutto avviene
  in una transazione sotto il lock dei clienti e poi quello delle partite (`lockTenantMatches`). Con l'opzione spenta il
  server tratta comunque i link per partita come inesistenti (`resolveShareToken`, `state.ts`).
- **Utenti del cliente** (`src/routes/users.ts`, ruolo `admin`; il superadmin lavora dentro il cliente in cui è entrato): `GET` e `POST
  /api/admin/users`, `PATCH /api/admin/users/:id` (`UpdateUserRequestSchema`: `role`, `password`, `disabled`, almeno un
  campo), `DELETE /api/admin/users/:id` (204). Un superadmin non è mai elencato né modificabile (404). Vincoli (409):
  nessuno cambia il proprio ruolo né disattiva o elimina se stesso (`SELF_CHANGE_MESSAGE`); il cliente deve avere
  almeno un `admin` attivo (`LAST_ADMIN_MESSAGE`), tranne per le modifiche del superadmin; email già usata
  (`USER_EXISTS_MESSAGE`). Il controllo avviene sotto un lock di transazione per cliente (`lockTenantUsers`,
  `src/users.ts`), così due modifiche contemporanee non tolgono entrambe l'ultimo admin. Al cambio di ruolo, di
  password o alla disattivazione le sessioni dell'utente sono cancellate (`deleteUserSessions`) e i suoi WebSocket
  `/ws/admin` chiusi (`closeSessionSockets`); chi cambia la propria password tiene aperta solo la sessione in uso.
  Un utente disattivato (`users.disabled`) non entra: il login risponde 401 «Credenziali non valide», lo stesso della
  password sbagliata (con un avviso nel log), e `security.ts` scarta le sue sessioni.
- **Posta, inviti e recupero password** (`src/mail/`, `src/userLinks.ts`, `src/routes/mailSettings.ts`, `src/routes/auth.ts`,
  `src/routes/users.ts`). Il server di posta (SMTP) non è nel `.env`: lo imposta il superadmin nella pagina «Posta» del
  portale (per volere di Luca) ed è **uno solo per tutti i clienti**, nella tabella `mail_settings`. La password SMTP è
  cifrata (AES-256-GCM) con `SETTINGS_ENCRYPTION_KEY` e non torna mai al portale (`MailSettings.passwordSet`); senza la
  chiave `PUT` con una password risponde 409 (`NO_KEY_MESSAGE`); se la chiave cambia la password salvata non si legge più
  (errore `PASSWORD_UNREADABLE`) e va inserita di nuovo. L'invio usa `nodemailer`, con timeout di connessione 5 s, socket
  8 s e invio completo 10 s (`SEND_TIMEOUT_MS`); `MailService.send` non lancia mai, risponde `sent`, `not_configured` o
  `failed` e nel log scrive solo il codice dell'errore (mai indirizzi o password). La mail di prova (`POST
  /api/admin/mail-settings/test`) va all'email del superadmin e risponde sempre 200 con `ok` e un `message` già leggibile.
  - **Inviti**: `POST /api/admin/users` (e `firstUser` di `POST /api/admin/tenants`) senza `password` crea l'utente con una
    password inutilizzabile e un link di invito (72 ore, `INVITE_TTL_HOURS`; `user_tokens`, `kind` `invite`). Il link
    va per mail; senza posta configurata, o se il server di posta rifiuta, la risposta contiene `delivery.link` da
    copiare a mano (`InviteDelivery.mail`: `sent`/`not_configured`/`failed`; se la mail è partita il link non è
    restituito). Finché l'invito è aperto (valido o scaduto) il login risponde 401 «Credenziali non valide»
    (`hasOpenInvite`). `POST /api/admin/users/:id/invite` rinnova l'invito (il precedente smette di funzionare; 409 se
    l'utente ha già scelto la password o è disattivato); `DELETE /api/admin/users/:id/invite` lo annulla **eliminando
    l'utente** (204; 409 se non c'è più un invito aperto; gli admin invitati non contano per la regola «almeno un admin attivo»). Una password impostata da un admin con
    `PATCH` cancella l'invito. `GET /api/admin/users` riporta `invite` (`pending`/`expired`/`null`).
  - **Recupero password**: `POST /api/auth/password-reset/request` (corpo `{ email }`) risponde sempre e subito
    `{ ok: true }`, che l'email esista o no, sia disattivata, sia oltre il limite o la posta manchi: il lavoro vero
    (ricerca, link, mail) avviene dopo la risposta (`MailService.background`), perché tempi e risposta non rivelino
    nulla. Al massimo **3 richieste all'ora per email** (`resetRequests`, `FailureLimiter` in memoria: si azzera al
    riavvio del server); le altre ricevono la stessa risposta ma non spediscono nulla. Il link vale **1 ora**
    (`RESET_TTL_HOURS`, `kind` `reset`). `POST /api/admin/users/:id/reset-link` (admin del cliente) dà lo stesso link da
    copiare e consegnare a mano (409 se l'utente è disattivato).
  - **Uso dei link**: `GET /api/auth/links/:token` dice a cosa serve il link (`LinkInfo`: `kind`, `email`, `tenantName`,
    `expiresAt`); `POST /api/auth/invite/accept` (primo accesso: la password è scelta e l'utente entra già collegato,
    risposta `MeResponse` con il cookie di sessione) e `POST /api/auth/password-reset/confirm` (nuova password, poi si
    accede dal login). Un link sbagliato, scaduto, già usato o di un utente disattivato risponde **410** («Il link non è
    valido o è scaduto»). Ogni link è **monouso**: `consumeLink` lo cancella con una sola istruzione, quindi due richieste
    insieme non riescono entrambe. Dopo il reset **tutte le sessioni dell'utente sono chiuse** (WebSocket compresi); ogni
    altro link dell'utente è cancellato. Del token è salvato solo l'sha256.
  - **Indirizzo dei link**: costruito solo da `PUBLIC_BASE_URL` (`linkUrl`: `/admin/invito/<token>` e
    `/admin/reimposta-password/<token>`), mai dall'intestazione `Host`. Le mail portano nome e logo del cliente
    (`mailBrand`; senza cliente, il nome del portale).
  - Le quattro rotte `/api/auth/links/:token`, `invite/accept`, `password-reset/request` e `password-reset/confirm` sono
    pubbliche e usano `RATE_LIMIT_PASSWORD_RESET` per IP; le rotte `/api/admin/mail-settings*` sono solo del superadmin.
- **Ingest e WebSocket**: l'ingest usa il cliente dell'agente; la partita live è una per partita del calendario del club
  più una tra quelle non abbinate (indici `matches_one_live_per_fixture_idx` e `matches_one_live_unlinked_idx`, vedi «Club,
  calendario e abbinamento») e `hub.publish(tenantId, …)` spinge lo stato solo ai WebSocket di quel cliente. La
  registrazione degli agenti appartiene al cliente dell'hostname da cui arriva.
- **Cache del cliente dell'hostname**: `hostTenant` ricorda per 30 s (`LOOKUP_CACHE_TTL_MS`) il cliente di ogni hostname
  (`ctx.caches.hosts`); la cache è svuotata a ogni creazione o modifica di un cliente (`src/tenancy.ts`).
- **Certificati on demand per gli hostname dei clienti** (`GET /internal/tls/ask?domain=<host>`, `src/routes/tlsAsk.ts`):
  prima di chiedere un certificato per un hostname non elencato in `ARENALIVE_HOSTNAMES`, Caddy (`on_demand_tls { ask … }`
  in `docker/Caddyfile`, che chiama `http://server:8090/internal/tls/ask`) interroga il server. Risposte: **200** solo se
  `domain` è in `tenants.hostnames` di un cliente (`isTenantHostname`, stessa cache di `hostTenant`, quindi vale entro 30 s
  o subito dopo la modifica di un cliente); **404** se è sconosciuto o se la richiesta porta intestazioni di inoltro
  (`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`, `Forwarded`: la chiamata di Caddy non le ha mai);
  **400** se `domain` non è valido (`TlsAskQuerySchema`: maiuscole, porta, IP, punto finale, ripetuto, oltre 253
  caratteri); **429** oltre 600 richieste al minuto (`TLS_ASK_PER_MINUTE`, finestra fissa; Caddy lo legge come «nessun
  certificato»). La rotta è fuori da `/api/` e `/ws/`: nginx non la inoltra, quindi non è raggiungibile da Internet, e la
  difesa con le intestazioni protegge anche se qualcuno la raggiungesse passando dal proxy. Ogni consenso è nel log
  (`certificato on demand consentito`, con `domain`). Esito per l'operatore: `docs/infrastruttura.md`, «Modalità dei certificati».
- **Origin ammessi** (`originAllowed`): `CORS_ORIGIN` oppure un hostname del cliente dell'host della richiesta.
- **Link pubblici**: l'URL usa `PUBLIC_BASE_URL` se il suo hostname è del cliente (o il cliente non ha hostname), altrimenti
  il primo hostname del cliente con schema e porta di `PUBLIC_BASE_URL` (`publicBaseUrlFor`).
- **Produzione**: in nginx elencare i `server_name` espliciti dei clienti e chiudere il resto con un `default_server`
  (oggi `docker/web.nginx.conf` ha `server_name _`); i certificati https per ogni hostname sono a cura del deploy.
- **Documenti di configurazione** (`branding`, `layout`, `intermissions`, `overlays`, jsonb): `branding` ha i campi della
  grafica (vedi «Grafica per cliente»); `layout` quelli della pagina pubblica (vedi «Pagina pubblica a blocchi»);
  `intermissions` le pause (vedi «Pause della partita»); `overlays` gli avvisi sugli eventi (vedi «Avvisi sugli eventi»).

### Grafica per cliente (`apps/server/src/routes/branding.ts`)
Ogni cliente ha nome visualizzato, cinque colori e tre immagini (`TenantBrandingSchema`, `tenants.branding`). Il portale
li legge dall'hostname e li applica (`docs/portale.md`, «Grafica per cliente»). Ogni campo è facoltativo: `{}` è valido e
vale i predefiniti del portale (`resolveBranding`; un documento non valido vale i predefiniti). `TENANT_CONFIG_VERSION`
resta 1.

- **Temi personalizzati**: `PUT /api/admin/branding` con un `template` personalizzato (`isCustomTemplate`, per esempio
  `sir-volley`; `docs/architettura.md`) risponde **403** «Accesso negato» se chi scrive non è superadmin e il cliente non ha
  già quel tema salvato (chi lo ha può risalvare la grafica senza cambiarlo). Il controllo è nella stessa transazione del
  salvataggio.
- **Esporta / importa la grafica** (`src/routes/graphicsTransfer.ts`, contratto `GraphicsExportSchema` in
  `packages/shared/src/graphicsExport.ts`): `GET /api/admin/branding/export` (admin) scarica un pacchetto JSON
  (`Content-Disposition: attachment; filename="grafica-<slug>-<data>.json"`) con `format: "arenalive-grafica"` (l'importazione accetta ancora il vecchio `sirrealtime-grafica`),
  `version: 1`, `exportedAt`, `sourceName` (nome del cliente), `branding`, `layout`, `intermissions`, `overlays` e le
  immagini usate (loghi del branding, immagini singole e immagini degli sponsor scelti: id originale, tipo, mime, base64) e
  `sponsors` (gli sponsor scelti da pagina e pause: id originale, nome, sito, `imageIds`; la `version` resta 1, un
  pacchetto senza `sponsors` vale nessuno sponsor). L'export risponde 409 se uno sponsor scelto non esiste più.
  All'import ogni sponsor si **unisce** a quello del cliente con lo stesso nome (il sito è sovrascritto con quello del
  pacchetto) oppure si crea in fondo all'elenco (409 oltre 50 sponsor); le sue immagini, se non hanno già uno sponsor, gli
  sono assegnate fino a 12 (`importSponsors`); la risposta ha anche `sponsors` (numero).
  Niente partite, utenti, agenti, link né hostname. `POST /api/admin/branding/import` (admin, corpo fino a 24 MB, solo su
  questa rotta) valida il pacchetto (versione o formato sconosciuti: 400 «Versione della configurazione non supportata»),
  controlla ogni immagine come un caricamento (`inspectImage`: byte iniziali, SVG controllato, 2 MB; il mime dichiarato
  deve coincidere: 422), le salva nel cliente con id nuovi (`storeAsset`, la stessa funzione del caricamento: un file
  uguale già presente si riusa; quota rispettata, 409), rimappa gli id (`remapGraphicsImageIds`) e sostituisce branding,
  layout, pause e avvisi in un'unica transazione sotto il blocco del cliente. **Tema personalizzato**: lo stesso limite di
  `PUT /api/admin/branding`; un admin che importa un pacchetto con un tema personalizzato che il cliente non ha riceve
  **403** con il messaggio «…può essere assegnato solo dal superadmin» (scelta: errore chiaro, senza importare
  parzialmente con un altro tema, che cambierebbe l'aspetto in silenzio). Risposta: `{ images, template }`. L'export risponde **409** con un messaggio in italiano se la grafica usa più di 30 immagini (`GRAPHICS_EXPORT_MAX_IMAGES`) o se il base64 supera `GRAPHICS_EXPORT_MAX_BASE64` (23 MB), perché l'import rifiuterebbe il file.
- **Rotte pubbliche** (senza token, stesso rate limit `RATE_LIMIT_PUBLIC`): `GET /api/public/tenant` dà nome, grafica e
  percorsi delle immagini del cliente dell'hostname (`Cache-Control: public, max-age=30`; 404 se nessun cliente); `GET
  /api/public/assets/:id` dà il file di un'immagine **solo** se è del cliente dell'hostname (altrimenti 404). Il tipo
  viene dal database (riconosciuto dai byte al caricamento), con `X-Content-Type-Options: nosniff`, `Content-Disposition:
  inline` e `Cache-Control: public, max-age=31536000, immutable`: l'`id` cambia a ogni file nuovo (una riga nuova con il
  suo sha256), quindi la cache non invecchia. Gli SVG escono con `image/svg+xml; charset=utf-8` e CSP `default-src 'none';
  style-src 'unsafe-inline'; sandbox`, perché aperti direttamente non eseguano né carichino nulla. Le due rotte di lettura
  dei file (`sendAsset`) mandano `Accept-Ranges: bytes` e rispondono a un `Range` con un solo intervallo (`bytes=a-b`,
  `bytes=a-`, `bytes=-n`, funzione pura `byteRange`): **206** con `Content-Range`, **416** con `Content-Range: bytes */N`
  se l'intervallo non sta nel file; un `Range` non capito dà il file intero. Serve a Safari, che chiede i video a pezzi.
- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET`/`PUT
  /api/admin/branding` (il corpo del `PUT` è il branding; ogni immagine deve essere di quel cliente e del tipo del suo
  posto, `BRANDING_IMAGE_SLOTS`: `logoMain` e `logoMark` sono `logo`, `sponsorLogo` è `sponsor`, altrimenti 400); `GET
  /api/admin/assets` (elenco, `usedBytes`, `quotaBytes`), `POST /api/admin/assets` (caricamento), `DELETE
  /api/admin/assets/:id` (204), `GET /api/admin/assets/:id/file` (ruolo `viewer`, immagine del **cliente della sessione**,
  non dell'hostname; `Cache-Control: private, max-age=31536000, immutable`, stessi header e stessi SVG sicuri della rotta
  pubblica perché usano la stessa `sendAsset`). Le anteprime dell'area riservata (`AssetSummary.url`, loghi di club e
  calendario `adminLogos`, `ClubResponse.logoUrl`) usano questo percorso (`adminAssetPath` in `packages/shared/src/tenant.ts`),
  così non dipendono dall'`Host` (prima, da un indirizzo di un altro cliente, le immagini davano 404); la pagina pubblica
  continua con `publicAssetPath` e i documenti salvati contengono solo gli id. Il salvataggio svuota la cache degli hostname (`forgetTenants`), così la pagina pubblica
  usa subito la nuova grafica; `PUT` è nei metodi CORS.
- **Caricamento**: JSON `{ kind, data }` con `data` in base64 (`UploadAssetRequestSchema`; il guard delle rotte admin
  accetta solo JSON). Errori: 413 oltre 2 MB (`ASSET_MAX_BYTES`), 422 immagine non ammessa, 409 quota esaurita
  («Spazio per i file esaurito (… MB): elimina quelli che non usi») o, in eliminazione, immagine in uso («Immagine
  in uso nella grafica: toglila prima di eliminarla»). Lo stesso file caricato di nuovo (stesso cliente, sha256 e `kind`)
  restituisce l'immagine già salvata con 200 (201 se nuova).
- **Caricamento di un video** (`POST /api/admin/assets/video`, `VIDEO_UPLOAD_PATH`, per gli sfondi degli avvisi): il corpo
  è il file stesso, `Content-Type: application/octet-stream` (rotta con `BINARY_BODY` in `src/security.ts`; tutte le altre
  restano solo JSON), senza base64. Ordine dei controlli: sessione e ruolo `admin` (403) prima di leggere il corpo, tipo
  (415 se non è `octet-stream`), dimensione (413 oltre 15 MB, `VIDEO_MAX_BYTES`, già dalla `Content-Length`), contenuto
  (422 `VIDEO_REJECTED` se i byte non sono MP4 con marca ISO, QuickTime (marca `qt  `, i `.mov` di iPhone e Mac, salvato e servito come `video/mp4`) né WebM: `inspectVideo` in `src/lib/videos.ts`, mai dal nome o dal
  tipo dichiarato), quota (409 «Spazio per i file esaurito (N MB): elimina quelli che non usi»). Il file è un asset di
  `kind` `overlay`; stessa quota, stesso blocco per cliente e stesso `storeAsset` delle immagini. Lo stesso file di nuovo:
  200 con il video già salvato (201 se nuovo). Il nome originale arriva nell'header `X-File-Name` (`FILE_NAME_HEADER`,
  `encodeURIComponent` del nome; validato con `AssetNameSchema`, al massimo `ASSET_NAME_MAX` = 120 caratteri, niente percorsi,
  caratteri di controllo o bidi: 400 se non valido o non decodificabile); ricaricando lo stesso file, uno che non aveva nome
  prende quello nuovo. Il file su disco resta per sha256. Le immagini degli sfondi usano `POST /api/admin/assets` con `kind: 'overlay'`.
  Le immagini di logo, sponsor e pagina rifiutano i video (400).
- **Controllo dell'immagine** (`src/lib/images.ts`, `inspectImage`): tipo e dimensioni dai byte, mai dal nome o dal tipo
  dichiarato. PNG, JPEG e WebP (rifiutati se hanno dati dopo la fine del file), massimo 4096 px per lato
  (`IMAGE_MAX_SIDE`). SVG (`checkSvg`) solo UTF-8 e solo con una lista di elementi ammessi; rifiutati script,
  `foreignObject`, attributi `on*`, `href` diversi da `#…`, `javascript:`, entità, DOCTYPE, CDATA, `url()` esterni,
  `image-set(`, `-webkit-image-set(` e `src(`. Un SVG non ammesso è rifiutato, non convertito in PNG.
- **File** (`src/assetStore.ts`): `<ASSETS_DIR>/<cliente>/<sha256>`, scrittura atomica. Quota (`ASSETS_QUOTA_MB` per
  cliente) e operazioni su immagini e branding sono serializzate con `pg_advisory_xact_lock` per cliente.
- **Limiti noti**: l'eliminazione di un'immagine cancella il file prima del commit, quindi in caso di errore rimane una
  riga orfana (rara): il file risponde 404 e il server scrive un warning. Nel superadmin la testata dell'area riservata
  mostra la grafica del cliente dell'hostname, non quella del cliente attivo.

### Loghi di sistema (`apps/server/src/routes/systemLogos.ts`)
Quattro loghi della piattaforma: lato `left` e `right`, ciascuno in variante `positive` (sfondi chiari) e `negative`
(sfondi scuri), uguali per tutti i clienti e per ogni hostname. Il sinistro sta in cima all'area riservata (e in login e
pagine dei link account), entrambi sopra la testata della pagina pubblica; la variante è scelta dal portale in base allo
sfondo. Contratti in `packages/shared/src/systemLogos.ts` (`docs/architettura.md`), pagina in `docs/portale.md`
(«Loghi di sistema»).

- **Tabella** `system_logos` (migrazione `0016_loghi_sistema.sql`, poi `0017_loghi_sistema_varianti.sql`): una riga per
  slot e variante (chiave primaria `(slot, variant)`, CHECK `left`/`right` e `positive`/`negative`), `id` (uuid, unico,
  nuovo a ogni caricamento), `sha256`, `mime`, `width`, `height` (CHECK: larghezza 1-150 e altezza 1-50), `bytes`,
  `updated_at`. La `0017` aggiunge `variant` (predefinito `positive`): i loghi già caricati diventano positivi. Il file
  è in `<ASSETS_DIR>/_system/<sha256>` (`assetStore.ts`: `writeSystemLogoFile`, `readSystemLogoFile`,
  `removeSystemLogoFile`).
- **Rotte pubbliche** (rate limit pubblico): `GET /api/public/system-logos` dà `{ left: { positive, negative }, right:
  { positive, negative } }` (ogni variante `{ url, mime, width, height }` o `null`), `Cache-Control: public, max-age=30`, uguale per ogni hostname; `GET
  /api/public/system-logos/:id` dà il file con gli stessi header delle immagini pubbliche (tipo dal database,
  `nosniff`, `inline`, CSP per gli SVG) e `Cache-Control` immutabile di un anno, perché l'`id` cambia a ogni caricamento.
- **Rotte admin** (solo `superadmin`, anche fuori da un cliente): `PUT /api/admin/system-logos/:slot/:variant` (JSON
  `{ data }` in base64, corpo fino a ~2,7 MB) e `DELETE /api/admin/system-logos/:slot/:variant` (la vecchia rotta
  `/:slot` senza variante dà 404); la risposta è la nuova lista completa come nella `GET` pubblica.
  Il `PUT` controlla l'immagine con `inspectImage` (tipo e misure dai byte; SVG controllato, per gli SVG vale la misura
  dichiarata): 413 oltre 2 MB, 422 per un'immagine non ammessa o più grande di 150×50 px («Logo troppo grande: al massimo
  150×50 px, questo è …»). Caricamento e rimozione sono serializzati da un advisory lock (`pg_advisory_xact_lock`); il file
  vecchio è cancellato se nessun altro slot o variante lo usa (i quattro posti possono condividere lo stesso file).
- **Log**: `redactUrl` (`src/app.ts`) maschera nei log anche `/api/public/system-logos…`.
- **Test**: `apps/server/test/` (loghi di sistema).

### Pagina pubblica a blocchi (`apps/server/src/routes/branding.ts`)
Ogni cliente sceglie i blocchi della pagina della partita per TV, tablet e telefono (`TenantLayoutSchema`,
`tenants.layout`; forma e tipi di blocco in `docs/architettura.md`, editor in `docs/portale.md`). `{}` è valido e vale i
blocchi predefiniti (`resolveLayout`). Il predefinito dipende dal modello grafico del cliente (`branding.template`,
`docs/architettura.md`): `resolveLayout(documento, template)` dà a ogni dispositivo mai salvato la pagina predefinita del
modello (per SIR VOLLEY quella del mockup), sia in `GET /api/admin/layout` sia in `GET /api/public/tenant`
(`apps/server/src/routes/branding.ts`). Dopo il primo salvataggio il layout del cliente resta fisso anche se cambia
modello.

- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET /api/admin/layout` e
  `PUT /api/admin/layout`; il corpo del `PUT` è il layout e la risposta è `LayoutResponse` (`tenantName`, `layout`). Corpo
  al massimo 64 KB (limite predefinito del server). Il layout è validato con lo schema condiviso (tipi chiusi, opzioni
  per tipo, id unici, un solo tabellone, larghezze ammesse, al massimo 24 blocchi per dispositivo): altrimenti 400.
- **Sponsor e immagini dei blocchi**: gli id in `options.sponsors` dei blocchi `sponsor` (`layoutSponsorIds`, al massimo 12
  per blocco) devono essere sponsor di quel cliente (`requireOwnSponsors`: altrimenti 400 «sponsor non trovato»); gli id in
  `options.images` (`layoutImageIds`, immagini singole, opzione mantenuta per compatibilità con i layout salvati prima)
  devono essere immagini di quel cliente. I controlli sono nella stessa transazione e sotto lo stesso lock per cliente di
  caricamenti, eliminazioni e grafica; altrimenti 400. Dopo il salvataggio si svuota la cache degli hostname (`forgetTenants`).
- **Rotta pubblica**: `sponsors` di `GET /api/public/tenant` (`PublicSponsorSchema`: `id`, `name`, `website`, `images` come
  percorsi pubblici) contiene solo gli sponsor scelti da pagina e pause (`publicSponsors`), nell'ordine dell'elenco del
  cliente. `layout` è anche in `GET /api/public/tenant` (`PublicTenantResponseSchema`), così il portale lo
  legge con la grafica. Un layout non valido o di versione futura si legge come predefinito: quando `TENANT_CONFIG_VERSION`
  salirà servirà una migrazione dei layout salvati.
- **Eliminazione di un'immagine**: se è usata come immagine singola di un blocco sponsor, `DELETE /api/admin/assets/:id`
  risponde 409 «Immagine in uso nella pagina pubblica: toglila dal blocco sponsor prima di eliminarla» (come per la
  grafica). Le immagini di uno sponsor scelto dalla pagina seguono la regola dello sponsor (vedi «Sponsor»).

### Pause della partita (`apps/server/src/routes/branding.ts`)
Ogni cliente sceglie cosa vede il pubblico durante i time-out, a fine set e a fine partita (`TenantIntermissionsSchema`,
`tenants.intermissions`; forma, predefiniti e regole in `docs/architettura.md`, schermate ed editor in `docs/portale.md`).
La fase della partita (`state.phase`) è calcolata da `@arenalive/volley-stats` (`docs/statistiche.md`): il server non decide
nulla, la fase viaggia nello stato come ogni altro campo. `{}` è valido e vale i predefiniti (`resolveIntermissions`).

- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET /api/admin/intermissions`
  e `PUT /api/admin/intermissions` (nessuna rotta nuova per le diapositive in stile TV e per «ogni N punti»: lo schema
  condiviso accetta i nuovi tipi di diapositiva, `milestone` con `every` e `stopBeforeEnd`; documenti salvati prima restano
  validi, i campi mancanti prendono i predefiniti); il corpo del `PUT` è il documento delle pause e la risposta è `IntermissionsResponse`
  (`tenantName`, `intermissions`). Validazione con lo schema condiviso (tipi di diapositiva chiusi, durate 3-60 s, ritardo
  0-60 s, al massimo 12 diapositive, una pausa attiva con almeno una diapositiva): altrimenti 400.
- **Sponsor e immagini delle diapositive**: gli id `sponsors` delle diapositive `sponsor` (`intermissionSponsorIds`) devono
  essere sponsor di quel cliente e gli `images` (`intermissionImageIds`) immagini di quel cliente, controllati nella stessa
  transazione e sotto lo stesso lock per cliente di caricamenti, eliminazioni, grafica e layout; altrimenti 400. Dopo il salvataggio si svuota la cache degli hostname (`forgetTenants`).
- **Rotta pubblica**: `intermissions` è anche in `GET /api/public/tenant` (`PublicTenantResponseSchema`), con i predefiniti
  se il cliente non ha configurato nulla.
- **Diapositive spente**: ogni diapositiva ha `enabled` (predefinito `true`, quindi i documenti salvati prima restano
  validi); `intermissionFor` dà `null` se la pausa non ha nessuna diapositiva attiva, e gli sponsor e le immagini di una
  diapositiva spenta contano comunque «in uso» per i controlli di eliminazione.
- **Eliminazione di un'immagine**: se è usata in una diapositiva sponsor, `DELETE /api/admin/assets/:id` risponde 409
  «Immagine in uso nelle pause: toglila dalla diapositiva sponsor o da «Dopo la partita» prima di eliminarla».
- **«Dopo la partita»** (`afterMatch`: `enabled`, `image`, `delayMinutes`; contratto in `docs/architettura.md`): l'immagine
  rientra in `intermissionImageIds`, quindi il `PUT` la verifica (400 se non è del cliente) e conta «in uso» anche a
  schermata spenta. L'importazione della grafica (`graphicsTransfer.ts`) rimappa anche questa immagine sui nuovi id.
  L'orario di fine è salvato dal server (sotto, in «Ingest»), non è nella configurazione.

### Sponsor (`apps/server/src/routes/sponsors.ts`, `apps/server/src/sponsors.ts`)
Anagrafica degli sponsor di un cliente: nome, sito facoltativo e immagini. Il blocco sponsor della pagina e la diapositiva
sponsor delle pause scelgono gli sponsor e ne mostrano le immagini a rotazione (contratti in `docs/architettura.md`,
«Sponsor»; pagina in `docs/portale.md`, «Sponsor»).

- **Tabelle** (migrazione `0015_sponsor.sql`): `sponsors` (`tenant_id`, `name` 1-80 caratteri, univoco per cliente
  (`sponsors_tenant_name_idx`), `website` facoltativo che inizia con `https://`, `position`, `created_at`) e
  `assets.sponsor_id` (→ `sponsors`, `ON DELETE SET NULL`). Un'immagine appartiene a un solo sponsor; le immagini sponsor
  già presenti restano «senza sponsor» (`sponsor_id` nullo).
- **Rotte admin** (`/api/admin/sponsors`, il superadmin lavora sul cliente attivo): `GET` (ruolo `viewer`, elenco con
  `imageIds` nell'ordine di caricamento); `POST` (crea, ultimo nell'elenco), `PATCH /:id` (nome e/o sito), `PUT /order`
  (`ids`: tutti gli sponsor del cliente una volta, altrimenti 400), `DELETE /:id` (204), tutte del ruolo `admin` e sotto il
  lock per cliente (`lockClientAssets`). Il sito è normalizzato (`SponsorWebsiteSchema`: solo `https://`, host presente,
  niente credenziali). Limiti: `SPONSORS_MAX` = 50 sponsor per cliente, `SPONSOR_IMAGES_MAX` = 12 immagini per sponsor,
  `SPONSOR_BLOCK_MAX_SPONSORS` = 12 sponsor per blocco o diapositiva (400 dalla validazione del layout e delle pause).
  Oltre i primi due limiti, 409; nome già usato: 409 «Esiste già uno sponsor con questo nome».
- **Eliminazione**: 409 se lo sponsor è scelto da un blocco della pagina («Sponsor in uso nella pagina pubblica…») o da
  una diapositiva delle pause («Sponsor in uso nelle pause…»); altrimenti elimina anche le sue immagini non usate altrove
  (branding o immagini singole di un blocco): quelle ancora usate restano, senza sponsor.
- **Immagini**: `POST /api/admin/assets` accetta `sponsorId` (solo con `kind: 'sponsor'`, sponsor del cliente: 400
  altrimenti; 409 se lo sponsor ha già 12 immagini o se lo stesso file è già immagine di un altro sponsor). `PATCH
  /api/admin/assets/:id` (`UpdateAssetRequestSchema`, `{ sponsorId }` e/o `{ name }`; `name` rinomina il file nelle liste,
  `null` lo toglie) assegna un'immagine sponsor a uno sponsor o la toglie
  (`null`); un logo non può avere uno sponsor (400); un'immagine già di un altro sponsor si sposta con questa rotta.
  `POST /api/admin/assets` accetta anche `name` (nome del file scelto, `AssetNameSchema`). `AssetSummary` contiene `sponsorId` e `name`.
- **Pagina e pause**: `PUT /api/admin/layout` e `PUT /api/admin/intermissions` rifiutano (400) sponsor di altri clienti.
- **Rotta pubblica**: `GET /api/public/tenant` espone `sponsors` (`{ id, name, website, images }`) solo per gli sponsor
  usati da pagina e pause; la modifica di nome, sito, ordine o scelta svuota la cache degli hostname (`forgetTenants`).
- **Grafica esportata**: vedi «Esporta / importa la grafica» (gli sponsor scelti viaggiano nel pacchetto).
- **Test**: `apps/server/test/sponsors.test.ts` e quelli di grafica, layout, pause e migrazione.

### Avvisi sugli eventi (`apps/server/src/routes/branding.ts`)
Ogni cliente sceglie quali eventi della partita (ace, set point, match point…) compaiono come avviso breve sopra la pagina
pubblica, con testo, durata, dispositivi e priorità (`TenantOverlaysSchema`, `tenants.overlays`; forma, segnaposto e
predefiniti in `docs/architettura.md`, schermata ed editor in `docs/portale.md`). Gli eventi (`state.events`) sono calcolati
da `@arenalive/volley-stats` (`docs/statistiche.md`) e viaggiano nello stato come ogni altro campo: il server non decide nulla.
`{}` è valido e vale i predefiniti (`resolveOverlays`).

- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET /api/admin/overlays` e
  `PUT /api/admin/overlays`; il corpo del `PUT` è il documento degli avvisi e la risposta è `OverlaysResponse`
  (`tenantName`, `overlays`). Validazione con lo schema condiviso (eventi e segnaposto in lista chiusa, testo senza `<` e `>`,
  durata 2-8 s, priorità 1-10): altrimenti 400. Ogni avviso può avere `background` (`{ kind: 'image' | 'video', assetId }`):
  il `PUT` verifica (`requireOwnBackgrounds`, sotto il blocco del cliente) che il file sia del cliente, di `kind` `overlay` e
  del tipo dichiarato (video per `video`, immagine per `image`), altrimenti 400. Un file usato come sfondo non si può
  eliminare (`assetUse`, 409 «File in uso come sfondo di un avviso…»). L'esportazione e l'importazione della grafica
  (`graphicsTransfer.ts`) tolgono gli sfondi (`withoutOverlayBackgrounds`): i video fino a 15 MB non viaggiano nel
  pacchetto e gli avvisi restano con il solo testo. Dopo il salvataggio si svuota la cache degli hostname (`forgetTenants`).
- **Rotta pubblica**: `overlays` è anche in `GET /api/public/tenant` (`PublicTenantResponseSchema`), con i predefiniti se il
  cliente non ha configurato nulla (`apps/server/src/tenancy.ts` legge la colonna).

### Agente scaricabile (`apps/server/src/routes/agentDownload.ts`)
Il portale offre l'agente per Windows come zip già pronto per il cliente (portale: `docs/portale.md`, pagina «Agenti»;
finestra e grafica: `docs/agente.md`; costruzione dell'exe: `docs/infrastruttura.md`). L'exe è **uno solo per tutti i
clienti**, costruito da `scripts/pubblica-agente-produzione.sh` (agente C#, via `scripts/costruisci-agente-dotnet.sh`; l'exe Node si fa a mano con `scripts/costruisci-agente.sh`) in `AGENT_DOWNLOAD_DIR` insieme a `arenalive-agent.json`
(`AgentReleaseSchema`: `version`, `builtAt`, `sha256`, `nodeVersion` facoltativa); lo zip è generato **a ogni richiesta**.

- **Rotte** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`; un viewer riceve 403):
  - `GET /api/admin/agent/info` → `AgentDownloadInfo`: `{ available: false }` oppure `available`, `version`, `builtAt`,
    `bytes`, `sha256`, `fileName`. Risposta `no-store`.
  - `GET /api/admin/agent/download` → lo zip `ArenaLive-agente-<slug>-<versione>.zip` (`agentDownloadFileName`),
    `Content-Type: application/zip`, `Content-Disposition: attachment`, `Content-Length` noto, `no-store`. Se l'exe non è
    pubblicato: 404 «L’agente non è ancora stato pubblicato sul server» (apostrofo tipografico). Ha un limite proprio
    (`RATE_LIMIT_AGENT_DOWNLOAD`, 10 al minuto per IP), separato da quello delle altre rotte admin.
- **Contenuto dello zip**, tutto nella cartella `ArenaLive-agente/` (`AGENT_ZIP_FOLDER`):
  - `arenalive-agent.exe`;
  - `config.json`: `watchPath` `E:\`, `serverUrl`, `dataDir` `C:\ArenaLiveAgent\data`, `logDir` `C:\ArenaLiveAgent\logs`
    (`agentDownloadConfig`). **Mai un token**: arriva con la registrazione automatica. `serverUrl` è l'URL pubblico del
    cliente (`publicBaseUrlFor`), **mai ricavato dall'header `Host`**; `allowHttpPrivateNetwork: true` c'è solo per `http`
    verso un IPv4 privato (prove in LAN);
  - `branding.json` (`AgentBrandingSchema`, versione 1): nome visualizzato del cliente e sei colori `#rrggbb` già risolti
    (`agentBranding`: i colori scelti dal cliente sopra quelli del suo template, `resolveBrandColors` in
    `packages/shared/src/colors.ts`, la stessa funzione del manifest e degli avvisi di contrasto);
  - `logo.png` o `logo.jpg`: il logo orizzontale (`logoMain`), altrimenti quello quadrato (`logoMark`), solo se PNG o JPEG,
    fino a 2 MB e 1024×1024 px; SVG e WebP sono esclusi (WinForms non li legge). Senza un logo adatto non c'è;
  - `LEGGIMI.txt` (UTF-8 con BOM, fine riga CRLF): installazione in `C:\ArenaLiveAgent`, SmartScreen («Ulteriori informazioni» →
    «Esegui comunque»), registrazione e sha256 dell'exe (`readmeText`).
- **Controllo dell'exe** (`AgentReleaseStore`, `apps/server/src/agentRelease.ts`): l'exe è offerto solo se lo sha256 del
  file coincide con `arenalive-agent.json`; sha256 e CRC-32 si calcolano **una volta per versione** del file (inode, dimensione,
  data di modifica). Il file è aperto una volta per richiesta: se viene sostituito durante un download, quel download
  continua a leggere il vecchio file e non si rompe. Manca o non coincide: «non disponibile» (con un messaggio nel log).
- **Zip scritto in casa** (`apps/server/src/lib/zip.ts`, `zipStream`): formato «store» (senza compressione), CRC con
  `zlib.crc32`, file letto a pezzi (mai tutto in memoria), il file è chiuso anche se il download si interrompe.
  Scelta in `docs/decisioni.md`.
- Nginx (`docker/web.nginx.conf`) ha `proxy_buffering off` solo per questa rotta (`docs/portale.md`).

### Campionati (`apps/server/src/leagues/`, `src/routes/leagues.ts`)
Il server scarica dai **siti ufficiali** calendario, classifica, squadre e loghi dei campionati. Oggi c'è un solo
fornitore, la Lega Pallavolo Serie A (`https://www.legavolley.it`, `LeagueProviderSchema` = `legavolley`). I dati sono
pubblici e **comuni a tutti i clienti** (nessun `tenant_id`): si scaricano una volta sola. Le rotte `/api/admin/leagues`
sono del superadmin; ogni cliente sceglie fra i campionati già noti la sua squadra (vedi «Club, calendario e
abbinamento»); la classifica va ai blocchi e alle diapositive del portale con la rotta pubblica descritta in «Club,
calendario e abbinamento» (`docs/portale.md`, «Blocchi del calendario»). Fonte: dati ufficiali
della Lega; **l'uso dei marchi (loghi) va ancora chiarito con la Lega e i club** (punto aperto).

**Come si aggiunge**: `POST /api/admin/leagues` con `{ provider, externalId, season }`. `externalId` è l'`IdCampionato` del
sito e **cambia a ogni stagione** (SuperLega 2025/26 = 974, 2026/27 = 999); `season` è il primo anno (2025 = 2025/2026).
Al primo aggiornamento la pagina scaricata deve mostrare lo stesso `IdCampionato` e la stessa stagione, altrimenti
l'aggiornamento fallisce con un messaggio che chiede di controllarli.

**Cosa si scarica** (`legavolley.ts`): il calendario (`/calendario/?Anno=<anno>&IdCampionato=N`, con `&IdFase=F&IdSquadra=0`
per ogni fase), la classifica «fino ad oggi» (`/classifica/`), la pagina di ogni squadra (`/team/N`: palazzetto, indirizzo,
città) e il logo (`/GetLogo.aspx`, con `Web=1`: con `Web=0` il sito dà un segnaposto 2x2 anche a squadre che un logo
ce l'hanno). Struttura del sito: una tabella per giornata con colonne `#`, data e ora ufficiale, casa, risultato, ospite,
arbitri, impianto, note; l'id della squadra è nell'`onclick` (`/team/N`); la classifica ha 18 colonne e nessun id squadra
(si abbina alle squadre del calendario per nome, senza maiuscole, spazi e accenti: `teamNameKey`). L'id stabile di una
partita (`fixtures.external_id`) è il **numero ufficiale** (`n<numero>`; senza numero, fase, giornata e squadre).
Per la rosa si leggono anche la tabella «Roster» della pagina della squadra (`parseRoster`, `ParsedRosterPlayer`; solo i
giocatori, niente staff) e la foto (`/Foto.aspx`, ammessa fra i percorsi consentiti; `playerPhotoUrl(chiave, squadra)` accetta
solo una chiave validata da `PLAYER_KEY_PATTERN` e id numerici, mai un URL preso dalla pagina; `heightImg=600`). Il download
`photo` del fetcher ha il limite di 300 KB. Sono saltati i segnaposto e le foto troppo piccole (`fetchPlayerPhoto` dà `null`).
`fetchRoster` rilegge sempre la pagina (mai dalla cache).

**Regole di buona educazione e sicurezza** (`legavolley.ts`, `fetcher.ts`):

- gli URL si costruiscono solo da numeri validati (`calendarUrl`, `standingsUrl`, `teamUrl`, `logoUrl`); `rejectedUrlReason`
  rifiuta ogni altro schema, host, credenziali, frammento, i percorsi vietati da `robots.txt`
  (`LEGAVOLLEY_ROBOTS_DISALLOWED`, controllato il 2026-10-16) e quelli fuori da `LEGAVOLLEY_ALLOWED_PATHS`;
- redirect seguiti a mano, al massimo 3 e solo verso URL ammessi;
- timeout di 15 s (`DOWNLOAD_TIMEOUT_MS`) valido anche per la lettura del corpo; al massimo 2 MB per pagina e 300 KB per
  logo (`DOWNLOAD_LIMITS`), contati **anche dopo la decompressione**;
- una richiesta per volta, con almeno 1 s fra due partenze (`MIN_REQUEST_INTERVAL_MS`);
- `User-Agent` `ArenaLive/<versione> (+<contatto>)` (`leagueUserAgent`), con contatto `LEAGUE_CONTACT` o, se manca,
  `PUBLIC_BASE_URL`;
- richieste condizionate (`ETag` / `Last-Modified` in `league_http_cache`), salvate **solo dopo** la scrittura dei dati: un
  aggiornamento fallito riscarica tutto;
- il lettore HTML è nostro (`html.ts`, nessuna libreria): tokenizer, albero costruito con una pila esplicita (nessuna
  ricorsione) e profondità massima 512, estrazione di tabelle e `select`. I caratteri NUL delle pagine sono tolti alla decodifica
  (`decodePage`, `fetcher.ts`), perché PostgreSQL non li salva;
- ora ufficiale italiana convertita in UTC con `Intl` (`romeTime.ts`), ora legale compresa; limiti di sicurezza
  `MAX_PHASES` 12, `MAX_TEAMS` 64, `MAX_FIXTURES` 2000.

**Aggiornamento di un campionato** (`LeagueService`, `sync.ts`):

1. si prende il **lease** (`leagues.sync_started_at`) con una `UPDATE` condizionata: dura 15 minuti (`SYNC_LEASE_MS`) ed è
   rinnovato durante l'aggiornamento (al massimo una scrittura al minuto, `LEASE_RENEW_MS`, prima di ogni scrittura e fra una
   squadra e l'altra) solo finché è ancora nostro; un lease più vecchio è di un processo morto e si riprende. Se un altro
   processo lo ha ripreso, l'aggiornamento si ferma e **non scrive l'esito**, che spetta a chi ha il lease. Chi non lo
   ottiene riceve «già in corso»;
2. si scaricano le fasi del calendario e (sempre, oppure solo se una partita è diventata «giocata») la classifica;
   **nessuna transazione resta aperta durante i download**;
3. si scrive tutto in una sola transazione con un **advisory lock** (`pg_advisory_xact_lock`) preso solo qui: partite
   inserite o aggiornate solo se cambia `content_hash`, partite sparite dalla fase cancellate, classifica sostituita per
   intero. Una fase che ora risulta **vuota non cancella** le sue partite;
4. si scaricano pagine squadra e loghi mancanti o più vecchi di 7 giorni (`TEAM_DETAILS_MAX_AGE_MS`). Un errore di una
   squadra non annulla l'aggiornamento: l'esito è `ok` con messaggio «Aggiornato con avvisi: …» (pagine squadra non lette,
   loghi non validi o non scaricati, loghi assenti; anche un errore interno nella fase squadre e loghi dà questo esito:
   calendario e classifica sono già salvati);
5. l'esito (`lastStatus`, `lastMessage`, `lastSyncAt`, `lastSuccessAt`) si registra sempre e il lease si libera. Un errore di
   rete o di formato **non perde i dati già salvati**.

**Loghi**: salvati in `ASSETS_DIR/_leagues/<sha256>` (`assetStore.ts`: `writeLeagueLogoFile`, `readLeagueLogoFile`), dopo il
controllo dei byte con `inspectImage` (PNG, JPEG, WebP, SVG a lista di elementi ammessi); le immagini sotto 16 px per lato
(`LOGO_MIN_SIDE`) sono il segnaposto del sito e si scartano. Un logo uguale a uno già salvato non si duplica. Il file ha il
nome del suo hash: la risposta pubblica è `immutable`. I loghi non più usati restano in `team_logos` (limite noto).

**Pianificazione** (`LeagueScheduler`, `scheduler.ts`, spenta con `LEAGUE_SYNC=off`): ogni minuto cerca cosa è dovuto e aggiorna
un campionato alla volta (`dueSyncs`, pura): ogni notte dopo le 04:00 ora italiana (`NIGHTLY_HOUR`) con la classifica; nei
giorni in cui un club di un cliente ha una partita del campionato (`leaguesWithClubMatches`, `src/club.ts`: partite di
`client_fixtures` non rimosse, giorno italiano), ogni 10 minuti (`MATCH_DAY_INTERVAL_MS`), con la classifica solo dopo un
nuovo risultato. Ogni aggiornamento riuscito ricopia le partite dei club interessati (`onUpdated`, cablato in `app.ts`).

**Rotte** (solo superadmin, limite admin; vedi «Endpoint»): `GET /api/admin/leagues` (elenco con `sync.running`),
`POST /api/admin/leagues` (201; 409 se già presente), `GET /api/admin/leagues/:id` (squadre, partite, classifica) e
`POST /api/admin/leagues/:id/sync` («Aggiorna ora»): risponde **202** e lavora in background (circa 30 s per la
SuperLega), **409** se un aggiornamento è già in corso, **429** oltre `RATE_LIMIT_LEAGUE_SYNC` al minuto per IP.
Pubblica: `GET /api/public/team-logos/:id`, `Content-Type` dal database (riconosciuto dai byte al download), `nosniff`,
`Content-Disposition: inline`, `cache-control` immutabile, e per gli SVG la stessa CSP delle immagini dei clienti.

**Limiti noti**: i parziali dei set non sono nel calendario (`result.sets` è `null`); «rinviata» si riconosce da una parola
chiave nelle Note; non c'è un nome breve della squadra (`short_name` resta vuoto).

**Prova reale** (2026-10-16, `IdCampionato` 974, 2025/26): 22 giornate, 132 partite, 12 squadre, 12 loghi; Perugia prima con
58 punti. Le pagine vere usate dai test sono in `apps/server/test/fixtures/legavolley/`.

### Serie del club e catalogo (`src/leagues/catalog.ts`, `src/leagues/seasons.ts`, `src/routes/clubLeague.ts`)
Lavoro «primo-accesso». Contratti in `packages/shared/src/leagues.ts` (`docs/architettura.md`); procedura nel portale in
`docs/portale.md`. Il club sceglie **genere e serie** (oggi `M` e `superlega`/`a2`/`a3`) e il server trova il campionato
della stagione in corso.
- **Catalogo in memoria** (`LeagueCatalog`): la scoperta parte dalla pagina `/calendario/` del sito e segue gli
  `IdCampionato` dei link di navigazione (dai più alti, la stagione più recente) finché ogni serie ha un campionato, al
  massimo `CATALOG_MAX_PAGES` = 10 pagine. Gli indirizzi li costruiamo sempre noi (`calendarMenuUrl`,
  `championshipPageUrl`): dal sito si leggono solo numeri. Una lettura serve tutti i clienti; è riletta dopo 12 ore su
  richiesta (`CATALOG_MAX_AGE_MS`) e dall'aggiornamento notturno dopo 20 (`CATALOG_NIGHTLY_AGE_MS`), solo se un cliente
  ha una serie. Una pagina di un campionato che dà `LeagueFormatError` è saltata (registrata nel log) e la scoperta prosegue; se alla fine manca la serie chiesta, la scelta dà `LEAGUE_FORMAT`. Se è cambiata la prima pagina, errore subito.
- `GET /api/admin/club/league` (viewer): `ClubLeagueStatus`; `state` è `ready` quando ogni campionato della serie è stato
  scaricato almeno una volta (anche se un aggiornamento successivo fallisce), `error` se uno non è mai riuscito,
  altrimenti `downloading`; `none` senza serie.
- `POST /api/admin/club/league` (admin; limite `RATE_LIMIT_LEAGUE_SYNC`): corpo `SelectClubLeagueRequestSchema`.
  Aggiunge i campionati non noti (`linkSeries`), li collega al cliente (quelli della serie scelta prima vengono tolti; se
  il cliente ha già una squadra in uno dei gironi resta solo quello) e avvia in background il download di quelli mai
  scaricati (il lease dell'aggiornamento fa da blocco: niente parte due volte; un campionato già scaricato da altri è
  riusato). Risposta **202** mentre scarica, **200** se pronto; **502** `LEAGUE_UNAVAILABLE` («Il sito della Lega non
  risponde: riprova tra poco») o `LEAGUE_FORMAT` (pagina cambiata o serie assente dalla stagione); 400 per serie non del
  genere.
- **Altre competizioni della serie** (`CLUB_COMPETITIONS_PATH` = `/api/admin/club/competitions`, `src/routes/clubLeague.ts`,
  solo admin del cliente, non serve il superadmin): `GET` → `ClubCompetitionsResponse` con le competizioni (coppe, Supercoppa,
  play off…) della stagione in corso lette dal menu «Campionato» della pagina del primo campionato della serie sul sito
  della Lega (`LeagueCatalog.competitionsOf` in `src/leagues/catalog.ts`, con cache limitata), escluse le gare della serie
  (`seriesCompetitions`, `packages/shared/src/leagues.ts`) e quelle già collegate. `POST` (`AddClubCompetitionRequestSchema`,
  `{ externalId }`; limite per minuto `leagueSync`; `lockTenantMatches` come la copia del calendario): l'id entra in `leagues`
  solo se è nel menu del sito (400 altrimenti), si collega al cliente senza squadra, si scarica in background se mai
  scaricata e si ricopia il calendario. Risposta `ClubResponse`: **201**, **200** se già scelta; 409 senza serie o oltre
  `CLUB_MAX_LEAGUES`; 502 (`LEAGUE_UNAVAILABLE`/`LEAGUE_FORMAT`) se il sito non risponde o è cambiato.
- **Squadra automatica** (`pickCompetitionTeams` e `findClubTeam`, `src/leagues/competitions.ts`, chiamata nella copia del
  calendario in `src/club.ts`): per i campionati non della serie e senza squadra, a campionato scaricato, si sceglie la squadra
  della serie con lo stesso id del sito, poi con lo stesso nome; il ripiego «unica squadra che contiene il nome di nostra squadra»
  vale solo se la squadra della serie non c'è. Se non si riconosce nessuna squadra, il campionato resta senza squadra e non
  porta partite (avviso «Senza squadra non arriva nessuna partita»).
- **Cambio di stagione delle competizioni** (`advanceCompetitions`, `src/leagues/seasons.ts`, in un `try` separato da
  `advanceSeasons`): ogni competizione di una stagione vecchia passa a quella dello stesso tipo (`competitionKind`) del menu
  della serie, se è unica, già scaricata e con la squadra riconosciuta; altrimenti resta e si riprova la notte dopo. La serie
  non è toccata.
- **A3 ha due gironi**: si scaricano entrambi e `teams` li elenca insieme; quando il cliente sceglie la squadra
  (`PUT /api/admin/club`, anche dalla pagina «Club») il server toglie gli altri gironi della serie e resta collegato solo il
  girone di quella squadra.
- **Cambio di stagione** (`advanceSeasons`, nell'aggiornamento notturno dopo la rilettura del catalogo): per ogni cliente
  con una serie, se il catalogo nomina campionati diversi, li aggiunge e li scarica; a download riuscito il cliente passa
  al nuovo con la stessa squadra (si tolgono solo i collegamenti della serie corrente: coppe e play off aggiunti dal
  superadmin restano), ritrovata per id esterno o, in mancanza, per nome (`teamNameKey`). Se la squadra non
  c'è, resta il vecchio campionato e il profilo segna `newSeason` («Nuova stagione: scegli di nuovo la squadra»). Un
  errore su un cliente è registrato e non ferma gli altri.
- `PUT /api/admin/club/profile` salva solo `coverage` e `teamLogos` del profilo; genere, serie, campionati e `newSeason`
  restano quelli del database, anche se una scheda «Club» vecchia li rimanda.
- **Primo accesso**: `GET /api/admin/onboarding` (viewer) e `POST /api/admin/onboarding/complete` (admin, «Fine»; imposta
  `tenants.onboarded_at` una volta sola) rispondono con `OnboardingStatus` (`src/routes/onboarding.ts`). Colonna e
  migrazione in «Database».

### Rosa della squadra (`src/roster.ts`, `src/rosterImport.ts`, `src/routes/roster.ts`)
La rosa del cliente per stagione (`players`, `player_media`; contratti in `packages/shared/src/players.ts`, `docs/architettura.md`),
importata dal sito della Lega e ritoccabile a mano. La pagina del portale arriva a parte.

- **Squadra e stagione** (`rosterContext`): la squadra della serie del club (`seriesTeamOf`) e la sua stagione; il primo
  campionato scelto solo se il club non ha una serie. Senza squadra: nessuna importazione (409).
- **Rotte** (`src/routes/roster.ts`): `GET /api/admin/roster?season=` (viewer; senza `season`
  la stagione della serie); `POST /api/admin/roster/players` (admin, 201; 409 senza stagione, numero già usato o `PLAYERS_MAX`
  giocatori attivi: i rimossi non contano); `PATCH` e `DELETE /api/admin/roster/players/:id` (un giocatore a mano si cancella,
  uno importato si segna rimosso e un'importazione non lo riporta; `PATCH removed: false` lo rimette, 409 se il numero è
  occupato); `PUT /api/admin/roster/players/:id/media` (foto principale e altri file: solo file del cliente di `kind` `player`, la
  principale un'immagine, al massimo `PLAYER_MEDIA_MAX` e `PLAYER_VIDEOS_MAX`, 400 altrimenti); `POST /api/admin/roster/import`
  (admin, limite per minuto `RATE_LIMIT_ROSTER_IMPORT`, predefinito 3; 409 senza squadra o con un'importazione già in corso,
  502 `LEAGUE_UNAVAILABLE`/`LEAGUE_FORMAT` se il sito non risponde o è cambiato). I campi inviati con `PATCH` e la foto principale
  scelta a mano finiscono in `edited_fields`.
- **Unione** (`mergeRoster`, pura): il giocatore è lo stesso per la chiave del sito (`external_key`); un giocatore a mano con
  stesso numero e cognome (senza maiuscole né accenti) viene adottato (prende la chiave, i suoi dati restano come a mano). Si
  aggiornano solo i campi non in `edited_fields`; chi è rimosso resta rimosso. I numeri finali si decidono insieme (due
  giocatori possono scambiarsi il numero); un cambio verso un numero che un altro tiene, o un nuovo giocatore con numero già
  usato, restano invariati e sono segnalati fra i `skipped` con il motivo. Chi non è più sul sito non si cancella (`notOnSite`).
- **Foto in sottofondo** (`RosterPhotoJobs`): dopo l'unione, un lavoro per cliente alla volta scarica le foto mancanti
  (giocatori importati senza foto principale e senza `photo` fra i campi modificati), le controlla dai byte e le salva nella
  libreria come file `player` con nome «Cognome Nome.jpg»; poi diventano la foto principale se nel frattempo non ne è stata scelta
  una. Lo stato (`RosterImportState`) sta solo in memoria e si perde al riavvio. Se la quota del cliente è superata il lavoro si
  ferma (`lastError`); le foto non scaricate sono contate nel messaggio.
- **File dei giocatori**: `POST /api/admin/assets/video?kind=player` (`VideoUploadQuerySchema`) e `POST /api/admin/assets` con
  `kind: 'player'`; un file usato da un giocatore non si elimina (409 «File in uso da … della rosa»).
- **Pagina pubblica**: `players` di `GET /api/public/tenant` (`publicPlayerMedia`): solo la stagione corrente, solo i giocatori
  con almeno un file, solo gli id dei file (non i dati personali). Ogni modifica avvisa le pagine (`tenantConfigChanged`).

### Club, calendario e abbinamento (`src/club.ts`, `src/leagues/match.ts`, `src/matchLock.ts`, `src/routes/club.ts`)
Ogni cliente sceglie uno o più campionati già noti (al massimo `CLUB_MAX_LEAGUES` = 8) e in ognuno la sua squadra
(`tenant_leagues`). Dal calendario del campionato il server copia le partite di quella squadra in `client_fixtures`, dà a
ognuna un link pubblico breve e abbina a ogni partita il `.dvw` che arriva dall'agente. Contratti in
`packages/shared/src/club.ts` (`docs/architettura.md`); pagine «Club», «Calendario» e «Prossima partita» in
`docs/portale.md`. Un admin sceglie solo tra i campionati già noti; il superadmin li aggiunge dalla pagina «Campionati»
(rotta `POST /api/admin/leagues`; `LeagueSummary.plan` = prossimo aggiornamento automatico e `matchToday`). Profilo del
club, partite aggiunte a mano e canale sono in «Profilo del club, partite del cliente e canale» più sotto.

**Copia delle partite** (`refreshClientFixtures`, `club.ts`; `refreshClub` in `state.ts` la lancia e poi avvisa i client):
avviene al salvataggio delle scelte (`PUT /api/admin/club`), a «Aggiorna calendario» e a ogni aggiornamento riuscito di un
campionato (`onUpdated` di `LeagueService`, cablato in `app.ts` su `tenantsOfLeague`). È **idempotente**: una riga per
partita (indice univoco su cliente, campionato e `fixture_external_id`), aggiornata sul posto con nomi, città, loghi,
impianto, giornata, stato e set. Una partita che sparisce dal calendario non si cancella: prende `removed_at` e il suo
link resta (altrimenti QR già stampati e `.dvw` abbinati si perderebbero). I link delle partite del calendario si creano da
soli a ogni aggiornamento del calendario, senza che l'admin faccia nulla: ogni partita non rimossa senza link ne riceve uno
(`ensureFixtureLinks` in `apps/server/src/club.ts`, chiamata da `refreshClientFixtures` nella stessa transazione; **solo se il
cliente ha l'opzione «Link e QR per singola partita»**, vedi «Clienti»; indice univoco **parziale**
`share_tokens_client_fixture_idx`, un link non revocato per partita; un link revocato a mano non rinasce negli
aggiornamenti normali, ma solo quando il superadmin riaccende l'opzione; etichetta «Avversario – data»,
`fixtureLabel`; il token lungo è generato e scartato, si usano codice breve e QR). Ricopiare svuota anche la
«Prossima partita» tenuta in memoria dall'hub (`forgetScheduled`), perché orari e impianti possono essere cambiati.

**Abbinamento del `.dvw`** (`linkFixture` e funzioni pure in `leagues/match.ts`; `evaluateFixtureLink` in `club.ts` legge i
candidati). Si calcola quando arriva o cambia l'header del file (ingest) e si **rivaluta solo finché non è deciso**
(`fixtureLink` nullo o `pending`; `auto` e `manual` non cambiano da soli). Candidati: partite del club non rimosse con
`starts_at` vicino alla data di `[3MATCH]`.

- **Data**: stesso giorno in ora italiana (`romeParts`); con un giorno di differenza solo se manca l'ora del file o questa
  o l'ora ufficiale è vicina a mezzanotte (`NEAR_MIDNIGHT_HOURS` = 2); in quel caso il punteggio perde `NEXT_DAY_PENALTY`
  (0,1). Senza data nel file l'abbinamento automatico non scatta mai (`pending`).
- **Nomi** (`nameTokens`, `teamNameScore`): senza maiuscole, accenti e punteggiatura, testo dopo `_` scartato
  («Sir Susa Scai Perugia_Amichevoli»), parole vuote tolte (`volley`, `club`, `asd`, `amichevoli`…); somiglianza a parole,
  alzata quando c'è la parola distintiva (città o ultima parola del nome ufficiale). Servono entrambe le squadre; se la
  «nostra squadra» di `branding.ourTeam` identifica il lato, si prova solo quello, altrimenti entrambi.
- **Soglie**: `auto` se il migliore ha almeno `AUTO_LINK_MIN_SCORE` (0,55) e supera il secondo di `AUTO_LINK_MARGIN` (0,2);
  sotto `CANDIDATE_MIN_SCORE` (0,25) non è nemmeno proposto; al massimo `MAX_CANDIDATES` (5). In ogni altro caso `pending`
  con i candidati salvati in `matches.fixture_candidates`: **mai abbinamenti in silenzio**, nessun candidato = probabile
  amichevole. Con nessuna partita del club in `client_fixtures` non si decide nulla (`fixtureLink` resta nullo).
- **Ordine dei candidati**: letti in ordine fisso (inizio della partita, poi id; `apps/server/src/club.ts`) e ordinati per punteggio senza cambiare quell'ordine a parità: la proposta in «Calendario» è sempre la stessa.
- **Stati** (`matches.fixture_link`): `auto` (trovato dal server), `manual` (scelto dall'admin), `pending` (da confermare),
  `none` (scelto «Nessuna (amichevole)»). A ogni aggiornamento del calendario i `pending` si rivalutano
  (`relinkPending`) e quelli abbinati vengono annunciati ai client.
- **Conferma dell'admin**: `PUT /api/admin/matches/:id/fixture` con `{ clientFixtureId }` (o `null` = nessuna). Accetta anche
  partite già abbinate (si può correggere); la pagina «Calendario» propone la scelta solo per quelle da confermare. Sotto
  lock; 404 se il `.dvw` non è del cliente, 400 se la partita del calendario non lo è. Dopo la scrittura avvisa i client dei link
  della partita di prima e di quella nuova (`announceFixture`).

**Una live per partita** (`matchLock.ts`, `matches.live_since`): tutte le modifiche alle partite live di un cliente
(ingest, conferma, aggiornamento del calendario) prendono lo stesso lock avvisorio (`lockTenantMatches`,
`pg_advisory_xact_lock`), perciò non ci sono deadlock. Il vecchio indice «una live per cliente» è sostituito da due indici
parziali: `matches_one_live_per_fixture_idx` (una live per partita del calendario) e `matches_one_live_unlinked_idx` (una
live tra le partite non abbinate del cliente). `switchOffOthers` spegne le altre dello stesso gruppo quando un `.dvw`
diventa live; `canStayLive` impedisce che una conferma tolga la diretta a chi è già live nello stesso gruppo (il `.dvw`
spostato smette di essere live, e lo torna a essere al suo prossimo invio). Più `.dvw` per la stessa partita sono quindi
possibili; ne resta live uno solo.

**Cosa vede ogni link** (`targetOf`, `currentMessage`, `announceFixture` in `state.ts`; `LiveHub` in `hub.ts`):

- link di una partita del calendario (`share_tokens.client_fixture_id`, bersaglio `fixture`): «Prossima partita»
  (`ScheduledMessage`, tipo `scheduled`) finché nessun `.dvw` è abbinato, poi lo stato di quel `.dvw` (quello live, altrimenti
  l'ultimo live); la pagina cambia da sola;
- link senza partita (`matchId` e `clientFixtureId` nulli, bersaglio `channel`): il **canale** del club, vedi «Profilo del
  club, partite del cliente e canale». I vecchi link «segue la live» sono già canali, senza migrazione (`targetOf`). Si
  sposta su un'altra partita **solo quando questa diventa live** (`PublishRoute.becameLive`), così due partite
  contemporanee su due campi non se la strappano a ogni punto;
- `LiveHub.retarget` (conferma o aggiornamento): gli spettatori collegati ricevono subito il messaggio nuovo (stato o
  «Prossima partita»), senza ricaricare;
- la «Prossima partita» letta dal database è tenuta in memoria dall'hub per `SCHEDULED_TTL_MS` (45 s, al massimo
  `SCHEDULED_LIMIT` = 256 partite) per non rileggerla a ogni apertura del QR; la cache si svuota quando il `.dvw` arriva
  (`publish`), nel `retarget` e a ogni nuova copia del calendario.

**Rotte** (`routes/club.ts`, ruolo `admin`, tutte con `tenantScope`; il superadmin lavora sul cliente attivo):

- `GET /api/admin/club` → `ClubResponse`: nome e logo del cliente (dalla grafica), `ourTeam`, campionati scelti con la
  squadra e `available` (tutti i campionati noti);
- `PUT /api/admin/club` (`UpdateClubRequest`): sostituisce per intero i campionati del cliente. 400 se un campionato o una
  squadra non esistono o la squadra non è di quel campionato. Se «nostra squadra» della grafica è vuota si compila dalla
  prima squadra scelta (`suggestedOurTeamName`: città senza provincia, altrimenti ultima parola del nome) e si svuota la
  cache degli hostname; poi ricopia le partite;
- `GET /api/admin/club/leagues/:id/teams` → squadre di un campionato;
- `POST /api/admin/club/sync` («Aggiorna calendario»): avvia in background l'aggiornamento dei **soli campionati del
  cliente** con lo stesso limite dell'«Aggiorna ora» (`RATE_LIMIT_LEAGUE_SYNC`); 202 con `{ started, busy }`; intanto ricopia
  quanto è già scaricato;
- `GET /api/admin/calendar` → `CalendarResponse`: `fixtures` (`ClubFixture`: partita, `state`, link breve con codice e URL,
  `.dvw` abbinato) ordinate per data e numero ufficiale, e `pending` (al massimo 50 `.dvw` da confermare, con data del file e
  candidati). `state` viene da `clubFixtureState` (`scheduled`, `live`, `finished`, `postponed`, `pending`, `removed`).

**Rotta pubblica per i blocchi** (`clubPublicRoutes` in `routes/club.ts`, `publicSchedule` in `club.ts`): `GET
/api/public/tenant/schedule` → `ScheduleResponse` (`docs/architettura.md`). Il cliente viene dall'hostname (`hostTenant`,
404 se sconosciuto), senza token, con il limite delle rotte pubbliche; solo dati pubblici del campionato (squadre, loghi
`/api/public/team-logos/:id`, orario, impianto, link breve, classifica), mai dati delle partite. Risposta con
`Cache-Control: public, max-age=60`.

- **Partite**: le prossime `SCHEDULE_MAX_FIXTURES` (3) del club con stato `scheduled` nel calendario, non rimosse
  (`removed_at` nullo), con inizio non più vecchio di 4 ore (`SCHEDULE_GRACE_MS`: una partita iniziata da poco senza `.dvw`
  conta ancora come prossima), ordinate per inizio; una partita con un `.dvw` finito è esclusa. `shortUrl` è il link breve
  non revocato né scaduto (`<base>/l/<codice>`), `null` altrimenti. **A opzione «Link e QR per singola partita» spenta**
  `shortUrl` di ogni partita è invece il link breve del **canale** (`channelShortUrl`: prima i link senza scadenza, poi il
  più recente; `null` se non ne ha), così il QR di «Prossima partita» porta al canale. `live` è `true` se un `.dvw` di quella partita è live
  (il blocco «Prossima partita» salta le partite live).
- **Classifica**: del campionato della prima partita in arrivo; se non c'è, del primo campionato del cliente (nell'ordine
  di scelta) che ha una classifica salvata. Ogni riga ha `ours` per la squadra scelta dal cliente nel campionato.
- **Senza club** (nessun campionato con squadra): risposta vuota valida (`EMPTY_SCHEDULE`).
- **Cache del server** (`ctx.caches.schedule`, `SCHEDULE_CACHE_TTL_MS` = 60 s, per cliente in `context.ts`): si svuota al
  salvataggio del club e a ogni nuova copia del calendario (`refreshClub`), all'inizio e alla fine di una partita (ingest,
  `routes/ingest.ts`) e alla revoca di un link (`forgetShareToken` in `state.ts`, per tutti i clienti). Il flag `live` può
  quindi arrivare in ritardo fino a 60 s negli altri casi.
- **Limiti noti**: una partita senza orario non è mostrata; la partita iniziata da meno di 4 ore senza `.dvw` conta ancora
  come prossima.

**Limiti noti**: le partite non abbinate si spengono a vicenda (due amichevoli contemporanee si alternano il link «segue la
live»); amichevoli e coppe fuori calendario restano «da confermare» fino alla scelta «Nessuna (amichevole)». Il vecchio
limite «un link revocato non si ricrea» è superato: il superadmin può riaccendere l'opzione dei link per partita, che ne
crea di nuovi.

**Prova reale** (2026-10-16): SuperLega 2026/27 (`IdCampionato` 999), squadra Perugia: 22 partite, ognuna con il suo link. I
`.dvw` reali Perugia–Suntory e Perugia–Itas (amichevoli, fuori calendario) restano «da confermare»; una copia con la data
della 5ª giornata si è abbinata da sola.

### Profilo del club, partite del cliente e canale (`src/routes/calendar.ts`, `src/routes/club.ts`, `src/state.ts`)
Lavoro «ruoli-calendario» (migrazione `0007_ruoli_calendario.sql`). Contratti in `packages/shared/src/club.ts`
(`docs/architettura.md`); pagine in `docs/portale.md`.

**Profilo del club** (`tenants.club_profile`, jsonb, `ClubProfileSchema`; `resolveClubProfile` riempie i predefiniti):
`series` (testo, al massimo `CLUB_SERIES_MAX` = 60), `coverage` (`homeAndAway` predefinita, oppure `homeOnly`) e `teamLogos`
(`all` predefinita, `ours`, `none`). `PUT /api/admin/club/profile` (`UpdateClubProfileRequest`, admin) salva insieme nome
mostrato, logo quadrato (un'immagine `logo` del cliente, altrimenti 400), `ourLogoSize` (`small`/`medium`/`large`, facoltativo:
se assente resta quello salvato), «nostra squadra» (questi nella grafica) e il profilo. **Logo del club**: per la nostra squadra
vince su quello per partita e su quello della Lega (`chooseTeamLogo`, usata da `fixtureLogos`, `matchLogoInfo` e dalla
classifica); è il logo quadrato (`logoMark`), altrimenti l'orizzontale (`logoMain`) (`clubLookOf` in `src/club.ts`); l'avversario
resta partita → Lega. `GET /api/admin/calendar` risponde anche `clubLogo` (il club ha un logo: la pagina disattiva il logo per
partita della nostra squadra, che torna in uso se il club toglie il suo); poi svuota la cache dei clienti, rilegge le partite (`refreshClub`) e disconnette gli spettatori dei link che non
sono più trasmessi (`closeNotBroadcast`). Risponde con `ClubResponse`.

**Partite aggiunte a mano** (`manualFixtureRoutes`, admin, sotto `lockTenantMatches`; i loghi devono essere immagini `logo`
del cliente, altrimenti 400):

- `POST /api/admin/calendar/fixtures` (`ManualFixtureRequest`: `kind` `friendly`/`cup`/`other`, `startsAt` UTC, `opponent`,
  `opponentLogo`, `ourSide`, `venue`, `venueCity`, `competition` facoltativa) → 201 `{ id }`. `competition` (testo semplice, al massimo
  100 caratteri, `null` se manca) è la competizione scritta dal cliente (per esempio «Champions League», che non ha un sito da
  cui scaricare il calendario): si salva nella colonna esistente `client_fixtures.league_name` (nessuna migrazione) e torna come
  `leagueName` nel calendario e nei blocchi pubblici «Calendario» e «Prossima partita»; la classifica pubblica resta quella del
  campionato principale. La `PUT` sostituisce tutto: senza `competition` la competizione si toglie. La riga ha `origin` `manual`, `league_id` nullo, id esterno
  `manual:<id>`, giornata `Amichevole`/`Coppa`/`Partita` (`MANUAL_FIXTURE_LABEL`) e il nome della nostra squadra
  (`ourTeamForManual`); poi `refreshClub` le dà link breve e QR come alle altre e riprova i `.dvw` da confermare;
- `PUT /api/admin/calendar/fixtures/:id` → 204; `DELETE` → 204. Solo per le partite `manual`, altrimenti 400 «Si modificano
  e si cancellano solo le partite aggiunte a mano». Il `DELETE` toglie il link (spettatori disconnessi) e rimette i `.dvw`
  abbinati tra quelli «da confermare» (`pending`; restano live solo se nessun altro `.dvw` non abbinato lo è);
- `PUT /api/admin/calendar/fixtures/:id/date` (`FixtureDateRequest` = `{ startsAt }`, ISO UTC o `null`; admin, isolata per
  cliente, sotto `lockTenantMatches`) → 204, per **qualunque** partita. Per una scaricata la data ufficiale resta in
  `starts_at` e quella scelta a mano va accanto, nelle colonne `override_starts_at`, `overridden_at` e
  `override_official_starts_at` (la data ufficiale di quel momento, per accorgersi se poi la Lega sposta la partita;
  migrazione `drizzle/0010_date_modificabili.sql`). `null`, oppure una data uguale all'ufficiale, azzera le tre colonne
  (torna l'ufficiale: nulla da congelare). Per una manuale cambia `starts_at` e `null` dà 400 «Una partita aggiunta a mano ha
  sempre una data». Aggiorna l'etichetta del link, poi `refreshClub`, `closeNotBroadcast` e `announceFixture`. La
  sincronizzazione (`leagues/sync.ts`, `refreshClientFixtures`) non tocca queste colonne e continua ad aggiornare
  risultato, stato e data ufficiale. **Data effettiva** (`effectiveStartsAt` di `@arenalive/shared`; in SQL `effectiveStartSql` in
  `apps/server/src/club.ts` = `coalesce(override_starts_at, starts_at)`): usata per l'abbinamento dei `.dvw`, il piano del
  giorno di gara, la «Prossima partita», il canale e i link; `ClubFixture.startsAt` è la data effettiva,
  `officialStartsAt` quella della Lega, `movedByLeague` dice che la Lega l'ha spostata dopo la modifica a mano;
- `PATCH /api/admin/calendar/fixtures/:id/settings` (`FixtureSettingsRequest`, almeno un campo) → 204: `broadcast`
  (`auto`/`on`/`off`), `hidden` (solo partite scaricate; per una manuale 400: si cancella), `ourLogo` e `opponentLogo`
  (`null` = logo predefinito). Una partita scaricata non si modifica né si cancella: si può solo nascondere.

**Trasmessa o no** (`isFixtureBroadcast`, `broadcastOf`; in SQL `broadcastSql`): una partita nascosta non lo è mai; con
`broadcast` `on`/`off` decide la scelta; con `auto` decide la copertura (`homeAndAway` = tutte, `homeOnly` = solo in casa).
Una partita non trasmessa: il suo link non è attivo (`resolveShareToken` dà 404 e il `PATCH` o il profilo disconnettono
chi era collegato), non è proposta come «Prossima partita» né nel blocco pubblico (`comingFixtures`) e l'abbinamento
automatico del `.dvw` non la considera (`evaluateFixtureLink`). In `GET /api/admin/calendar` ogni `ClubFixture` ha
`origin`, `kind`, `broadcast`, `broadcasted`, `hidden` e `logos`.

**Loghi nello stato** (`withLogos` in `state.ts`): ogni `StateMessage` ha `logos` (`TeamLogoPair`, lato casa e ospite). Per
ogni squadra vale `shownTeamLogo`: prima il logo scelto per la partita, poi (solo per la nostra squadra) quello del profilo,
poi il logo pubblico della Lega, altrimenti nessuno; l'impostazione `teamLogos` può nasconderlo. Il lato «nostro» è la
«nostra squadra» riconosciuta nel `.dvw`, altrimenti il lato del club nel calendario; se ignoto, nessun logo
(`matchTeamLogos`). Le informazioni sono tenute in `ctx.caches.logos`.

**Canale «tutte le partite del calendario»** (bersaglio `channel`; `channelMessage`, `channelChoice`, `ChannelWatcher` in
`state.ts`, `LiveHub.showChannel`): è il link creato con `matchId` nullo da `POST /api/admin/share-tokens`. Mostra:

1. la partita in corso, cioè l'ultima per `live`, `live_since`, aggiornamento, se è live, non finita e aggiornata da meno di
   `CHANNEL_STALE_MS` (6 ore: un agente lasciato acceso non occupa il canale);
2. altrimenti «Prossima partita» (`scheduled`, con conto alla rovescia) della prossima partita trasmessa, **dalle 00:00
   (ora di Roma) del giorno in cui gioca** (`romeDayAt`), oppure subito se non c'è una partita precedente;
3. altrimenti l'ultima partita, anche finita, che resta fino a quel momento; se non c'è nulla, `noMatch`.

Concorrono al canale i `.dvw` non abbinati a una partita del calendario (le amichevoli non abbinate restano visibili) e
quelli abbinati a una partita trasmessa; quelli abbinati a una partita non trasmessa sono esclusi (`channelAllowed` in
ingest, cache `ctx.caches.broadcast` di 60 s, e il `where` di `channelMessage`). Il risultato è tenuto in memoria dall'hub
45 s (`SCHEDULED_TTL_MS`) e riletto dal database dopo: la regola delle 6 ore si applica a quella lettura. `ChannelWatcher`
(avviato da `app.ts`) controlla ogni `CHANNEL_CHECK_MS` (60 s), **in ogni processo**, i clienti con almeno un socket sul
canale e manda solo ciò che è cambiato, così la pagina passa alla partita successiva senza ricaricare. Il canale si
svuota anche quando una partita inizia o finisce e a ogni modifica del calendario o del profilo (`forgetClubCaches`).
Il messaggio del canale tenuto dall'hub (`currentChannel`) vive al massimo 45 s (`SCHEDULED_TTL_MS`): poi `channelMessage`
rilegge il database e applica `CHANNEL_STALE_MS` anche alla partita che l'hub aveva in memoria (`channelMatch`, scelta
da `publish`/`setChannelMatch`; `publish` non la assegna ai `.dvw` di partite non trasmesse, `route.channel === false`).
Dopo `PUT /api/admin/club/profile` e `PATCH …/settings` parte subito `refreshClub`, che rivaluta i `.dvw` in attesa
(`relinkPending`) e annuncia quelli abbinati; poi `closeNotBroadcast` disconnette i link non più trasmessi.

**Ruoli** (`requireRole`): il `viewer` legge club, calendario, agenti, quota agenti, link, grafica (`branding`, `layout`,
`intermissions`, `overlays`, `assets`) e partite; non legge utenti né richieste di registrazione (admin). Ogni scrittura
admin rifiuta il viewer con 403 prima di leggere il corpo; `apps/server/test/roles.test.ts` elenca le rotte che scrivono e
copre da solo quelle nuove.

**Manifest dell'app** (`routes/manifest.ts`, `GET /api/public/manifest.webmanifest`, rate limit pubblico,
`Cache-Control: public, max-age=300`): `webManifest` di `packages/shared/src/manifest.ts` con nome mostrato, colori (risolti con `resolveBrandColors`: quelli del cliente sopra quelli del template) e logo
quadrato (`logoMark`) del cliente dell'hostname; senza cliente quelli del portale («ArenaLive»).

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

La pipeline è `applyIngest` (`apps/server/src/ingest.ts`), **una sola** per l'agente (`POST /api/ingest`) e per la
simulazione del server (vedi «Simulazione di una partita»): chiama `IngestService.ingest(source, req)` con
`IngestSource` (`tenantId`, `agentId`, `simulated`) e poi spinge lo stato ai client. Passi di `IngestService.ingest`, tutti
in una transazione:

1. lock avvisorio `pg_advisory_xact_lock` (`lockTenantMatches`: le ingest e ogni altra modifica alle partite live di un
   cliente sono serializzate, nessun deadlock);
2. riga `matches` creata se manca (per cliente e `matchKey`) e letta con `for update`;
3. controlli `duplicate` / `needSnapshot` (tabella sopra);
4. righe finali = precedenti + nuove (append) oppure solo le nuove (snapshot); se superano `MATCH_MAX_LINES` risposta 413
   (`MATCH_TOO_MANY_LINES`) e rollback;
5. verifica di `contentHash`; se non coincide `needSnapshot` (rollback);
6. scrittura delle sole righe cambiate: con `snapshot` si cancellano e si reinseriscono le righe dopo il prefisso comune;
7. ricostruzione del file con `buildDvwText(header, righe)` (header + `[3SCOUT]` + righe), poi `parseDvw` e
   `computeMatchState`: lo stato è **ricalcolato da zero a ogni ingest**;
8. se l'header è nuovo o cambiato e l'abbinamento non è deciso (`fixtureLink` nullo o `pending`) si cerca la partita del
   calendario (`evaluateFixtureLink`, vedi «Club, calendario e abbinamento»); la partita diventa `live` e le altre dello
   stesso gruppo (stessa partita del calendario, oppure tutte le non abbinate) vanno a `live = false`
   (`switchOffOthers`); `live_since` si imposta quando diventa live; `version` aumenta di 1, `state` è salvato;
   **Ora di fine partita** (`endOf` in `ingest.ts`, colonna `matches.finished_at`): nel `.dvw` manca la data, quindi la
   scrive il server. Alla prima ingest in cui lo stato è `finished` vale l'ora corrente e poi non cambia più; se una
   correzione dello scout riporta la partita fuori da `finished` torna `null` (e si riconta se finisce di nuovo). Una
   partita già finita prima della colonna usa `updated_at`. Il valore viaggia nel campo facoltativo `finishedAt` (ISO UTC) di
   `StateMessage`, presente solo con la partita finita (`finishedAtField` in `src/state.ts`, usato da ingest, stato
   iniziale e `resync`).
9. dopo il commit il nuovo stato (`StateMessage`) passa a `publisher.publish` con la rotta (`PublishRoute`: partita del
   calendario e se è appena diventata live; oggi `LiveHub`, vedi «WebSocket») e arriva ai client WebSocket di quel cliente
   che seguono la partita: come patch o come stato intero.

Una piccola cache in memoria (4 partite, verificata con `version` e `lineCount`) evita di rileggere tutte le righe a ogni
richiesta; la fonte di verità resta il database.

Corpo della richiesta: JSON, con `Content-Encoding: gzip` facoltativo (altri valori: 415). Limiti: 2 MB sul filo
(`INGEST_MAX_WIRE_BYTES`), 8 MB dopo la decompressione (`INGEST_MAX_DECODED_BYTES`, contro le zip bomb), massimo 5000
righe per richiesta (`INGEST_MAX_LINES`), 2000 caratteri per riga, header fino a 512 KB. Oltre il limite: 413.
Tutte le altre rotte accettano al massimo 64 KB, tranne `POST /api/admin/assets` e `POST /api/admin/simulation` (testo base64 di 2 MB più il JSON). Una riga che apre una sezione DVW (`[3NOME]`) o contiene a capo è
rifiutata dallo schema.

### Simulazione di una partita (`src/simulation/`, `src/routes/simulation.ts`)
Il server può giocare da solo una partita `.dvw` per provare portale, TV e grafica senza agente. Le righe passano per la
stessa pipeline dell'ingest (`applyIngest`: `append`, `snapshot` quando il server lo chiede, `seq` e `contentHash`
come l'agente), così il comportamento è quello vero; la partita però è **isolata** dalle partite vere. Pagina:
`docs/portale.md`, «Simulazione»; tempi (`planPlayback`): `docs/simulatore.md`; contratti:
`packages/shared/src/simulation.ts`.

- **Sorgenti** (`source.ts`, `LoadedMatch`): solo due. `generated` («Casuale»: `generatedMatch`, una partita del
  simulatore con 3, 4 o 5 set, `seed` facoltativo, altrimenti uno a caso; `clubTeams` per usare nostra squadra e
  avversario della prossima partita del calendario, altrimenti la squadra di `ourTeamForManual` contro
  `DEFAULT_AWAY_NAME`; `profile` facoltativo, l'«Andamento della partita» (`SimulationProfileSchema`: `homeStrength`
  e `variability` da 0 a 100, `acesPerSet` 0-8, `serveErrorsPerSet` 0-10, `blocksPerSet` 0-8, `substitutionsPerSet` 0-6,
  `timeoutsPerSet` 0-2, ognuno facoltativo; un valore fuori dai limiti è **400**; i campi mancanti, o tutto `profile`
  assente come nelle richieste di prima, prendono i default del simulatore, `DEFAULT_PROFILE` in `docs/simulatore.md`) e `upload` (un `.dvw` caricato dall'admin, in base64, `fileName` fino a 120 caratteri). Non ci sono
  partite di esempio già pronte. `fileMatch` legge il file come l'agente (Windows-1252 o UTF-8), lo valida con lo schema
  dell'ingest e al massimo `MATCH_MAX_LINES` righe; una riga malformata resta (il parser ne fa un'azione `unknown`).
  Errori: file oltre `SIMULATION_UPLOAD_MAX_BYTES` (2 MB; la rotta lo controlla già sul testo base64) **413**
  `DVW_TOO_LARGE`; file non leggibile (manca `[3SCOUT]`, nessuna riga di scout, troppe righe, righe non valide) **422**
  `DVW_REJECTED` con il motivo in italiano.
- **Servizio** (`service.ts`, `SimulationService`): una simulazione per cliente, in memoria; al massimo
  `SIMULATION_MAX_ACTIVE` = 5 «in corso» o «in pausa» in tutto il server (costante nel codice, non una variabile
  d'ambiente); un nuovo avvio con una simulazione attiva o oltre il limite è 409. Stati: `running`, `paused`, `stopped`,
  `finished`. L'invio rispetta i tempi di `planPlayback` ma al massimo ogni `SIMULATION_MIN_SEND_MS` = 250 ms: le righe
  maturate nel frattempo partono insieme (`append`, `fromIndex` = righe già inviate). Avvio e «Ricomincia» mandano uno
  `snapshot` con l'header; se l'ingest risponde `needSnapshot` o `duplicate` il servizio manda uno `snapshot` di tutte le
  righe, come l'agente. In modo «velocità» la pausa fra due set è almeno la pausa «Fine set» del cliente per quel set
  (`simulation/breaks.ts`, `setBreakSeconds`: ritardo (5 s) più secondi delle diapositive accese, scelta per set come
  `intermissionFor`; 20 s se la pausa è spenta), letta dal documento `tenants.intermissions` all'avvio: i punti del set
  dopo non la troncano. In modo «durata» vale la pausa scelta dall'admin. Un errore ferma la simulazione con l'avviso «La simulazione si è interrotta per un errore del
  server.» (mai un crash). `SimulationTimers` permette ai test un orologio finto.
- **Pulizia**: ogni `SIMULATION_SWEEP_MS` = 60 s (`sweep`) si cancellano partita e link delle simulazioni ferme o finite da
  almeno `SIMULATION_RETENTION_MS` = 6 ore, di quelle in pausa da 6 ore, e delle partite simulate rimaste orfane dopo un
  riavvio non toccate da altrettanto. «Elimina» (`DELETE`) le cancella subito. Alla cancellazione si scollegano gli
  spettatori del link (`closeShareToken`) e l'hub dimentica la partita (`LiveHub.forgetMatch`).
- **Riavvio del server**: la riproduzione è persa. La partita e il link restano nel database: `GET` risponde con stato
  `stopped`, `pace` nullo e l'avviso «La simulazione si è interrotta con il riavvio del server: puoi ricominciarla da
  capo.»; dall'avvio successivo la partita e il link vengono **riusati** (stessa `matchKey` e `seq` che continua), così uno
  schermo rimasto sul link prosegue. Il link (etichetta «Simulazione», senza scadenza) si crea alla prima simulazione e
  resta lo stesso per le successive, finché non si cancella la partita.
- **Rotte** (`simulationRoutes`, solo admin, rate limit `admin`, il superadmin nel cliente in cui è entrato, il viewer 403):
  `GET /api/admin/simulation` (simulazione e squadre del club: `SimulationResponse`), `POST /api/admin/simulation`
  (avvia, 201; corpo fino a circa 2,7 MB: `SIMULATION_UPLOAD_MAX_BASE64_LENGTH` + 64 KB),
  `POST /api/admin/simulation/:command` con `pause`, `resume`, `stop` («Arresta» nella pagina) o `restart` (`SIMULATION_COMMANDS`; 404 senza
  simulazione, 409 se il comando non è ammesso nello stato; `stop` è idempotente: su una simulazione già arrestata o finita risponde 200 senza cambiare nulla), `DELETE /api/admin/simulation` (204).
- **Isolamento** (colonna `matches.simulated`, migrazione `drizzle/0009_simulazione.sql`, indice parziale
  `matches_simulated_idx`): una partita simulata non è mai `live` né ha `live_since`; non viene mai abbinata al calendario;
  `switchOffOthers` non scatta e le partite live vere restano come sono; la rotta di pubblicazione è `isolated: true`
  (`PublishRoute`): non diventa la partita live né quella del canale, e il suo stato arriva solo ai client collegati al
  suo link (target `match`), con `simulated: true` nel `StateMessage` (da cui l'etichetta «Simulazione» del portale). Le
  cache dello `schedule` pubblico non si toccano. È esclusa da: canale del club (`state.ts`), elenco `GET
  /api/admin/matches` e dettaglio `GET /api/admin/matches/:id`, creazione di un link fisso su una partita
  (`POST /api/admin/share-tokens`), elenco dei link (`GET /api/admin/share-tokens`: il link della simulazione è solo nella
  pagina «Simulazione»), abbinamento manuale al calendario (`PUT /api/admin/matches/:id/fixture`, `routes/club.ts`) e abbinamento automatico (`ingest.ts`). Un
  agente che invia su una `matchKey` di una simulazione, o la simulazione su una `matchKey` di un agente, riceve **409**
  «Partita già usata da un'altra sorgente».

### Statistiche delle visite (`src/stats/`, `src/routes/stats.ts`, migrazione `0013_statistiche_visite`)
Conta chi guarda la pagina pubblica, senza dati personali. Pagina: `docs/portale.md`, «Statistiche»; contratti
(`packages/shared/src/stats.ts`): `docs/architettura.md`.

**Regole di visita** (`VisitTracker`, `tracker.ts`):
- Il primo messaggio `hello` di un WebSocket pubblico apre una visita (`StatsService.connect`, chiamato da `state.ts`);
  gli `hello` successivi dello stesso socket sono ignorati: **una visita per socket**. I socket dell'area riservata
  (`/ws/admin`) non contano.
- La visita è identificata da link + id di visita (`hello.visit`). Una **riconnessione entro 30 s**
  (`RECONNECT_GRACE_MS`) con lo stesso id è la stessa visita; passati i 30 s dalla chiusura dell'ultimo socket la visita finisce.
- Una visita sotto i **3 s** (`MIN_VISIT_MS`) è scartata. Le visite su partite **simulate** non sono mai registrate né
  contate in «Adesso» e nei picchi.
- La partita della visita è l'ultima seguita dal socket (letta dall'hub con `viewOf`, `null` prima dell'inizio).
- Buffer in memoria: al massimo 100.000 visite (`BUFFER_LIMIT`) e 50.000 campioni di picco (`PEAK_BUFFER_LIMIT`); oltre, i
  più vecchi cadono (contatore `dropped`). Le visite tenute in memoria insieme sono al massimo 20.000 (`MAX_VISITS`): oltre,
  le nuove non si contano e salgono in `dropped`.
- L'`hello` apre una visita solo su un socket ancora aperto e ancora tenuto dall'hub (`state.ts`: `readyState` aperto e
  `hub.viewOf` non nullo), perché per gli altri la chiusura non arriverebbe mai.

**Scrittura** (`StatsService`, `service.ts`; avviata da `app.ts` con `ctx.stats.start()`):
- a lotti ogni **15 s** (`FLUSH_MS`), mai una scrittura per messaggio; `writeBatch` (`store.ts`) scrive il lotto in
  **una sola transazione**; l'id di ogni visita lo genera il server (`randomUUID`, `tracker.ts`) e l'inserimento ignora i
  doppioni (`onConflictDoNothing`), così un nuovo tentativo non duplica; se il database rifiuta il lotto, viene rimesso in
  coda e riprovato al giro dopo (errore nel log, mai verso gli spettatori);
- **picchi** una volta al minuto (`SAMPLE_MS`): spettatori collegati per partita, nel minuto vale il campione più alto;
- **pulizia** (`housekeeping`): un timer orario proprio (`HOUSEKEEPING_MS`, più una chiamata all'avvio), **indipendente da
  `LEAGUE_SYNC`**, una volta al giorno (giorno di Roma) trasforma il dettaglio più vecchio di **90 giorni**
  (`DETAIL_DAYS`, `purgeOld` in `store.ts`) in totali giornalieri in `view_daily` (per link e partita; i picchi di una
  partita in righe senza link) e cancella `page_views` e `viewer_peaks` di quei giorni, in una transazione;
- **chiusura** (`close`, `app.ts`): ferma i timer, le visite aperte finiscono adesso e tutto è scritto.

**Tabelle** (`src/db/schema.ts`, migrazione `apps/server/drizzle/0013_statistiche_visite.sql`):

| Tabella | Contenuto |
|---|---|
| `page_views` | una riga per visita: cliente, link (`share_token_id`), partita del calendario e partita, inizio, fine, `seconds`, `device` (`tv`, `tablet`, `phone`), `source` (`qr`, `link`), `app`, `day` (giorno di Roma) |
| `viewer_peaks` | spettatori collegati a una partita in un minuto (chiave `match_id` + `minute`, `viewers` > 0) |
| `view_daily` | totali del giorno per link e partita (visite, da QR, da app, per dispositivo, secondi, picco) dopo i 90 giorni |

Link e partite eliminati lasciano `null` nelle righe (`on delete set null`); i picchi seguono la partita (`cascade`).

**Privacy: cosa si salva e cosa no.** Si salvano solo orari, durata, link, partita, tipo di dispositivo (`tv`,
`tablet`, `phone`), provenienza (QR o link) e se la pagina è un'app installata. **Non** si salvano IP, user agent,
cookie né alcun identificativo persistente: l'id di visita nasce nella pagina, vive solo in memoria (un ricaricamento è
una nuova visita), resta nel server solo finché la visita è aperta e non è mai scritto nel database. Per questo non
esistono «spettatori unici».

**Rotte** (sessione, ruolo `viewer`, limite `RATE_LIMIT_ADMIN`, risposta `cache-control: no-store`; sempre sul cliente
della sessione, il superadmin su quello scelto):
- `GET /api/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`: `StatsOverview` (totali, dispositivi, partite, link, giornate). Il
  periodo (`StatsPeriodQuerySchema`) è in giorni di Roma, estremi inclusi; senza parametri sono gli ultimi 30 giorni
  (`to` = oggi); `from` non dopo `to`, al massimo 366 giorni (`STATS_MAX_DAYS`), altrimenti 400. Prima di leggere scrive i
  lotti in attesa (`flush`), così una visita appena chiusa è già contata. I picchi di partite eliminate nel frattempo non
  entrano nei totali (`buildOverview`, `store.ts`).
- `GET /api/admin/stats/now`: `StatsNow`, spettatori collegati adesso (dalla memoria), partita live e ripartizione per
  partita e per link.
- `GET /api/admin/stats/matches/:matchId/curve`: `StatsCurve`, spettatori minuto per minuto; 404 se la partita non esiste
  per il cliente o è simulata; senza campioni `points` è vuoto (al massimo 2000 punti).

### Accessi
- **Token agente**: segreto casuale da 256 bit (base64url) creato da un admin; si salva solo l'hash sha256. L'agente lo
  invia come `Authorization: Bearer <token>`; un token revocato è rifiutato (401). Aggiorna `lastSeenAt`. Se l'agente ha
  una scadenza (`agents.expires_at`) e questa è passata, chi presenta il token giusto riceve 401 con `AGENT_EXPIRED` e il
  testo «Registrazione scaduta: registrati di nuovo» (`AGENT_EXPIRED_ERROR`, `security.ts`); chiunque altro il 401 normale.
- **Validità e quota degli agenti** (`src/agentQuota.ts`): l'admin sceglie per ogni agente «Senza scadenza» o «Fino al»
  (`AgentValidityRequest`, `expiresAt` nulla o futura, altrimenti 400). L'approvazione di una registrazione porta il corpo
  `{ expiresAt }` (corpo vuoto = senza scadenza), salvato in `agent_registrations.agent_expires_at` e copiato nell'agente
  quando ritira il token. `PATCH /api/admin/agents/:id` (admin) prolunga o accorcia un agente non revocato (404 altrimenti).
  Il cliente può avere al massimo `tenants.agent_quota` agenti: contano quelli non revocati e non scaduti più le
  registrazioni abilitate e non ancora ritirate (`agentsInUse`); creare un agente, abilitare una registrazione o
  riattivare un agente scaduto oltre il limite dà **409** `AGENT_QUOTA` («Limite di agenti raggiunto…»), controllato sotto
  `lockTenantAgents`. `GET /api/admin/agent-quota` → `{ quota, used }` (anche viewer). La quota la imposta solo il
  superadmin (`agentQuota` in `POST`/`PATCH /api/admin/tenants`, `TenantSummary.agentQuota`, 0-`AGENT_QUOTA_MAX`); abbassarla
  non spegne gli agenti già presenti, blocca le nuove approvazioni finché non rientrano.
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
  è `null` (e non c'è `client_fixture_id`) il link è il **canale del club** (partita in corso, altrimenti la prossima
  trasmessa; vedi «Profilo del club, partite del cliente e canale»); con un `matchId` mostra quella
  partita fissa (`POST /api/admin/share-tokens` con `matchId` a opzione «Link e QR per singola partita» spenta dà 403
  `MATCH_LINKS_DISABLED`, «Link per singola partita non attivi: usa il canale del club»; il flag è riletto sotto il lock del
  cliente); con un `client_fixture_id` (link creati dal «Calendario», uno per partita, `ShareTokenSummary.clientFixtureId`)
  mostra «Prossima partita» e poi la partita abbinata (vedi «Club, calendario e abbinamento»). `expiresAt`
  facoltativa. Un token non valido, revocato o scaduto dà sempre 404; la revoca chiude subito i WebSocket già aperti (codice
  4404). Nei log il token è mascherato (`/api/public/[token]`, come i link di invito e recupero: `/api/auth/links/[token]`, `/admin/invito/[token]`, `/admin/reimposta-password/[token]`). I link validi sono in una cache di 30 s
  (`ctx.caches.shares`, chiave `<cliente>:<hash del token>`), svuotata alla revoca (`forgetShareToken`), così le migliaia
  di aperture non leggono il database.
- **Link breve e codice** (`docs/portale.md`, «Link breve e QR»): ogni link attivo ha anche un codice di 8 lettere
  (`SHORT_CODE_LENGTH`, alfabeto `PAIRING_CODE_ALPHABET`, mostrato `K7M2-QX9P`) e l'URL `<base>/l/<codice>`, con base
  del cliente (`publicBaseUrlFor`, primo hostname del cliente). `ShareTokenSummary` ha `shortCode` e `shortUrl` (`null`
  se il link è revocato); `CreateShareTokenResponse` li include. Il codice **non è salvato**: sono i primi 40 bit di
  HMAC-SHA256(`SHARE_CODE_SECRET`, id del link, più `:<salt>` se il salt è > 0) (`deriveShortCode`,
  `src/lib/shortCode.ts`), quindi si ricalcola ogni volta che serve (anche per riscaricare il QR). Nel database c'è solo
  `short_code_hash` (unica) = HMAC con chiave derivata dal segreto su `lookup:<codice>` (`shortCodeLookupHash`), più
  `short_code_salt`: una copia del database da sola non permette di provare offline i 2^40 codici. **Eccezione alla
  rinomina**: l'etichetta usata per derivare la chiave di ricerca (`sirrealtime:short-code-lookup-key`) è rimasta quella
  vecchia, perché cambiarla invaliderebbe i codici brevi dei link ripristinati dalla vecchia produzione
  (`docs/infrastruttura.md`, «Migrare i dati dalla vecchia produzione»).
  - Creazione (`insertShareToken`, `src/shareCodes.ts`): l'id è scelto prima dell'insert; su collisione di codice si
    passa al salt successivo (massimo 16, `MAX_SHORT_CODE_SALT`, poi `ShortCodeError`). `ensureShortCode` assegna il
    codice ai link senza (o con hash non più coerente) al primo elenco; `syncShortCodes` lo fa per tutti i link non
    revocati all'avvio, prima di `listen`, e ricalcola codici e hash se `SHARE_CODE_SECRET` è cambiata.
  - Lettura pubblica: `/api/public/<token o codice>/state` e `/ws/public/<token o codice>`. `ShareTokenParamSchema`
    distingue `{ kind: 'token' | 'code', value }` (token ≥ 22 caratteri, codice ≤ 9, anche minuscolo e con il trattino).
    Cache `ctx.caches.shares` separata per codici; la revoca invalida la cache e chiude i WebSocket (4404).
  - Limiti: oltre agli errori per IP (`RATE_LIMIT_PUBLIC_INVALID`) i codici sbagliati contano anche **tutti insieme**
    (`RATE_LIMIT_SHORT_CODE_INVALID`, default 1000 al minuto). Durante il blocco globale ricevono 429 (con `Retry-After`,
    senza contare un nuovo errore) solo gli IP con errori nel minuto in corso (`FailureLimiter.hasRecent`) per i codici
    non in cache; gli IP puliti leggono normalmente, quindi una pioggia di codici sbagliati non blocca gli spettatori.
    Stima: con 120 errori al minuto per IP servono circa 8.700 anni per trovare un link (diviso per il numero di link
    attivi). Limite noto: un IP condiviso (NAT) con un errore recente non apre codici brevi non in cache fino alla fine
    del minuto durante il blocco globale (i link lunghi funzionano).
  - Cambiando `SHARE_CODE_SECRET` cambiano **tutti** i codici: i QR stampati smettono di funzionare, i link lunghi
    restano.
- **Sessioni admin e viewer**: login con email e password (argon2id) su `/api/auth/login`; cookie `arenalive_session`
  (`httpOnly`, `SameSite=Lax`, `Secure` secondo `COOKIE_SECURE`), durata `SESSION_TTL_HOURS`. Ruoli: `viewer` (sola lettura: partite, club,
  calendario, agenti, link e grafica; mai utenti e richieste di registrazione né scritture, 403), `admin` (tutto il resto del proprio cliente) e `superadmin` (anche i clienti; vedi «Clienti»). Le scritture
  dal browser (`POST`/`PATCH`/`DELETE` su `/api/auth/*` e `/api/admin/*`) richiedono corpo JSON e, se presente, un `Origin`
  ammesso (`CORS_ORIGIN` o un hostname del cliente; protezione CSRF). Il primo superadmin si crea all'avvio da
  `ADMIN_EMAIL` / `ADMIN_PASSWORD`, solo se non esiste già un superadmin.
- Risposte d'errore: `{ "error": "<testo>" }` (`ApiErrorSchema`), mai stack trace.

### Versione (`src/buildInfo.ts`)
La versione è il campo `version` del `package.json` alla radice (unica fonte, `docs/regole/test-job-rilasci.md`). Il build del
server scrive `dist/build-info.json` (`version` e `commit` corto, da `ARENALIVE_COMMIT` o da git: `scripts/scrivi-versione.mjs`);
`buildInfo()` lo legge, altrimenti (test, `pnpm dev`) legge il `package.json` alla radice, altrimenti `0.0.0`. La usano
`GET /api/health` e lo User-Agent dei download dei campionati (`ArenaLive/<versione>`).

### Endpoint

| Metodo | Percorso | Protezione | Ruolo |
|---|---|---|---|
| GET | `/api/health` | nessuna (verifica il database; 503 se non raggiungibile). Risposta `HealthResponseSchema`: `status`, `version` e, se nota, `commit`; niente altro | - |
| POST | `/api/ingest` | rate limit, poi token agente | agente |
| POST | `/api/agents/registrations` | rate limit registrazione, `Origin` | - (pubblica) |
| POST | `/api/agents/registrations/status` | rate limit ingest, `Origin`, segreto di registrazione | agente in registrazione |
| POST | `/api/auth/login` | rate limit login | - |
| GET | `/api/auth/links/:token` | limite `RATE_LIMIT_PASSWORD_RESET`; 410 se il link non è valido, scaduto o usato | - (pubblica) |
| POST | `/api/auth/invite/accept` | limite `RATE_LIMIT_PASSWORD_RESET`; 410 come sopra; apre la sessione | - (pubblica) |
| POST | `/api/auth/password-reset/request` | limite `RATE_LIMIT_PASSWORD_RESET` + 3 all'ora per email; risposta sempre `{ ok: true }` | - (pubblica) |
| POST | `/api/auth/password-reset/confirm` | limite `RATE_LIMIT_PASSWORD_RESET`; 410 come sopra; chiude le sessioni dell'utente | - (pubblica) |
| POST | `/api/auth/password` | rate limit login; corpo `ChangeOwnPasswordRequestSchema` (`currentPassword`, `newPassword`); 400 `WRONG_PASSWORD` se l'attuale è errata; senza cliente; cancella i token di invito/recupero e chiude le **altre** sessioni (e i loro WebSocket), non quella in uso | viewer |
| POST | `/api/auth/logout` | rate limit admin | - (chiude i WebSocket della sessione) |
| GET | `/api/auth/me` | sessione (risposta con `tenant`, il cliente corrente) | viewer |
| GET | `/api/admin/tenants` | sessione | superadmin |
| POST | `/api/admin/tenants` | sessione | superadmin |
| PATCH | `/api/admin/tenants/:id` | sessione | superadmin |
| POST | `/api/admin/active-tenant` | sessione («Entra nel cliente» / «Esci dal cliente») | superadmin |
| GET | `/api/public/tenant` | rate limit pubblico (grafica del cliente dell'hostname) | - |
| GET | `/api/public/assets/:id` | rate limit pubblico (solo immagini del cliente dell'hostname) | - |
| GET | `/api/public/:token/state` | link pubblico, `:token` è il token lungo o il codice breve (404 se non valido) | - |
| GET | `/api/public/manifest.webmanifest` | rate limit pubblico (manifest dell'app del cliente dell'hostname) | - |
| GET | `/api/admin/branding` | sessione | viewer |
| PUT | `/api/admin/branding` | sessione | admin |
| GET | `/api/admin/branding/export` | sessione | admin |
| POST | `/api/admin/branding/import` | sessione | admin |
| GET | `/api/admin/layout` | sessione | viewer |
| PUT | `/api/admin/layout` | sessione | admin |
| GET | `/api/admin/intermissions` | sessione | viewer |
| PUT | `/api/admin/intermissions` | sessione | admin |
| GET | `/api/admin/overlays` | sessione | viewer |
| PUT | `/api/admin/overlays` | sessione | admin |
| GET | `/api/admin/assets` | sessione | viewer |
| GET | `/api/admin/assets/:id/file` | sessione | viewer |
| POST | `/api/admin/assets` | sessione (corpo fino a ~2,7 MB) | admin |
| POST | `/api/admin/assets/video` | sessione (corpo binario `application/octet-stream`, fino a 15 MB) | admin |
| DELETE | `/api/admin/assets/:id` | sessione | admin |
| GET | `/api/admin/agent/info` | sessione | admin |
| GET | `/api/admin/agent/download` | sessione, limite proprio `RATE_LIMIT_AGENT_DOWNLOAD` | admin |
| GET | `/api/public/system-logos` | rate limit pubblico (cache 30 s, uguale per ogni hostname) | - |
| GET | `/api/public/system-logos/:id` | rate limit pubblico (file di un logo di sistema) | - |
| PUT | `/api/admin/system-logos/:slot/:variant` | sessione (corpo fino a ~2,7 MB) | superadmin |
| DELETE | `/api/admin/system-logos/:slot/:variant` | sessione | superadmin |
| GET | `/api/public/team-logos/:id` | rate limit pubblico (logo di una squadra dei campionati, uguale per tutti i clienti) | - |
| GET | `/api/admin/leagues` | sessione | superadmin |
| POST | `/api/admin/leagues` | sessione | superadmin |
| GET | `/api/admin/leagues/:id` | sessione | superadmin |
| POST | `/api/admin/leagues/:id/sync` | sessione, limite proprio `RATE_LIMIT_LEAGUE_SYNC` | superadmin |
| GET | `/api/admin/club` | sessione | viewer |
| PUT | `/api/admin/club` | sessione | admin |
| PUT | `/api/admin/club/profile` | sessione | admin |
| GET | `/api/admin/club/league` | sessione | viewer |
| POST | `/api/admin/club/league` | sessione, limite proprio `RATE_LIMIT_LEAGUE_SYNC` | admin |
| GET | `/api/admin/onboarding` | sessione | viewer |
| POST | `/api/admin/onboarding/complete` | sessione | admin |
| GET | `/api/admin/club/competitions` | sessione | admin |
| POST | `/api/admin/club/competitions` | sessione, limite proprio `RATE_LIMIT_LEAGUE_SYNC` | admin |
| GET | `/api/admin/roster` | sessione | viewer |
| POST | `/api/admin/roster/players` | sessione | admin |
| PATCH | `/api/admin/roster/players/:id` | sessione | admin |
| DELETE | `/api/admin/roster/players/:id` | sessione | admin |
| PUT | `/api/admin/roster/players/:id/media` | sessione | admin |
| POST | `/api/admin/roster/import` | sessione, limite proprio `RATE_LIMIT_ROSTER_IMPORT` | admin |
| GET | `/api/admin/club/leagues/:id/teams` | sessione | viewer |
| POST | `/api/admin/club/sync` | sessione, limite proprio `RATE_LIMIT_LEAGUE_SYNC` | admin |
| GET | `/api/admin/calendar` | sessione | viewer |
| POST | `/api/admin/calendar/fixtures` | sessione | admin |
| PUT | `/api/admin/calendar/fixtures/:id` | sessione | admin |
| DELETE | `/api/admin/calendar/fixtures/:id` | sessione | admin |
| PUT | `/api/admin/calendar/fixtures/:id/date` | sessione | admin |
| PATCH | `/api/admin/calendar/fixtures/:id/settings` | sessione | admin |
| PUT | `/api/admin/matches/:id/fixture` | sessione | admin |
| GET | `/api/admin/matches` | sessione | viewer |
| GET | `/api/admin/matches/:id` | sessione | viewer |
| POST | `/api/admin/agents` | sessione | admin |
| GET | `/api/admin/agents` | sessione | viewer |
| GET | `/api/admin/agent-quota` | sessione | viewer |
| PATCH | `/api/admin/agents/:id` | sessione | admin |
| DELETE | `/api/admin/agents/:id` | sessione | admin |
| GET | `/api/admin/agent-registrations` | sessione | admin |
| POST | `/api/admin/agent-registrations/:id/approve` | sessione | admin |
| POST | `/api/admin/agent-registrations/:id/reject` | sessione | admin |
| POST | `/api/admin/share-tokens` | sessione | admin |
| GET | `/api/admin/share-tokens` | sessione | viewer |
| DELETE | `/api/admin/share-tokens/:id` | sessione | admin |
| GET | `/api/admin/simulation` | sessione | admin |
| POST | `/api/admin/simulation` | sessione (corpo fino a ~2,7 MB) | admin |
| POST | `/api/admin/simulation/:command` | sessione (`pause`, `resume`, `stop`, `restart`) | admin |
| DELETE | `/api/admin/simulation` | sessione | admin |
| POST | `/api/admin/users` | sessione | admin |
| GET | `/api/admin/users` | sessione | admin |
| PATCH | `/api/admin/users/:id` | sessione | admin |
| DELETE | `/api/admin/users/:id` | sessione | admin |
| POST | `/api/admin/users/:id/invite` | sessione («Invia di nuovo») | admin |
| DELETE | `/api/admin/users/:id/invite` | sessione («Annulla invito»: elimina l'utente, 204) | admin |
| POST | `/api/admin/users/:id/reset-link` | sessione («Link per nuova password») | admin |
| GET | `/api/admin/mail-settings` | sessione | superadmin |
| PUT | `/api/admin/mail-settings` | sessione | superadmin |
| POST | `/api/admin/mail-settings/test` | sessione | superadmin |
| GET | `/api/admin/stats` | sessione, filtro `from`/`to` | viewer |
| GET | `/api/admin/stats/now` | sessione | viewer |
| GET | `/api/admin/stats/matches/:matchId/curve` | sessione | viewer |
| GET (WebSocket) | `/ws/public/:token` | link pubblico (token lungo o codice breve) | - |
| GET (WebSocket) | `/ws/admin` | sessione + controllo `Origin` | viewer |

La creazione di agenti e link restituisce 201 con il token in chiaro **una sola volta** (`CreateAgentResponse`,
`CreateShareTokenResponse` con `url`, `shortCode` e `shortUrl`). `DELETE` revoca (204), non cancella. `expiresAt` deve essere nel futuro e
`matchId`, se dato, deve esistere (altrimenti 400). La lista partite ha al massimo 200 elementi, ordinati per
aggiornamento. Una email già presente dà 409; la password, se data, ha almeno 12 caratteri (senza password l'utente è invitato).

### WebSocket
Messaggi server→client (`ServerMessage`):

- `state`: `{ type, matchId, version, state }`, stato intero; inviato alla connessione, come risposta a `resync` e quando
  un client non può ricevere il patch. Uno stato con `version` non maggiore dell'ultimo inviato per la stessa partita è
  saltato.
- `patch`: `{ type, matchId, baseVersion, version, ops }`, le differenze dallo stato `baseVersion` allo stato `version`
  (operazioni `set`, `del`, `push`, `trunc` di `packages/shared/src/patch.ts`). Va solo a chi ha esattamente la
  `baseVersion` come ultimo stato ricevuto; gli altri ricevono lo stato intero.
- `noMatch`: nessuna partita disponibile (link "live" senza partita live).
- `scheduled`: `{ type, fixture }` (`UpcomingFixture`: squadre con logo, data e ora ufficiali in UTC, palazzetto, giornata,
  campionato, stato, risultato ufficiale, `inCalendar`); è la «Prossima partita» di un link del calendario finché nessun
  `.dvw` è abbinato. Come `noMatch` non viene mai inviato a chi ha già ricevuto uno stato; quando il `.dvw`
  arriva il client riceve `state`.
- `config`: `{ type }`, senza dati: la configurazione del cliente è cambiata e il client deve rileggere la grafica con
  `GET` (così nessun dato passa dal socket). L'hub lo manda a tutti i socket pubblici e admin del solo cliente
  (`LiveHub`, `src/hub.ts`) tramite `tenantConfigChanged(ctx, tenantId)` (`src/tenancy.ts`), chiamato dopo i salvataggi di
  grafica, pagina, pause, avvisi (`routes/branding.ts`), sponsor (`routes/sponsors.ts`), importazione della grafica
  (`routes/graphicsTransfer.ts`), profilo del club e salvataggi della grafica del club (`routes/club.ts`) e modifica del cliente da
  parte del superadmin (`routes/tenants.ts`). Non cambia la versione dello stato.
- `error`: `{ type, message }`, ad esempio se lo stato iniziale non è leggibile.

Messaggi client→server (`ClientMessage`): `resync` (`{ "type": "resync" }`): il client ha perso il filo delle
versioni e chiede lo stato intero; `hello` (`{ type, visit, device, source, app }`, `HelloMessageSchema`): la pagina
pubblica lo manda una volta per socket appena aperto e apre la visita delle statistiche (sopra, «Statistiche delle
visite»); sui socket dell'area riservata è ignorato. Il messaggio è validato con lo schema condiviso, qualsiasi altra cosa (testo non JSON,
frame binari) è ignorata. Ogni `resync` ha risposta, ma `ResyncScheduler` (`src/lib/resync.ts`) la distanzia: al massimo
una ogni 5 s per socket (una sola in attesa per socket) e 100 al secondo per IP; le altre slittano ai secondi seguenti.
Payload massimo 4 KB.

**Come viaggiano gli aggiornamenti** (`LiveHub`, `src/hub.ts`):

- L'hub tiene in memoria l'ultimo stato di ogni partita (al massimo 64, `SNAPSHOT_LIMIT`), per patch, stato iniziale e
  `resync`; dopo un riavvio lo rilegge dal database alla prima richiesta (`remember`).
- A ogni `publish` il patch si calcola **una volta** con `diffJson`; se il suo testo supera il 50% dello stato intero
  (`PATCH_MAX_RATIO`) si manda lo stato intero, e lo si manda anche quando `finishedAt` cambia (la partita finisce o una
  correzione la riapre), perché un patch porta solo lo `state`. Un publish con `version` non maggiore di quella nota è scartato.
- Ogni frame è serializzato **una volta** e, per chi ha aperto il socket con `?enc=gzip`, compresso **una volta** con
  gzip livello 6 (`GZIP_LEVEL`) e inviato come frame binario; senza `enc=gzip` i frame sono testo JSON
  (`LiveSocketQuerySchema`, `encodingOf` in `src/state.ts`). Scelta documentata in `docs/decisioni.md`.
- `StatePublisher` è l'interfaccia con cui l'ingest pubblica: oggi è l'hub del processo, è pensata per sostituirla con
  Postgres LISTEN/NOTIFY quando ci saranno più copie del server.
- `attachLiveSocket` (`src/state.ts`) serve sia `/ws/public/:token` sia `/ws/admin`.
- `LiveHub.retarget(tenantId, clientFixtureId, message)`: dopo una conferma o una nuova copia del calendario manda subito
  ai client collegati a quella partita lo stato nuovo (o «Prossima partita»), azzerando la versione già inviata.
- Limite noto: dopo un riavvio, se due partite live dello stesso cliente sono pubblicate in ordine inverso, l'hub tiene
  come live la partita sbagliata fino al publish successivo.

Codici di chiusura: `4401` sessione admin terminata (logout o
scadenza), `4404` link pubblico revocato o scaduto, `1008` richiesta senza credenziali valide dopo l'upgrade, `1001`
arresto del server. `/ws/admin` rifiuta (403) un `Origin` non ammesso (`CORS_ORIGIN` o hostname del cliente), perché CORS non vale per i WebSocket.
Un client con più di 1 MB ancora da inviare è disconnesso subito (troppo lento). L'heartbeat gira ogni 30 s: manda un
ping, disconnette chi non ha risposto al precedente e chiude i client con credenziale scaduta o revocata.
`/ws/admin` segue sempre la partita live del cliente della sessione (il superadmin che cambia cliente si riconnette).

### Rate limit
Per indirizzo IP e per minuto. Default (`DEFAULT_RATE_LIMITS`, `apps/server/src/context.ts`), modificabili con le variabili
`RATE_LIMIT_LOGIN`, `RATE_LIMIT_INGEST`, `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_PUBLIC_WS`, `RATE_LIMIT_PUBLIC_INVALID`,
`RATE_LIMIT_ADMIN`, `RATE_LIMIT_REGISTER`, `RATE_LIMIT_AGENT_DOWNLOAD` (download dell'agente, 10),
`RATE_LIMIT_LEAGUE_SYNC` («Aggiorna ora» di un campionato, 6): login 10, ingest 600, `GET /api/public/:token/state` 6000, apertura di
`/ws/public/:token` 6000, rotte admin 300 (incluse `/api/auth/logout`, `/api/auth/me`, `/ws/admin`), creazione di una
registrazione agente 10 (la rotta `/status` usa il limite dell'ingest, perché l'agente interroga ogni 5 s). Oltre il
limite: 429. Le quattro rotte pubbliche dei link (`/api/auth/links/:token`, `invite/accept`, `password-reset/request`,
`password-reset/confirm`) hanno il limite `RATE_LIMIT_PASSWORD_RESET` (10); in più il recupero password accetta 3 richieste
all'ora per email (in memoria, vedi «Posta, inviti e recupero password»).

**Rotte pubbliche e pubblico in palestra** (`src/routes/public.ts`): molti telefoni escono con lo stesso IP (Wi-Fi della
palestra, NAT mobile), quindi i limiti delle rotte pubbliche sono larghi e **per le richieste riuscite non c'è altro
freno**. Per non rendere facile indovinare i token si contano per IP solo i **token sbagliati** (sconosciuti, revocati,
scaduti, di un altro cliente, hostname senza cliente): oltre `RATE_LIMIT_PUBLIC_INVALID` al minuto (`FailureLimiter`,
`src/lib/failureLimiter.ts`) quell'IP riceve 429 con `Retry-After` su ogni rotta pubblica fino alla fine del minuto.
Limite noto, accettato: molti telefoni dietro lo stesso NAT che aprono un link revocato (circa 2 fallimenti ciascuno)
possono bloccare quell'IP, link validi compresi, fino a un minuto. Per i codici brevi c'è in più il limite globale
`RATE_LIMIT_SHORT_CODE_INVALID` (vedi «Link breve e codice» in «Accessi»).

**Server al completo**: il numero di WebSocket pubblici aperti è limitato per IP (`WS_MAX_PER_IP`) e in totale
(`WS_MAX_TOTAL`). Oltre, sia l'apertura del WebSocket sia `GET /api/public/:token/state` rispondono 503 con
`Retry-After: 20` (`SERVER_FULL_RETRY_AFTER_S`); il portale usa quella risposta per mostrare «Troppi spettatori
collegati» e riprovare (`docs/portale.md`).
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

Altre protezioni: intestazioni di sicurezza `@fastify/helmet`, CORS solo per `CORS_ORIGIN` (metodi GET, POST, PUT, PATCH, DELETE),
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
| `RATE_LIMIT_PUBLIC` | `6000` (era 120) | richieste al minuto per IP su `GET /api/public/:token/state` (intero da 1 a 100000) |
| `RATE_LIMIT_PUBLIC_WS` | `6000` | aperture al minuto per IP di `/ws/public/:token`, riconnessioni comprese (intero da 1 a 100000) |
| `RATE_LIMIT_PUBLIC_INVALID` | `120` | richieste pubbliche con token sbagliato al minuto per IP; oltre, 429 fino alla fine del minuto (intero da 1 a 100000) |
| `RATE_LIMIT_SHORT_CODE_INVALID` | `1000` | codici brevi sbagliati al minuto da tutti gli IP insieme; oltre, 429 fino alla fine del minuto agli IP con errori recenti (intero da 1 a 100000) |
| `SHARE_CODE_SECRET` | obbligatoria con `NODE_ENV=production` (container); in sviluppo un segreto fisso con avviso nel log | segreto dei codici brevi, almeno 32 caratteri; cambiarlo cambia tutti i codici (QR stampati inutilizzabili, link lunghi no) |
| `WS_MAX_PER_IP` | `2000` | WebSocket pubblici aperti insieme da un IP; oltre, 503 (intero da 1 a 1000000) |
| `WS_MAX_TOTAL` | `6000` | WebSocket pubblici aperti insieme in totale; oltre, 503 (intero da 1 a 1000000) |
| `RATE_LIMIT_ADMIN` | `300` | richieste al minuto per IP sulle rotte admin (intero da 1 a 100000) |
| `RATE_LIMIT_REGISTER` | `10` | richieste al minuto per IP su `POST /api/agents/registrations` (intero da 1 a 100000) |
| `MATCH_MAX_LINES` | `20000` | righe scout massime per partita (massimo 1.000.000); oltre, 413 |
| `ASSETS_DIR` | `data/assets` (container: `/data/assets`) | cartella delle immagini dei clienti, una sottocartella per cliente; nel compose è il volume `assets` |
| `ASSETS_QUOTA_MB` | `50` | spazio massimo delle immagini di ogni cliente, in MB (intero da 1 a 1000); oltre, 409 |
| `RATE_LIMIT_AGENT_DOWNLOAD` | `10` | richieste al minuto per IP su `GET /api/admin/agent/download` (intero da 1 a 100000) |
| `AGENT_DOWNLOAD_DIR` | `data/downloads` (container: `/data/downloads`) | cartella con `arenalive-agent.exe` e `arenalive-agent.json` (da `scripts/costruisci-agente.sh`); relativa alla cartella di avvio; vuota: il portale dice che l'agente non è pubblicato |
| `RATE_LIMIT_LEAGUE_SYNC` | `6` | «Aggiorna ora» dei campionati al minuto per IP su `POST /api/admin/leagues/:id/sync` (intero da 1 a 100000) |
| `RATE_LIMIT_ROSTER_IMPORT` | `3` | importazioni della rosa dal sito della Lega al minuto per IP su `POST /api/admin/roster/import` (intero da 1 a 100000) |
| `RATE_LIMIT_PASSWORD_RESET` | `10` | richieste al minuto per IP su `/api/auth/links/:token`, `/api/auth/invite/accept`, `/api/auth/password-reset/request` e `/confirm` (intero da 1 a 100000) |
| `SETTINGS_ENCRYPTION_KEY` | assente | chiave di 32 byte in base64 che cifra la password del server di posta in `mail_settings`. Senza, la pagina «Posta» funziona ma non salva la password (409). Se non è di 32 byte l'avvio fallisce. Se cambia, la password salvata non si legge più: va reinserita in «Posta» |
| `LEAGUE_SYNC` | `on` | `on`/`off`: aggiornamento automatico dei campionati (notte e giorni di partita). `off` in sviluppo, nei test e nelle scansioni DAST: resta il pulsante «Aggiorna ora» |
| `LEAGUE_CONTACT` | `PUBLIC_BASE_URL` | contatto scritto nello `User-Agent` delle richieste a legavolley.it (ASCII stampabile, al massimo 200 caratteri) |

Le undici `RATE_LIMIT_*`, le due `WS_MAX_*`, `SHARE_CODE_SECRET` e `SETTINGS_ENCRYPTION_KEY` sono anche in `.env.example` e `docker-compose.yml`
(nel compose `SHARE_CODE_SECRET` è `${SHARE_CODE_SECRET:?…}`: senza la variabile nel `.env` ogni comando `docker compose`
fallisce).

**Attenzione**: un `.env` già esistente con `RATE_LIMIT_PUBLIC=120` (copiato dal vecchio `.env.example`) mantiene il
vecchio limite: oltre 120 richieste al minuto dallo stesso IP gli spettatori sono respinti (nella prova di carico, 120
connessi su 1000). Va tolto o alzato, poi `docker
compose up -d` per ricreare il servizio `server`.

Variabili solo per Docker Compose: `POSTGRES_DB` (`arenalive`), `POSTGRES_USER` (`arenalive`), `POSTGRES_PASSWORD` (obbligatoria),
`SERVER_BIND` (`127.0.0.1`, indirizzo su cui è pubblicata la 8090), `WEB_BIND` (`127.0.0.1`) e `WEB_PORT` (`8080`) per il
portale (`docs/portale.md`) e `AGENT_DOWNLOAD_HOST_DIR` (cartella dell'host montata in sola lettura su `/data/downloads`
del server, cioè `AGENT_DOWNLOAD_DIR`; senza, il volume Docker `downloads`, vuoto finché non lo si riempie). Va impostata
come `USCITA` di `scripts/costruisci-agente.sh` (`docs/infrastruttura.md`).

### Database
Schema in `apps/server/src/db/schema.ts` (Drizzle):

| Tabella | Contenuto |
|---|---|
| `tenants` | `slug` (unico), `name`, `hostnames` (`text[]` con indice GIN, unici fra clienti per controllo del server), `branding`, `layout`, `intermissions`, `overlays` (jsonb, default `{}`), `created_at` (migrazione `0002_tenants.sql`) |
| `users` | `tenant_id` (null solo per il superadmin; CHECK `superadmin` ⇔ `tenant_id` nullo), `email` (minuscola, unica su tutti i clienti), `password_hash` (argon2id), `role` (`superadmin`/`admin`/`viewer`), `disabled` (booleano, predefinito falso; migrazione `0008_utenti_clienti.sql`) |
| `sessions` | `token_hash` (sha256 del cookie), `user_id`, `expires_at`, `active_tenant_id` (cliente in cui è entrato il superadmin, `ON DELETE SET NULL`) |
| `agents` | `tenant_id`, `name`, `token_hash`, `revoked`, `last_seen_at` |
| `matches` | `tenant_id`, `match_key` (unica per `tenant_id` + `match_key`), `finished_at` (quando la partita è finita, nullable; migrazione `0019_dopo_partita.sql`, solo `ADD COLUMN`; vedi «Ora di fine partita» in «Ingest»), `header`, `line_count`, `content_hash`, `last_seq`, `agent_id`, `live` (una per partita del calendario più una tra le non abbinate: indici parziali `matches_one_live_per_fixture_idx` e `matches_one_live_unlinked_idx`), `live_since`, `state` (jsonb), `version`, `client_fixture_id` (→ `client_fixtures`, `ON DELETE SET NULL`), `fixture_link` (enum `fixture_link`: `auto`/`manual`/`pending`/`none`; nullo = non ancora valutato), `fixture_candidates` (jsonb: candidati con somiglianza; migrazione `0006_club.sql`) |
| `scout_lines` | `match_id`, `idx`, `text` (chiave primaria `match_id` + `idx`) |
| `leagues` | **comune a tutti i clienti** (migrazione `0005_leagues.sql`): `provider`, `external_id` (`IdCampionato`; unico con `provider`), `season`, `name`, `phases` (jsonb), `last_sync_at`, `last_success_at`, `last_status` (`never`/`ok`/`error`), `last_message`, `sync_started_at` (lease) |
| `league_teams` | `league_id`, `external_id` (unico per campionato), `name`, `short_name`, `city`, `venue`, `venue_address`, `logo_id`, `details_fetched_at`, `logo_fetched_at` |
| `fixtures` | `league_id`, `external_id` (`n<numero ufficiale>`; unico per campionato), `number`, fase, giornata, `starts_at` (UTC), `home_team_id`, `away_team_id`, impianto, `status` (`scheduled`/`played`/`postponed`), `home_sets`, `away_sets`, `set_scores`, `provider_match_id`, `note`, `content_hash` |
| `standings` | chiave `league_id` + `position`: `team_id` (nullo se il nome non è nel calendario), `team_name`, punti, partite, set e punti fatti e subiti, quozienti, `by_result` |
| `team_logos` | `sha256` (unico), `mime`, `width`, `height`, `bytes`: il file è `ASSETS_DIR/_leagues/<sha256>` |
| `system_logos` | **comune a tutti i clienti** (migrazioni `0016_loghi_sistema.sql` e `0017_loghi_sistema_varianti.sql`): `slot` (`left`/`right`) e `variant` (`positive`/`negative`, chiave insieme a `slot`), `id` (unico), `sha256`, `mime`, `width` (1-150), `height` (1-50), `bytes`, `updated_at`; il file è `ASSETS_DIR/_system/<sha256>` |
| `league_http_cache` | `url` (chiave), `etag`, `last_modified` |
| `tenant_leagues` | scelta del cliente (migrazione `0006_club.sql`): `tenant_id`, `league_id`, `league_team_id` (la squadra del club, nulla finché non scelta; `ON DELETE SET NULL`); unica per cliente e campionato |
| `client_fixtures` | copia delle partite del club dal calendario (migrazione `0006_club.sql`; `0007_ruoli_calendario.sql` aggiunge `origin` `league`/`manual`, `manual_kind` `friendly`/`cup`/`other`, `broadcast` `auto`/`on`/`off`, `hidden`, `our_logo_asset_id` e `opponent_logo_asset_id` → `assets` `ON DELETE SET NULL`, e rende `league_id` nullo; vincolo: `league_id` nullo se e solo se `origin` è `manual`): `tenant_id`, `league_id`, `fixture_external_id` (unica con cliente e campionato), `fixture_id`, `removed_at` (la partita non è più nel calendario, il link resta), `starts_at`, `our_side` (`club_side`: `home`/`away`), nomi, città e loghi delle due squadre, impianto, `round_label`, `league_name`, `status`, `home_sets`, `away_sets` |
| `share_tokens` | `tenant_id`, `token_hash`, `match_id` (null: segue la live), `client_fixture_id` (link di una partita del calendario, `ON DELETE CASCADE`; unico quando non nullo e non revocato: indice parziale dalla migrazione `0014_link_partita.sql`), `label`, `expires_at`, `revoked`, `short_code_hash` (unica, null finché non assegnato), `short_code_salt` (migrazioni `0004_short_codes.sql`, `0006_club.sql`) |
| `assets` | `tenant_id`, `kind` (enum `asset_kind`: `logo`/`sponsor`/`overlay`), `sha256`, `mime` (immagini e `video/mp4`/`video/webm`), `width`, `height`, `bytes`, `name` (nullable, nome del file al caricamento o dopo «Rinomina»; CHECK di lunghezza 1-120, `assets_name_check`; migrazione `0020_nomi_file.sql`, reversibile: le istruzioni sono in testa al file), `created_at`; indice univoco `assets_tenant_sha256_kind_idx` su cliente + `sha256` + `kind` (migrazione `0003_assets.sql`; `overlay` aggiunto dalla `0018_sfondi_avvisi.sql`, `ALTER TYPE … ADD VALUE`, **non reversibile**: Postgres non toglie un valore da un enum) |
| `players` | rosa (migrazione `0022_rosa.sql`; enum `player_role` e `player_source`): `tenant_id`, `season`, `number` (CHECK 0-99), `first_name`/`last_name` (CHECK 1-60), `role`, `birth_year`, `height_cm` (CHECK 120-250), `birthplace`, `nationality` (CHECK ≤3), `external_key`, `source`, `edited_fields` (jsonb), `photo_asset_id` (→ `assets`, `ON DELETE SET NULL`), `removed_at`, `position`, `created_at`, `updated_at`. Indici unici parziali: `players_tenant_season_key_idx` (cliente, stagione, `external_key` se non nulla) e `players_tenant_season_number_idx` (cliente, stagione, `number` fra i non rimossi) |
| `player_media` | altre foto e video di un giocatore: `tenant_id`, `player_id` (→ `players`, `ON DELETE CASCADE`), `asset_id` (→ `assets`, `ON DELETE CASCADE`), `position`; chiave primaria `(player_id, asset_id)`. `asset_kind` ha anche `player` (migrazione `0021_foto_giocatori.sql`, `ALTER TYPE … ADD VALUE`, **non reversibile**: Postgres non toglie un valore da un enum) |
| `sponsors` | anagrafica degli sponsor (migrazione `0015_sponsor.sql`): `tenant_id`, `name` (1-80, CHECK; unico per cliente: `sponsors_tenant_name_idx`), `website` (nullo o `https://…`, CHECK), `position`, `created_at`; `assets.sponsor_id` (→ `sponsors`, `ON DELETE SET NULL`, indice `assets_sponsor_idx`) |
| `agent_registrations` | `tenant_id`, `name`, `secret_hash` (unico), `pairing_code`, `ip`, `status` (enum `agent_registration_status`: `pending`/`approved`/`rejected`/`consumed`), `agent_id`, `created_at`, `expires_at`, `decided_at`, `agent_expires_at` (validità scelta all'approvazione; migrazioni `0001_agent_registrations.sql`, `0007_ruoli_calendario.sql`) |
| `agents`, `tenants` (colonne di `0007_ruoli_calendario.sql`) | `agents.expires_at` (nulla = senza scadenza); `tenants.club_profile` (jsonb, predefinito `{}`) e `tenants.agent_quota` (intero, predefinito 1; la migrazione la porta a max(1, agenti non revocati) per i clienti esistenti) |
| `tenants` (colonna di `0014_link_partita.sql`) | `match_links_enabled` (booleano, predefinito `false`; la migrazione lo accende per i clienti con link per partita validi, simulazioni escluse) |
| `user_tokens` | link monouso degli utenti (migrazione `0011_posta_inviti.sql`): `user_id` (→ `users`, `ON DELETE CASCADE`), `kind` (`invite`/`reset`, CHECK), `token_hash` (sha256, unico), `expires_at`, `created_at`; indice unico su (`user_id`, `kind`): un solo link per utente e tipo, quello nuovo sostituisce il vecchio. Un link usato, sostituito o annullato è cancellato; un utente con una riga `invite` non ha ancora scelto la password |
| `mail_settings` | server di posta, **una sola riga** per tutto il sistema (`singleton` sempre vero, CHECK): `host`, `port` (1-65535), `security` (`none`/`starttls`/`tls`), `username`, `password_enc` (password cifrata AES-256-GCM con `SETTINGS_ENCRYPTION_KEY`, forma `v1.<iv>.<tag>.<testo>`, nulla se manca), `from_name`, `from_email`, `updated_at` (migrazione `0011_posta_inviti.sql`) |

La migrazione `0011_posta_inviti.sql` crea `user_tokens` e `mail_settings`.

La migrazione `0012_primo_accesso.sql` aggiunge `tenants.onboarded_at` (timestamp, nullo = procedura guidata da fare) e la
imposta a `now()` per i clienti già configurati (con un campionato scelto, `club_profile` o `branding` non vuoti).

La migrazione `0008_utenti_clienti.sql` aggiunge `users.disabled`, riporta `tenants.agent_quota` in [0, 100] e aggiunge il
CHECK `tenants_agent_quota_check`.

La migrazione `0002_tenants.sql` crea il cliente «Predefinito» (slug `predefinito`), gli assegna tutti i dati esistenti e
solo dopo rende `tenant_id` NOT NULL.

Le migrazioni generate (`pnpm --filter @arenalive/server db:generate`) stanno in `apps/server/drizzle` e sono applicate
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
  pnpm --filter @arenalive/server dev
```

Secondo terminale (login con cookie, token agente, link pubblico, stato):

```bash
# --- variabili ---
SERVER="http://127.0.0.1:8090"           # indirizzo del server (PORT di default 8090)
ADMIN_EMAIL_DEV="admin@example.com"      # la stessa email usata all'avvio
ADMIN_PASSWORD_DEV="password-di-prova-1" # la stessa password usata all'avvio
COOKIE_JAR="/tmp/arenalive-cookie.txt"         # file dove curl salva il cookie di sessione
TENANT_ID="<id>"                         # campo "id" del cliente in cui entrare, da GET /api/admin/tenants (il superadmin fuori da un cliente riceve 409)

# --- comandi ---
curl -s -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL_DEV\",\"password\":\"$ADMIN_PASSWORD_DEV\"}" \
  "$SERVER/api/auth/login"

# elenco dei clienti (per leggere TENANT_ID) e ingresso nel cliente («Entra nel cliente»)
curl -s -b "$COOKIE_JAR" "$SERVER/api/admin/tenants"
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"tenantId\":\"$TENANT_ID\"}" "$SERVER/api/admin/active-tenant"

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
COOKIE_JAR="/tmp/arenalive-cookie.txt" # cookie di sessione admin ottenuto con il login sopra
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
| `pnpm --filter @arenalive/server dev` | `tsx watch --conditions=@arenalive/source src/main.ts` (legge i sorgenti) |
| `pnpm --filter @arenalive/server build` | compila in `dist/` |
| `pnpm --filter @arenalive/server start` | `node dist/main.js` (serve la build) |
| `pnpm --filter @arenalive/server test` | `vitest run` con PGlite in memoria, non serve Postgres |
| `pnpm --filter @arenalive/server db:generate` | `drizzle-kit generate` dopo una modifica a `schema.ts` |

I test (`apps/server/test/`: `auth`, `config`, `hub`, `ingest`, `limits`, `migration`, `public`, `registration`, `shortCodes`, `tenants`, `leagues`, `leaguesHtml`, `leagueFetcher`, `legavolley`, `club`, `fixtureMatch`) usano PGlite; `startServer` (`apps/server/test/helpers.ts`) accetta come terzo argomento l'opzione `startAt` (una `Date`):
l'orologio del server parte da quella data invece che da quella vera, per i test che dipendono dal giorno; i campionati non scaricano
nulla: i test di `legavolley` leggono le pagine vere salvate in `apps/server/test/fixtures/legavolley/`. Per la configurazione
di vitest vedi `docs/infrastruttura.md`.

### Docker Compose
`docker-compose.yml` (nome progetto `arenalive`) ha tre servizi:

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

Generare `SETTINGS_ENCRYPTION_KEY` (una volta; poi copiare il valore stampato in `.env` e riavviare il server; se la
chiave cambia, la password del server di posta va reinserita nella pagina «Posta»):

```bash
# --- variabili ---
BYTE_CHIAVE="32"   # la chiave deve essere di esattamente 32 byte (44 caratteri in base64)

# --- comando ---
openssl rand -base64 "$BYTE_CHIAVE"
# alternativa senza openssl:
# node -e "console.log(require('node:crypto').randomBytes(Number(process.argv[1])).toString('base64'))" "$BYTE_CHIAVE"
```

Generare `SHARE_CODE_SECRET` (una volta; poi copiare il valore stampato in `.env`):

```bash
# --- variabili ---
BYTE_CASUALI="36"   # byte casuali: 36 byte in base64 sono 48 caratteri, oltre il minimo di 32

# --- comando ---
openssl rand -base64 "$BYTE_CASUALI"
# alternativa senza openssl:
# node -e "console.log(require('node:crypto').randomBytes(Number(process.argv[1])).toString('base64'))" "$BYTE_CASUALI"
```

```bash
# --- variabili (nel file .env alla radice, copiato da .env.example) ---
# POSTGRES_PASSWORD  obbligatoria: solo lettere, cifre, - e _ (entra nell'URL)
# SHARE_CODE_SECRET  obbligatoria: almeno 32 caratteri, es. da `openssl rand -base64 48`. Senza questa variabile nel .env
#                    falliscono TUTTI i comandi docker compose (anche down, logs, config). Se cambia, cambiano tutti i codici brevi
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
Si lancia con `scripts/dast_zap.sh` (OWASP ZAP 2.17.0 in Docker, gratuito; sostituisce StackHawk, piano scaduto). Le
variabili (porta di prova `18090`, credenziali di prova, immagine ZAP, cartella dei report) sono in alto nello script.
La specifica OpenAPI, **ricavata a mano dalle rotte**, è `scripts/dast/openapi.yaml`: va aggiornata quando si aggiungono
o cambiano rotte. Le regole per i falsi positivi motivati sono in `scripts/dast/zap-regole.tsv`.

- Lo script avvia il server con PGlite in memoria con i `RATE_LIMIT_*` a 100000 tranne `RATE_LIMIT_LEAGUE_SYNC`, che resta al valore predefinito perché le rotte di scelta e aggiornamento della serie scaricano davvero da legavolley.it, e con `LEAGUE_SYNC=off` (nessun aggiornamento automatico), aspetta `/api/health`, lo ferma alla
  fine (trap).
- Crea con le API un **admin del cliente «Predefinito»** (`scan@arenalive.local`; non il superadmin, che fuori da un cliente
  avrebbe 409 su ogni rotta admin) e un token agente; fa il login e passa a ZAP il cookie `arenalive_session` e l'intestazione
  `Authorization: Bearer <token agente>` (regole `replacer` di ZAP) per raggiungere anche `/api/ingest`.
  `/api/auth/logout` non è nella specifica ed è escluso anche in ZAP. Le rotte del solo superadmin rispondono 403.
- I WebSocket (`/ws/public/:token`, `/ws/admin`) e il portale web **non sono coperti** (le intestazioni del portale le
  mette nginx, non il server di prova).
- Report in `~/arenalive-dast-report/` (`DAST_REPORT_DIR` per cambiarlo): `zap-report.html`, `zap-report.json`, `zap.log`.
  Uscita 0 pulito, 1 se restano avvisi di rischio Alto o Medio non ignorati, 2 errore di preparazione.

Esito storico del 2026-10-14 (StackHawk): 3 scansioni, soglia PASS. Due risultati di gravità Low sono segnati come falsi positivi:

- «Information Leak - Email Address»: per progetto le rotte autenticate restituiscono l'email dell'utente in sessione
  (`/api/auth/me`, `/api/auth/login`), mentre l'elenco utenti e l'utente appena creato (`GET`/`POST /api/admin/users`)
  vanno solo all'admin;
- «Private IP Disclosure» su `GET /api/admin/agents`: l'IP era nel nome di un agente inserito dallo scanner stesso
  durante la scansione e poi restituito dall'elenco admin. Il server non espone nessun IP interno.

Un difetto vero è emerso dai log: un NUL in un corpo JSON dava 500. È corretto (400 con `rejectNulBody`, vedi
«Validazione delle stringhe») e verificato: 0 errori 500 nella scansione finale.

## Riferimenti
- `scripts/dast_zap.sh`, `scripts/dast/openapi.yaml`, `scripts/dast/zap-regole.tsv`
- `apps/server/src/main.ts` (avvio), `app.ts` (`buildApp`, plugin, gestione errori), `config.ts` (`loadConfig`),
  `context.ts` (limiti, cache, cookie `arenalive_session`), `ingest.ts` (`IngestService`), `hub.ts` (`LiveHub`, `Frame`,
  `StatePublisher`, codici di chiusura), `lib/resync.ts` (`ResyncScheduler`), `lib/failureLimiter.ts` (`FailureLimiter`),
  `security.ts` (`requireRole`, `browserWriteGuard`, `sameOriginGuard`, `authenticateAgent`, `bearerHash` condivisa con
  l'ingest), `lib/tokens.ts` (`generatePairingCode`), `state.ts`, `seed.ts`
- Clienti: `src/tenancy.ts` (`hostTenant`, `hostnameFromHeader`, `tenantScope`, `adminTenantId`, `publicBaseUrlFor`),
  `src/routes/tenants.ts`, `packages/shared/src/tenant.ts`, `src/seed.ts`; certificati on demand: `src/routes/tlsAsk.ts`
  (`tlsAskRoutes`, `TlsAskQuerySchema`), `isTenantHostname` in `src/tenancy.ts`, test `test/tlsAsk.test.ts`
- Utenti: `src/routes/users.ts` (`userRoutes`, `userSummary`), `src/users.ts` (`lockTenantUsers`, `activeAdminsBesides`,
  `insertTenantUser`, `deleteUserSessions`, `closeSessionSockets`), `src/routes/auth.ts` (login), `src/security.ts`,
  `packages/shared/src/admin.ts` (`UpdateUserRequestSchema`, `UserSummarySchema`), `credentials.ts`;
  pagina «Utenti» in `docs/portale.md`
- Posta, inviti e recupero password: `src/mail/service.ts` (`MailService`, `smtpFailureMessage`), `src/mail/crypto.ts`
  (`encryptSecret`, `decryptSecret`, `decodeEncryptionKey`), `src/mail/templates.ts` (`inviteMail`, `resetMail`,
  `testMail`), `src/userLinks.ts` (`issueLink`, `findLink`, `consumeLink`, `inviteStates`, `hasOpenInvite`,
  `deliverInvite`, `linkUrl`), `src/routes/mailSettings.ts`, `src/routes/auth.ts`, `src/routes/users.ts`,
  `src/lib/failureLimiter.ts`; schemi in `packages/shared/src/mail.ts` e `credentials.ts` (`docs/architettura.md`);
  pagine in `docs/portale.md` («Posta», «Utenti del cliente», «Recupero password e inviti»)
- Grafica: `src/routes/branding.ts` (`brandingPublicRoutes`, `brandingAdminRoutes`), `src/lib/images.ts` (`inspectImage`,
  `checkSvg`, `IMAGE_MAX_SIDE`), `src/assetStore.ts` (`writeAssetFile`, `readAssetFile`, `removeAssetFile`),
  `packages/shared/src/assets.ts`, `colors.ts`, `tenant.ts`; sezione «Colori e loghi» dello «Studio grafico» in `docs/portale.md`
- Pagina pubblica a blocchi: `src/routes/branding.ts` (`GET`/`PUT /api/admin/layout`), `packages/shared/src/layout.ts`
  (`TenantLayoutSchema`, `resolveLayout`, `layoutImageIds`, `LayoutResponseSchema`); editor in `docs/portale.md`
- Pause della partita: `src/routes/branding.ts` (`GET`/`PUT /api/admin/intermissions`, `GET /api/public/tenant`),
  `packages/shared/src/intermissions.ts` (`TenantIntermissionsSchema`, `resolveIntermissions`, `intermissionImageIds`,
  `IntermissionsResponseSchema`), test `apps/server/test/intermissions.test.ts`; schermate in `docs/portale.md`
- Avvisi sugli eventi: `src/routes/branding.ts` (`GET`/`PUT /api/admin/overlays`, `GET /api/public/tenant`),
  `src/tenancy.ts`, `packages/shared/src/overlays.ts` (`TenantOverlaysSchema`, `resolveOverlays`, `OverlaysResponseSchema`),
  test `apps/server/test/overlays.test.ts`; eventi in `docs/statistiche.md`, schermate in `docs/portale.md`
- Agente scaricabile: `src/routes/agentDownload.ts` (`agentDownloadRoutes`, `readmeText`), `src/agentRelease.ts`
  (`AgentReleaseStore`), `src/lib/zip.ts` (`zipStream`, `fileCrc32`), `packages/shared/src/agentDownload.ts`, test
  `apps/server/test/agentDownload.test.ts`; script `scripts/costruisci-agente.sh`; pagina in `docs/portale.md`
- Campionati: `src/leagues/` (`html.ts` lettore HTML, `romeTime.ts` ora italiana, `legavolley.ts` URL e parser
  `parseCalendar`/`parseStandings`/`parseTeam`, `fetcher.ts` `LeagueFetcher`, `sync.ts` `LeagueService`, `scheduler.ts`
  `LeagueScheduler`/`dueSyncs`), `src/routes/leagues.ts` (`leagueRoutes`, `leaguePublicRoutes`), `src/assetStore.ts`
  (loghi), `src/db/schema.ts`, `drizzle/0005_leagues.sql`, `packages/shared/src/leagues.ts`; test
  `apps/server/test/leagues.test.ts`, `leaguesHtml.test.ts`, `leagueFetcher.test.ts`, `legavolley.test.ts`
- Club e calendario: `src/club.ts` (`refreshClientFixtures`, `evaluateFixtureLink`, `scheduledMessage`, `upcomingOf`,
  `fixtureLabel`, `tenantsOfLeague`, `leaguesWithClubMatches`, `publicSchedule`), `src/leagues/match.ts` (`linkFixture`, `teamNameScore`,
  `nameTokens`, `dvwFacts`, `parseDvwDate`), `src/matchLock.ts` (`lockTenantMatches`, `switchOffOthers`, `canStayLive`),
  `src/state.ts` (`currentMessage`, `announceFixture`, `refreshClub`, `targetOf`), `src/hub.ts` (`Target` `fixture`,
  `PublishRoute`, `retarget`, `currentScheduled`, `rememberScheduled`, `SCHEDULED_TTL_MS`), `src/routes/club.ts`
  (`clubRoutes`, `clubPublicRoutes`), `src/context.ts` (`SCHEDULE_CACHE_TTL_MS`), `drizzle/0006_club.sql`, `packages/shared/src/club.ts`; pagine in `docs/portale.md`
- Ruoli, calendario del cliente e canale: `src/routes/calendar.ts` (`manualFixtureRoutes`), `src/routes/club.ts`
  (`PUT /api/admin/club/profile`), `src/routes/manifest.ts` (`manifestRoutes`), `src/agentQuota.ts` (`lockTenantAgents`,
  `agentsInUse`, `requireAgentSlot`, `quotaReached`), `src/state.ts` (`channelChoice`, `channelMessage`, `channelAllowed`,
  `CHANNEL_STALE_MS`, `ChannelWatcher`, `closeNotBroadcast`, `withLogos`), `src/club.ts` (`broadcastOf`,
  `ourTeamForManual`, `comingFixtures`), `drizzle/0007_ruoli_calendario.sql`, `packages/shared/src/club.ts`, `admin.ts`,
  `tenant.ts`, `manifest.ts`, `registration.ts`; test `apps/server/test/roles.test.ts`
- Simulazione: `src/simulation/source.ts` (`fileMatch`, `generatedMatch`,
  `dvwRejected`, `dvwTooLarge`), `src/simulation/service.ts` (`SimulationService`, `SIMULATION_MAX_ACTIVE`,
  `SIMULATION_MIN_SEND_MS`, `SIMULATION_SWEEP_MS`), `src/routes/simulation.ts` (`simulationRoutes`), `src/ingest.ts`
  (`applyIngest`, `IngestSource`), `src/hub.ts` (`PublishRoute.isolated`, `forgetMatch`), `src/db/schema.ts`
  (`matches.simulated`), `drizzle/0009_simulazione.sql`, `packages/shared/src/simulation.ts`;
  pagina in `docs/portale.md`, tempi in `docs/simulatore.md`; test `apps/server/test/simulation.test.ts`
- Link brevi: `src/lib/shortCode.ts` (`deriveShortCode`, `shortCodeLookupHash`), `src/shareCodes.ts` (`insertShareToken`,
  `ensureShortCode`, `syncShortCodes`, `currentShortCode`), `src/lib/failureLimiter.ts` (`hasRecent`),
  `packages/shared/src/admin.ts` (`ShortCodeSchema`, `normalizeShortCode`, `formatShortCode`, `ShareTokenParamSchema`),
  `apps/server/test/shortCodes.test.ts`; lato portale in `docs/portale.md`, «Link breve e QR»
- Rotte: `src/routes/health.ts`, `ingest.ts`, `auth.ts`, `admin.ts`, `public.ts`, `registration.ts`, `tenants.ts`, `branding.ts`, `leagues.ts`, `club.ts`
- Database: `src/db/schema.ts`, `src/db/index.ts` (`createDatabase`), `src/db/pglite.ts`, `apps/server/drizzle/`
- Contratti: `packages/shared/src/ingest.ts`, `messages.ts`, `patch.ts`, `admin.ts`, `registration.ts` (`docs/architettura.md`)
- Prova di carico dei WebSocket: `tools/carico` (`docs/infrastruttura.md`, «Prova di carico»)
- Calcoli: `docs/dvw-parser.md`, `docs/statistiche.md`; simulatore: `docs/simulatore.md`
- Portale e nginx: `docs/portale.md` (`docker/web.nginx.conf`)
- Infrastruttura e Docker: `docs/infrastruttura.md`; regole di sicurezza: `docs/regole/sicurezza.md`
- Decisioni: `docs/decisioni.md`
