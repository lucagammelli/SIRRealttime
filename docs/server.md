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
- **Ingest e WebSocket**: l'ingest usa il cliente dell'agente; la partita live è una per partita del calendario del club
  più una tra quelle non abbinate (indici `matches_one_live_per_fixture_idx` e `matches_one_live_unlinked_idx`, vedi «Club,
  calendario e abbinamento») e `hub.publish(tenantId, …)` spinge lo stato solo ai WebSocket di quel cliente. La
  registrazione degli agenti appartiene al cliente dell'hostname da cui arriva.
- **Cache del cliente dell'hostname**: `hostTenant` ricorda per 30 s (`LOOKUP_CACHE_TTL_MS`) il cliente di ogni hostname
  (`ctx.caches.hosts`); la cache è svuotata a ogni creazione o modifica di un cliente (`src/tenancy.ts`).
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

- **Rotte pubbliche** (senza token, stesso rate limit `RATE_LIMIT_PUBLIC`): `GET /api/public/tenant` dà nome, grafica e
  percorsi delle immagini del cliente dell'hostname (`Cache-Control: public, max-age=30`; 404 se nessun cliente); `GET
  /api/public/assets/:id` dà il file di un'immagine **solo** se è del cliente dell'hostname (altrimenti 404). Il tipo
  viene dal database (riconosciuto dai byte al caricamento), con `X-Content-Type-Options: nosniff`, `Content-Disposition:
  inline` e `Cache-Control: public, max-age=31536000, immutable`: l'`id` cambia a ogni file nuovo (una riga nuova con il
  suo sha256), quindi la cache non invecchia. Gli SVG escono con `image/svg+xml; charset=utf-8` e CSP `default-src 'none';
  style-src 'unsafe-inline'; sandbox`, perché aperti direttamente non eseguano né carichino nulla.
- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET`/`PUT
  /api/admin/branding` (il corpo del `PUT` è il branding; ogni immagine deve essere di quel cliente e del tipo del suo
  posto, `BRANDING_IMAGE_SLOTS`: `logoMain` e `logoMark` sono `logo`, `sponsorLogo` è `sponsor`, altrimenti 400); `GET
  /api/admin/assets` (elenco, `usedBytes`, `quotaBytes`), `POST /api/admin/assets` (caricamento), `DELETE
  /api/admin/assets/:id` (204). Il salvataggio svuota la cache degli hostname (`forgetTenants`), così la pagina pubblica
  usa subito la nuova grafica; `PUT` è nei metodi CORS.
- **Caricamento**: JSON `{ kind, data }` con `data` in base64 (`UploadAssetRequestSchema`; il guard delle rotte admin
  accetta solo JSON). Errori: 413 oltre 2 MB (`ASSET_MAX_BYTES`), 422 immagine non ammessa, 409 quota esaurita
  («Spazio per le immagini esaurito (… MB): elimina quelle che non usi») o, in eliminazione, immagine in uso («Immagine
  in uso nella grafica: toglila prima di eliminarla»). Lo stesso file caricato di nuovo (stesso cliente, sha256 e `kind`)
  restituisce l'immagine già salvata con 200 (201 se nuova).
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
- **Immagini degli sponsor**: gli id in `options.images` dei blocchi `sponsor` (`layoutImageIds`) devono essere immagini
  di quel cliente, controllate nella stessa transazione e sotto lo stesso lock per cliente di caricamenti, eliminazioni e
  grafica; altrimenti 400. Dopo il salvataggio si svuota la cache degli hostname (`forgetTenants`).
- **Rotta pubblica**: `layout` è anche in `GET /api/public/tenant` (`PublicTenantResponseSchema`), così il portale lo
  legge con la grafica. Un layout non valido o di versione futura si legge come predefinito: quando `TENANT_CONFIG_VERSION`
  salirà servirà una migrazione dei layout salvati.
- **Eliminazione di un'immagine**: se è usata in un blocco sponsor, `DELETE /api/admin/assets/:id` risponde 409 «Immagine
  in uso nella pagina pubblica: toglila dal blocco sponsor prima di eliminarla» (come per la grafica).

### Pause della partita (`apps/server/src/routes/branding.ts`)
Ogni cliente sceglie cosa vede il pubblico durante i time-out, a fine set e a fine partita (`TenantIntermissionsSchema`,
`tenants.intermissions`; forma, predefiniti e regole in `docs/architettura.md`, schermate ed editor in `docs/portale.md`).
La fase della partita (`state.phase`) è calcolata da `@sir/volley-stats` (`docs/statistiche.md`): il server non decide
nulla, la fase viaggia nello stato come ogni altro campo. `{}` è valido e vale i predefiniti (`resolveIntermissions`).

- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET /api/admin/intermissions`
  e `PUT /api/admin/intermissions` (nessuna rotta nuova per le diapositive in stile TV e per «ogni N punti»: lo schema
  condiviso accetta i nuovi tipi di diapositiva, `milestone` con `every` e `stopBeforeEnd`; documenti salvati prima restano
  validi, i campi mancanti prendono i predefiniti); il corpo del `PUT` è il documento delle pause e la risposta è `IntermissionsResponse`
  (`tenantName`, `intermissions`). Validazione con lo schema condiviso (tipi di diapositiva chiusi, durate 3-60 s, ritardo
  0-60 s, al massimo 12 diapositive, una pausa attiva con almeno una diapositiva): altrimenti 400.
- **Immagini degli sponsor**: gli id delle diapositive `sponsor` (`intermissionImageIds`) devono essere immagini di quel
  cliente, controllate nella stessa transazione e sotto lo stesso lock per cliente di caricamenti, eliminazioni, grafica e
  layout; altrimenti 400. Dopo il salvataggio si svuota la cache degli hostname (`forgetTenants`).
- **Rotta pubblica**: `intermissions` è anche in `GET /api/public/tenant` (`PublicTenantResponseSchema`), con i predefiniti
  se il cliente non ha configurato nulla.
- **Eliminazione di un'immagine**: se è usata in una diapositiva sponsor, `DELETE /api/admin/assets/:id` risponde 409
  «Immagine in uso nelle pause: toglila dalla diapositiva sponsor prima di eliminarla».

### Avvisi sugli eventi (`apps/server/src/routes/branding.ts`)
Ogni cliente sceglie quali eventi della partita (ace, set point, match point…) compaiono come avviso breve sopra la pagina
pubblica, con testo, durata, dispositivi e priorità (`TenantOverlaysSchema`, `tenants.overlays`; forma, segnaposto e
predefiniti in `docs/architettura.md`, schermata ed editor in `docs/portale.md`). Gli eventi (`state.events`) sono calcolati
da `@sir/volley-stats` (`docs/statistiche.md`) e viaggiano nello stato come ogni altro campo: il server non decide nulla.
`{}` è valido e vale i predefiniti (`resolveOverlays`).

- **Rotte admin** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`): `GET /api/admin/overlays` e
  `PUT /api/admin/overlays`; il corpo del `PUT` è il documento degli avvisi e la risposta è `OverlaysResponse`
  (`tenantName`, `overlays`). Validazione con lo schema condiviso (eventi e segnaposto in lista chiusa, testo senza `<` e `>`,
  durata 2-8 s, priorità 1-10): altrimenti 400. Nessuna immagine, quindi nessun controllo sugli asset. Dopo il salvataggio si
  svuota la cache degli hostname (`forgetTenants`).
- **Rotta pubblica**: `overlays` è anche in `GET /api/public/tenant` (`PublicTenantResponseSchema`), con i predefiniti se il
  cliente non ha configurato nulla (`apps/server/src/tenancy.ts` legge la colonna).

### Agente scaricabile (`apps/server/src/routes/agentDownload.ts`)
Il portale offre l'agente per Windows come zip già pronto per il cliente (portale: `docs/portale.md`, pagina «Agenti»;
finestra e grafica: `docs/agente.md`; costruzione dell'exe: `docs/infrastruttura.md`). L'exe è **uno solo per tutti i
clienti**, costruito da `scripts/costruisci-agente.sh` in `AGENT_DOWNLOAD_DIR` insieme a `sir-agent.json`
(`AgentReleaseSchema`: `version`, `builtAt`, `sha256`, `nodeVersion` facoltativa); lo zip è generato **a ogni richiesta**.

- **Rotte** (ruolo `admin`; il superadmin lavora sul cliente attivo, `adminTenantId`; un viewer riceve 403):
  - `GET /api/admin/agent/info` → `AgentDownloadInfo`: `{ available: false }` oppure `available`, `version`, `builtAt`,
    `bytes`, `sha256`, `fileName`. Risposta `no-store`.
  - `GET /api/admin/agent/download` → lo zip `SIRRealtime-agente-<slug>-<versione>.zip` (`agentDownloadFileName`),
    `Content-Type: application/zip`, `Content-Disposition: attachment`, `Content-Length` noto, `no-store`. Se l'exe non è
    pubblicato: 404 «L’agente non è ancora stato pubblicato sul server» (apostrofo tipografico). Ha un limite proprio
    (`RATE_LIMIT_AGENT_DOWNLOAD`, 10 al minuto per IP), separato da quello delle altre rotte admin.
- **Contenuto dello zip**, tutto nella cartella `SIRRealtime-agente/` (`AGENT_ZIP_FOLDER`):
  - `sir-agent.exe`;
  - `config.json`: `watchPath` `E:\`, `serverUrl`, `dataDir` `C:\SIRAgent\data`, `logDir` `C:\SIRAgent\logs`
    (`agentDownloadConfig`). **Mai un token**: arriva con la registrazione automatica. `serverUrl` è l'URL pubblico del
    cliente (`publicBaseUrlFor`), **mai ricavato dall'header `Host`**; `allowHttpPrivateNetwork: true` c'è solo per `http`
    verso un IPv4 privato (prove in LAN);
  - `branding.json` (`AgentBrandingSchema`, versione 1): nome visualizzato del cliente e sei colori `#rrggbb` già risolti
    (`agentBranding`);
  - `logo.png` o `logo.jpg`: il logo orizzontale (`logoMain`), altrimenti quello quadrato (`logoMark`), solo se PNG o JPEG,
    fino a 2 MB e 1024×1024 px; SVG e WebP sono esclusi (WinForms non li legge). Senza un logo adatto non c'è;
  - `LEGGIMI.txt` (UTF-8 con BOM, fine riga CRLF): installazione in `C:\SIRAgent`, SmartScreen («Ulteriori informazioni» →
    «Esegui comunque»), registrazione e sha256 dell'exe (`readmeText`).
- **Controllo dell'exe** (`AgentReleaseStore`, `apps/server/src/agentRelease.ts`): l'exe è offerto solo se lo sha256 del
  file coincide con `sir-agent.json`; sha256 e CRC-32 si calcolano **una volta per versione** del file (inode, dimensione,
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

**Regole di buona educazione e sicurezza** (`legavolley.ts`, `fetcher.ts`):

- gli URL si costruiscono solo da numeri validati (`calendarUrl`, `standingsUrl`, `teamUrl`, `logoUrl`); `rejectedUrlReason`
  rifiuta ogni altro schema, host, credenziali, frammento, i percorsi vietati da `robots.txt`
  (`LEGAVOLLEY_ROBOTS_DISALLOWED`, controllato il 2026-10-16) e quelli fuori da `LEGAVOLLEY_ALLOWED_PATHS`;
- redirect seguiti a mano, al massimo 3 e solo verso URL ammessi;
- timeout di 15 s (`DOWNLOAD_TIMEOUT_MS`) valido anche per la lettura del corpo; al massimo 2 MB per pagina e 300 KB per
  logo (`DOWNLOAD_LIMITS`), contati **anche dopo la decompressione**;
- una richiesta per volta, con almeno 1 s fra due partenze (`MIN_REQUEST_INTERVAL_MS`);
- `User-Agent` `SIRRealtime/<versione> (+<contatto>)` (`leagueUserAgent`), con contatto `LEAGUE_CONTACT` o, se manca,
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
link resta (altrimenti QR già stampati e `.dvw` abbinati si perderebbero). Ogni partita non rimossa senza link ne riceve uno
(`ensureFixtureLinks`: indice univoco `share_tokens_client_fixture_idx`, un link per partita; etichetta «Avversario – data»,
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
  non revocato né scaduto (`<base>/l/<codice>`), `null` altrimenti. `live` è `true` se un `.dvw` di quella partita è live
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
live»); revocando il link di una partita non se ne crea uno nuovo (il «Calendario» lo mostra revocato); amichevoli e coppe
fuori calendario restano «da confermare» fino alla scelta «Nessuna (amichevole)».

**Prova reale** (2026-10-16): SuperLega 2026/27 (`IdCampionato` 999), squadra Perugia: 22 partite, ognuna con il suo link. I
`.dvw` reali Perugia–Suntory e Perugia–Itas (amichevoli, fuori calendario) restano «da confermare»; una copia con la data
della 5ª giornata si è abbinata da sola.

### Profilo del club, partite del cliente e canale (`src/routes/calendar.ts`, `src/routes/club.ts`, `src/state.ts`)
Lavoro «ruoli-calendario» (migrazione `0007_ruoli_calendario.sql`). Contratti in `packages/shared/src/club.ts`
(`docs/architettura.md`); pagine in `docs/portale.md`.

**Profilo del club** (`tenants.club_profile`, jsonb, `ClubProfileSchema`; `resolveClubProfile` riempie i predefiniti):
`series` (testo, al massimo `CLUB_SERIES_MAX` = 60), `coverage` (`homeAndAway` predefinita, oppure `homeOnly`) e `teamLogos`
(`all` predefinita, `ours`, `none`). `PUT /api/admin/club/profile` (`UpdateClubProfileRequest`, admin) salva insieme nome
mostrato, logo quadrato (un'immagine `logo` del cliente, altrimenti 400), «nostra squadra» (questi tre nella grafica) e il
profilo; poi svuota la cache dei clienti, rilegge le partite (`refreshClub`) e disconnette gli spettatori dei link che non
sono più trasmessi (`closeNotBroadcast`). Risponde con `ClubResponse`.

**Partite aggiunte a mano** (`manualFixtureRoutes`, admin, sotto `lockTenantMatches`; i loghi devono essere immagini `logo`
del cliente, altrimenti 400):

- `POST /api/admin/calendar/fixtures` (`ManualFixtureRequest`: `kind` `friendly`/`cup`/`other`, `startsAt` UTC, `opponent`,
  `opponentLogo`, `ourSide`, `venue`, `venueCity`) → 201 `{ id }`. La riga ha `origin` `manual`, `league_id` nullo, id esterno
  `manual:<id>`, giornata `Amichevole`/`Coppa`/`Partita` (`MANUAL_FIXTURE_LABEL`) e il nome della nostra squadra
  (`ourTeamForManual`); poi `refreshClub` le dà link breve e QR come alle altre e riprova i `.dvw` da confermare;
- `PUT /api/admin/calendar/fixtures/:id` → 204; `DELETE` → 204. Solo per le partite `manual`, altrimenti 400 «Si modificano
  e si cancellano solo le partite aggiunte a mano». Il `DELETE` toglie il link (spettatori disconnessi) e rimette i `.dvw`
  abbinati tra quelli «da confermare» (`pending`; restano live solo se nessun altro `.dvw` non abbinato lo è);
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
**Da verificare**: nel codice letto, uno stato di partita tenuto in memoria dall'hub (`current`) viene confrontato con
quello letto solo per la versione, non per le 6 ore; il riabbinamento immediato dopo un cambio di impostazioni non c'è
(si rivalutano solo i `.dvw` `pending`, `relinkPending`, a ogni `refreshClub`).

**Ruoli** (`requireRole`): il `viewer` legge club, calendario, agenti, quota agenti, link, grafica (`branding`, `layout`,
`intermissions`, `overlays`, `assets`) e partite; non legge utenti né richieste di registrazione (admin). Ogni scrittura
admin rifiuta il viewer con 403 prima di leggere il corpo; `apps/server/test/roles.test.ts` elenca le rotte che scrivono e
copre da solo quelle nuove.

**Manifest dell'app** (`routes/manifest.ts`, `GET /api/public/manifest.webmanifest`, rate limit pubblico,
`Cache-Control: public, max-age=300`): `webManifest` di `packages/shared/src/manifest.ts` con nome mostrato, colori e logo
quadrato (`logoMark`) del cliente dell'hostname; senza cliente quelli del portale («SIRRealtime»).

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
9. dopo il commit il nuovo stato (`StateMessage`) passa a `publisher.publish` con la rotta (`PublishRoute`: partita del
   calendario e se è appena diventata live; oggi `LiveHub`, vedi «WebSocket») e arriva ai client WebSocket di quel cliente
   che seguono la partita: come patch o come stato intero.

Una piccola cache in memoria (4 partite, verificata con `version` e `lineCount`) evita di rileggere tutte le righe a ogni
richiesta; la fonte di verità resta il database.

Corpo della richiesta: JSON, con `Content-Encoding: gzip` facoltativo (altri valori: 415). Limiti: 2 MB sul filo
(`INGEST_MAX_WIRE_BYTES`), 8 MB dopo la decompressione (`INGEST_MAX_DECODED_BYTES`, contro le zip bomb), massimo 5000
righe per richiesta (`INGEST_MAX_LINES`), 2000 caratteri per riga, header fino a 512 KB. Oltre il limite: 413.
Tutte le altre rotte accettano al massimo 64 KB, tranne `POST /api/admin/assets` (testo base64 di 2 MB più il JSON). Una riga che apre una sezione DVW (`[3NOME]`) o contiene a capo è
rifiutata dallo schema.

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
  partita fissa; con un `client_fixture_id` (link creati dal «Calendario», uno per partita, `ShareTokenSummary.clientFixtureId`)
  mostra «Prossima partita» e poi la partita abbinata (vedi «Club, calendario e abbinamento»). `expiresAt`
  facoltativa. Un token non valido, revocato o scaduto dà sempre 404; la revoca chiude subito i WebSocket già aperti (codice
  4404). Nei log il token è mascherato (`/api/public/[token]`). I link validi sono in una cache di 30 s
  (`ctx.caches.shares`, chiave `<cliente>:<hash del token>`), svuotata alla revoca (`forgetShareToken`), così le migliaia
  di aperture non leggono il database.
- **Link breve e codice** (`docs/portale.md`, «Link breve e QR»): ogni link attivo ha anche un codice di 8 lettere
  (`SHORT_CODE_LENGTH`, alfabeto `PAIRING_CODE_ALPHABET`, mostrato `K7M2-QX9P`) e l'URL `<base>/l/<codice>`, con base
  del cliente (`publicBaseUrlFor`, primo hostname del cliente). `ShareTokenSummary` ha `shortCode` e `shortUrl` (`null`
  se il link è revocato); `CreateShareTokenResponse` li include. Il codice **non è salvato**: sono i primi 40 bit di
  HMAC-SHA256(`SHARE_CODE_SECRET`, id del link, più `:<salt>` se il salt è > 0) (`deriveShortCode`,
  `src/lib/shortCode.ts`), quindi si ricalcola ogni volta che serve (anche per riscaricare il QR). Nel database c'è solo
  `short_code_hash` (unica) = HMAC con chiave derivata dal segreto su `lookup:<codice>` (`shortCodeLookupHash`), più
  `short_code_salt`: una copia del database da sola non permette di provare offline i 2^40 codici.
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
- **Sessioni admin e viewer**: login con email e password (argon2id) su `/api/auth/login`; cookie `sir_session`
  (`httpOnly`, `SameSite=Lax`, `Secure` secondo `COOKIE_SECURE`), durata `SESSION_TTL_HOURS`. Ruoli: `viewer` (sola lettura: partite, club,
  calendario, agenti, link e grafica; mai utenti e richieste di registrazione né scritture, 403), `admin` (tutto il resto del proprio cliente) e `superadmin` (anche i clienti; vedi «Clienti»). Le scritture
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
| GET | `/api/public/tenant` | rate limit pubblico (grafica del cliente dell'hostname) | - |
| GET | `/api/public/assets/:id` | rate limit pubblico (solo immagini del cliente dell'hostname) | - |
| GET | `/api/public/:token/state` | link pubblico, `:token` è il token lungo o il codice breve (404 se non valido) | - |
| GET | `/api/public/manifest.webmanifest` | rate limit pubblico (manifest dell'app del cliente dell'hostname) | - |
| GET | `/api/admin/branding` | sessione | viewer |
| PUT | `/api/admin/branding` | sessione | admin |
| GET | `/api/admin/layout` | sessione | viewer |
| PUT | `/api/admin/layout` | sessione | admin |
| GET | `/api/admin/intermissions` | sessione | viewer |
| PUT | `/api/admin/intermissions` | sessione | admin |
| GET | `/api/admin/overlays` | sessione | viewer |
| PUT | `/api/admin/overlays` | sessione | admin |
| GET | `/api/admin/assets` | sessione | viewer |
| POST | `/api/admin/assets` | sessione (corpo fino a ~2,7 MB) | admin |
| DELETE | `/api/admin/assets/:id` | sessione | admin |
| GET | `/api/admin/agent/info` | sessione | admin |
| GET | `/api/admin/agent/download` | sessione, limite proprio `RATE_LIMIT_AGENT_DOWNLOAD` | admin |
| GET | `/api/public/team-logos/:id` | rate limit pubblico (logo di una squadra dei campionati, uguale per tutti i clienti) | - |
| GET | `/api/admin/leagues` | sessione | superadmin |
| POST | `/api/admin/leagues` | sessione | superadmin |
| GET | `/api/admin/leagues/:id` | sessione | superadmin |
| POST | `/api/admin/leagues/:id/sync` | sessione, limite proprio `RATE_LIMIT_LEAGUE_SYNC` | superadmin |
| GET | `/api/admin/club` | sessione | viewer |
| PUT | `/api/admin/club` | sessione | admin |
| PUT | `/api/admin/club/profile` | sessione | admin |
| GET | `/api/admin/club/leagues/:id/teams` | sessione | viewer |
| POST | `/api/admin/club/sync` | sessione, limite proprio `RATE_LIMIT_LEAGUE_SYNC` | admin |
| GET | `/api/admin/calendar` | sessione | viewer |
| POST | `/api/admin/calendar/fixtures` | sessione | admin |
| PUT | `/api/admin/calendar/fixtures/:id` | sessione | admin |
| DELETE | `/api/admin/calendar/fixtures/:id` | sessione | admin |
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
| POST | `/api/admin/users` | sessione | admin |
| GET | `/api/admin/users` | sessione | admin |
| GET (WebSocket) | `/ws/public/:token` | link pubblico (token lungo o codice breve) | - |
| GET (WebSocket) | `/ws/admin` | sessione + controllo `Origin` | viewer |

La creazione di agenti e link restituisce 201 con il token in chiaro **una sola volta** (`CreateAgentResponse`,
`CreateShareTokenResponse` con `url`, `shortCode` e `shortUrl`). `DELETE` revoca (204), non cancella. `expiresAt` deve essere nel futuro e
`matchId`, se dato, deve esistere (altrimenti 400). La lista partite ha al massimo 200 elementi, ordinati per
aggiornamento. Una email già presente dà 409; la password ha almeno 12 caratteri.

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
- `error`: `{ type, message }`, ad esempio se lo stato iniziale non è leggibile.

Messaggio client→server (`ClientMessage`): solo `resync` (`{ "type": "resync" }`): il client ha perso il filo delle
versioni e chiede lo stato intero. Il messaggio è validato con lo schema condiviso, qualsiasi altra cosa (testo non JSON,
frame binari) è ignorata. Ogni `resync` ha risposta, ma `ResyncScheduler` (`src/lib/resync.ts`) la distanzia: al massimo
una ogni 5 s per socket (una sola in attesa per socket) e 100 al secondo per IP; le altre slittano ai secondi seguenti.
Payload massimo 4 KB.

**Come viaggiano gli aggiornamenti** (`LiveHub`, `src/hub.ts`):

- L'hub tiene in memoria l'ultimo stato di ogni partita (al massimo 64, `SNAPSHOT_LIMIT`), per patch, stato iniziale e
  `resync`; dopo un riavvio lo rilegge dal database alla prima richiesta (`remember`).
- A ogni `publish` il patch si calcola **una volta** con `diffJson`; se il suo testo supera il 50% dello stato intero
  (`PATCH_MAX_RATIO`) si manda lo stato intero. Un publish con `version` non maggiore di quella nota è scartato.
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
limite: 429.

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
| `AGENT_DOWNLOAD_DIR` | `data/downloads` (container: `/data/downloads`) | cartella con `sir-agent.exe` e `sir-agent.json` (da `scripts/costruisci-agente.sh`); relativa alla cartella di avvio; vuota: il portale dice che l'agente non è pubblicato |
| `RATE_LIMIT_LEAGUE_SYNC` | `6` | «Aggiorna ora» dei campionati al minuto per IP su `POST /api/admin/leagues/:id/sync` (intero da 1 a 100000) |
| `LEAGUE_SYNC` | `on` | `on`/`off`: aggiornamento automatico dei campionati (notte e giorni di partita). `off` in sviluppo, nei test e nelle scansioni DAST: resta il pulsante «Aggiorna ora» |
| `LEAGUE_CONTACT` | `PUBLIC_BASE_URL` | contatto scritto nello `User-Agent` delle richieste a legavolley.it (ASCII stampabile, al massimo 200 caratteri) |

Le dieci `RATE_LIMIT_*`, le due `WS_MAX_*` e `SHARE_CODE_SECRET` sono anche in `.env.example` e `docker-compose.yml`
(nel compose `SHARE_CODE_SECRET` è `${SHARE_CODE_SECRET:?…}`: senza la variabile nel `.env` ogni comando `docker compose`
fallisce).

**Attenzione**: un `.env` già esistente con `RATE_LIMIT_PUBLIC=120` (copiato dal vecchio `.env.example`) mantiene il
vecchio limite: oltre 120 richieste al minuto dallo stesso IP gli spettatori sono respinti (nella prova di carico, 120
connessi su 1000). Va tolto o alzato, poi `docker
compose up -d` per ricreare il servizio `server`.

Variabili solo per Docker Compose: `POSTGRES_DB` (`sir`), `POSTGRES_USER` (`sir`), `POSTGRES_PASSWORD` (obbligatoria),
`SERVER_BIND` (`127.0.0.1`, indirizzo su cui è pubblicata la 8090), `WEB_BIND` (`127.0.0.1`) e `WEB_PORT` (`8080`) per il
portale (`docs/portale.md`) e `AGENT_DOWNLOAD_HOST_DIR` (cartella dell'host montata in sola lettura su `/data/downloads`
del server, cioè `AGENT_DOWNLOAD_DIR`; senza, il volume Docker `downloads`, vuoto finché non lo si riempie). Va impostata
come `USCITA` di `scripts/costruisci-agente.sh` (`docs/infrastruttura.md`).

### Database
Schema in `apps/server/src/db/schema.ts` (Drizzle):

| Tabella | Contenuto |
|---|---|
| `tenants` | `slug` (unico), `name`, `hostnames` (`text[]` con indice GIN, unici fra clienti per controllo del server), `branding`, `layout`, `intermissions`, `overlays` (jsonb, default `{}`), `created_at` (migrazione `0002_tenants.sql`) |
| `users` | `tenant_id` (null solo per il superadmin; CHECK `superadmin` ⇔ `tenant_id` nullo), `email` (minuscola, unica su tutti i clienti), `password_hash` (argon2id), `role` (`superadmin`/`admin`/`viewer`) |
| `sessions` | `token_hash` (sha256 del cookie), `user_id`, `expires_at`, `active_tenant_id` (cliente scelto dal superadmin, `ON DELETE SET NULL`) |
| `agents` | `tenant_id`, `name`, `token_hash`, `revoked`, `last_seen_at` |
| `matches` | `tenant_id`, `match_key` (unica per `tenant_id` + `match_key`), `header`, `line_count`, `content_hash`, `last_seq`, `agent_id`, `live` (una per partita del calendario più una tra le non abbinate: indici parziali `matches_one_live_per_fixture_idx` e `matches_one_live_unlinked_idx`), `live_since`, `state` (jsonb), `version`, `client_fixture_id` (→ `client_fixtures`, `ON DELETE SET NULL`), `fixture_link` (enum `fixture_link`: `auto`/`manual`/`pending`/`none`; nullo = non ancora valutato), `fixture_candidates` (jsonb: candidati con somiglianza; migrazione `0006_club.sql`) |
| `scout_lines` | `match_id`, `idx`, `text` (chiave primaria `match_id` + `idx`) |
| `leagues` | **comune a tutti i clienti** (migrazione `0005_leagues.sql`): `provider`, `external_id` (`IdCampionato`; unico con `provider`), `season`, `name`, `phases` (jsonb), `last_sync_at`, `last_success_at`, `last_status` (`never`/`ok`/`error`), `last_message`, `sync_started_at` (lease) |
| `league_teams` | `league_id`, `external_id` (unico per campionato), `name`, `short_name`, `city`, `venue`, `venue_address`, `logo_id`, `details_fetched_at`, `logo_fetched_at` |
| `fixtures` | `league_id`, `external_id` (`n<numero ufficiale>`; unico per campionato), `number`, fase, giornata, `starts_at` (UTC), `home_team_id`, `away_team_id`, impianto, `status` (`scheduled`/`played`/`postponed`), `home_sets`, `away_sets`, `set_scores`, `provider_match_id`, `note`, `content_hash` |
| `standings` | chiave `league_id` + `position`: `team_id` (nullo se il nome non è nel calendario), `team_name`, punti, partite, set e punti fatti e subiti, quozienti, `by_result` |
| `team_logos` | `sha256` (unico), `mime`, `width`, `height`, `bytes`: il file è `ASSETS_DIR/_leagues/<sha256>` |
| `league_http_cache` | `url` (chiave), `etag`, `last_modified` |
| `tenant_leagues` | scelta del cliente (migrazione `0006_club.sql`): `tenant_id`, `league_id`, `league_team_id` (la squadra del club, nulla finché non scelta; `ON DELETE SET NULL`); unica per cliente e campionato |
| `client_fixtures` | copia delle partite del club dal calendario (migrazione `0006_club.sql`; `0007_ruoli_calendario.sql` aggiunge `origin` `league`/`manual`, `manual_kind` `friendly`/`cup`/`other`, `broadcast` `auto`/`on`/`off`, `hidden`, `our_logo_asset_id` e `opponent_logo_asset_id` → `assets` `ON DELETE SET NULL`, e rende `league_id` nullo; vincolo: `league_id` nullo se e solo se `origin` è `manual`): `tenant_id`, `league_id`, `fixture_external_id` (unica con cliente e campionato), `fixture_id`, `removed_at` (la partita non è più nel calendario, il link resta), `starts_at`, `our_side` (`club_side`: `home`/`away`), nomi, città e loghi delle due squadre, impianto, `round_label`, `league_name`, `status`, `home_sets`, `away_sets` |
| `share_tokens` | `tenant_id`, `token_hash`, `match_id` (null: segue la live), `client_fixture_id` (link di una partita del calendario, `ON DELETE CASCADE`; unico quando non nullo), `label`, `expires_at`, `revoked`, `short_code_hash` (unica, null finché non assegnato), `short_code_salt` (migrazioni `0004_short_codes.sql`, `0006_club.sql`) |
| `assets` | `tenant_id`, `kind` (enum `asset_kind`: `logo`/`sponsor`), `sha256`, `mime`, `width`, `height`, `bytes`, `created_at`; indice univoco `assets_tenant_sha256_kind_idx` su cliente + `sha256` + `kind` (migrazione `0003_assets.sql`) |
| `agent_registrations` | `tenant_id`, `name`, `secret_hash` (unico), `pairing_code`, `ip`, `status` (enum `agent_registration_status`: `pending`/`approved`/`rejected`/`consumed`), `agent_id`, `created_at`, `expires_at`, `decided_at`, `agent_expires_at` (validità scelta all'approvazione; migrazioni `0001_agent_registrations.sql`, `0007_ruoli_calendario.sql`) |
| `agents`, `tenants` (colonne di `0007_ruoli_calendario.sql`) | `agents.expires_at` (nulla = senza scadenza); `tenants.club_profile` (jsonb, predefinito `{}`) e `tenants.agent_quota` (intero, predefinito 1; la migrazione la porta a max(1, agenti non revocati) per i clienti esistenti) |

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

I test (`apps/server/test/`: `auth`, `config`, `hub`, `ingest`, `limits`, `migration`, `public`, `registration`, `shortCodes`, `tenants`, `leagues`, `leaguesHtml`, `leagueFetcher`, `legavolley`, `club`, `fixtureMatch`) usano PGlite; i campionati non scaricano
nulla: i test di `legavolley` leggono le pagine vere salvate in `apps/server/test/fixtures/legavolley/`. Per la configurazione
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
#   RATE_LIMIT_REGISTER=100000 RATE_LIMIT_PUBLIC_WS=100000 RATE_LIMIT_PUBLIC_INVALID=100000 \
#   RATE_LIMIT_LEAGUE_SYNC=100000 LEAGUE_SYNC=off pnpm dev   # LEAGUE_SYNC=off: la scansione non scarica da legavolley.it

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
  `context.ts` (limiti, cache, cookie `sir_session`), `ingest.ts` (`IngestService`), `hub.ts` (`LiveHub`, `Frame`,
  `StatePublisher`, codici di chiusura), `lib/resync.ts` (`ResyncScheduler`), `lib/failureLimiter.ts` (`FailureLimiter`),
  `security.ts` (`requireRole`, `browserWriteGuard`, `sameOriginGuard`, `authenticateAgent`, `bearerHash` condivisa con
  l'ingest), `lib/tokens.ts` (`generatePairingCode`), `state.ts`, `seed.ts`
- Clienti: `src/tenancy.ts` (`hostTenant`, `hostnameFromHeader`, `tenantScope`, `adminTenantId`, `publicBaseUrlFor`),
  `src/routes/tenants.ts`, `packages/shared/src/tenant.ts`, `src/seed.ts`
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
