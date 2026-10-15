# Decisioni

Una riga per decisione: data, scelta, motivo.

- 2026-10-14: monorepo con pnpm workspaces e condizione di export `@sir/source`, perché typecheck e test leggono i
  sorgenti senza compilare le dipendenze mentre build e runtime usano `dist` (`docs/infrastruttura.md`).
- 2026-10-14: TypeScript `~6.0.3` al posto di 7, perché typescript-eslint 8.71 non è compatibile con la 7.
- 2026-10-14: layout DV4 delle righe `[3SCOUT]` e `[3PLAYERS-*]` secondo il progetto openvolley/datavolley, perché è la
  descrizione più completa del formato disponibile (`docs/dvw-parser.md`).
- 2026-10-14: CI solo locale con `scripts/ci_locale.sh`, nessuna GitHub Action (scelta di Luca).
- 2026-10-14: campione sintetico (`samples/partita-sintetica.dvw`) generato dal simulatore, perché non ci sono ancora file
  DataVolley reali; i layout non confermati sono elencati in `docs/dvw-parser.md`.
- 2026-10-14: statistiche ricalcolate da zero a ogni aggiornamento (funzione pura, ~ms), rapporti 0-1
  (`docs/statistiche.md`).
- 2026-10-14: Fastify + Drizzle per il server, con PGlite (Postgres in WebAssembly) per i test, perché i test girano
  senza un Postgres installato con lo stesso SQL e le stesse migrazioni (`docs/server.md`).
- 2026-10-14: stato della partita ricalcolato a ogni ingest e inviato intero via WebSocket, perché il calcolo è puro e
  veloce e i client non devono gestire differenze o perdite di messaggi (`docs/server.md`).
- 2026-10-14: autenticazione dopo il rate limit (controlli in `preParsing`/`preValidation`/`preHandler`), perché
  i tentativi rifiutati devono essere contati e limitati anch'essi (`docs/server.md`).
- 2026-10-14: link pubblici "live" (`matchId` nullo) che seguono la partita corrente, perché il link da condividere
  resta lo stesso da una partita all'altra (`docs/server.md`).
- 2026-10-14: specifica OpenAPI per la DAST scritta a mano in `stackhawk/openapi.yaml` (nessuna generazione dal codice
  per ora), da aggiornare quando cambiano le rotte (`docs/server.md`).
- 2026-10-14: l'agente legge il `.dvw` con polling `fs.stat` invece di chokidar, perché sulle pennine USB/FAT gli eventi
  del file system non sono affidabili (`docs/agente.md`).
- 2026-10-14: criterio anti-troncamento con doppia lettura: un file senza a capo finale o con meno righe scout è inviato
  solo se una seconda lettura stabile è identica, perché un file scritto a metà non deve cancellare la partita sul
  server (`docs/agente.md`).
- 2026-10-14: coda dell'agente in un file JSON per partita (`dataDir/matches/<matchKey>.json`), compattata in uno
  snapshot oltre 20 messaggi, perché è semplice da scrivere in modo atomico e uno snapshot basta a riallineare il
  server (`docs/agente.md`).
- 2026-10-14: agente distribuito come eseguibile Node SEA (`postject`) e installato come servizio con NSSM, perché sul PC
  di DataVolley non deve servire Node e il servizio parte da solo e si riavvia (`docs/agente.md`).
- 2026-10-14: portale con React + Vite + Tailwind 4 + ECharts, perché i grafici (andamento, confronto, rotazioni) sono
  molti e interattivi, i token di stile stanno in un solo file CSS e ECharts finisce in un chunk a parte in cache
  (`docs/portale.md`, `docs/infrastruttura.md`).
- 2026-10-14: CSP rigida senza `unsafe-inline` né `unsafe-eval`, con zod in modalità `jitless` e tooltip ECharts
  `richText` disegnati nel canvas (testi filtrati da `richSafe`), perché il token del link è nell'URL e la pagina è
  pubblica: uno script iniettato non deve poter girare (`docs/portale.md`).
- 2026-10-14: nginx (servizio `web`) come unico ingresso, con il server pubblicato solo su `127.0.0.1`, perché nginx
  sovrascrive `X-Forwarded-For` con l'IP reale e così `TRUST_PROXY=true` non si può aggirare; anche l'agente usa l'URL del
  portale (`docs/portale.md`, `docs/server.md`).
- 2026-10-15: agente: `allowHttpPrivateNetwork` (default `false`) ammette http verso IPv4 privati letterali, mai verso nomi
  host o IP pubblici (un nome può risolversi in un IP pubblico), per provare in LAN senza https; warning all'avvio
  (`docs/agente.md`).
- 2026-10-15: auto-registrazione degli agenti con codice di abbinamento e abilitazione dell'admin, perché evita di copiare
  il token a mano sul PC (`docs/server.md`, `docs/portale.md`).
- 2026-10-15: token dell'agente consegnato una sola volta e salvato solo come hash; dopo la consegna la richiesta passa a
  `consumed`, perché un token non deve poter essere letto due volte (`docs/server.md`).
- 2026-10-15: `POST /api/agents/registrations/status` sul limite dell'ingest (`RATE_LIMIT_INGEST`), perché l'agente
  interroga ogni 5 s e il limite di creazione (10/min) lo bloccherebbe (`docs/server.md`).
- 2026-10-15: massimo 20 richieste di registrazione in attesa: un solo IP può riempirle in 2 minuti e bloccare le
  registrazioni fino a 24 h; accettato per un portale piccolo o in LAN, rimedio: rifiutare dal portale le richieste in
  coda (`docs/server.md`).
- 2026-10-15: finestra dell'agente in WinForms disegnata da PowerShell invece di Electron o di una pagina nel browser,
  perché serve un solo exe, nessuna dipendenza nativa nel bundle SEA e PowerShell c'è in ogni Windows
  (`docs/agente.md`).
- 2026-10-15: lucchetto `agent.lock` in `dataDir`, con attesa (nuovo tentativo ogni 30 s) in modo console/servizio,
  perché evita due agenti sulla stessa coda senza far riavviare il servizio NSSM a ripetizione (`docs/agente.md`).
- 2026-10-15: clienti (tenant) separati con un superadmin che li gestisce, perché più società devono usare la stessa
  installazione senza vedere i dati degli altri (`docs/server.md`).
- 2026-10-15: il cliente si ricava dall'header `Host` (impostato da nginx con `$host`) e mai da `X-Forwarded-Host`, perché
  un client non deve poter scegliere il proprio cliente attraverso il proxy (`docs/server.md`).
- 2026-10-15: il cliente su cui lavora il superadmin sta nella sessione (`sessions.active_tenant_id`), perché deve valere
  anche per il WebSocket `/ws/admin`, che non può portare un parametro per richiesta (`docs/server.md`).
- 2026-10-15: una partita live per cliente (non più una in tutto il sistema), perché i clienti sono indipendenti
  (`docs/server.md`).
- 2026-10-15: email utente unica su tutti i clienti; limite noto: il 409 rivela che l'email esiste in un altro cliente
  (`docs/server.md`).
- 2026-10-15: unicità degli hostname controllata dal server sotto lock e non da un vincolo del database; in futuro una
  tabella `tenant_hostnames` con UNIQUE (`docs/server.md`).
- 2026-10-15: aggiornamenti differenziali (patch) sul WebSocket con stato intero di riserva (patch oltre il 50% dello
  stato, client senza la `baseVersion`), perché con migliaia di spettatori lo stato intero a ogni punto costava 35 KB
  per spettatore (`docs/server.md`, `docs/architettura.md`).
- 2026-10-15: gzip fatto una volta per frame e inviato come frame binario con `?enc=gzip`, invece di permessage-deflate,
  perché quest'ultimo comprime separatamente per ogni connessione e costa CPU e memoria per socket (`docs/server.md`).
- 2026-10-15: `resync` come messaggio sullo stesso socket invece di chiudere e riaprire, perché la riapertura ripaga
  upgrade, autenticazione e stato iniziale e con molti client crea valanghe (`docs/server.md`).
- 2026-10-15: limiti per IP pensati per il pubblico in palestra, con tanti telefoni dietro lo stesso IP: larghi sulle
  richieste riuscite, e si contano solo i token sbagliati (`RATE_LIMIT_PUBLIC_INVALID`), perché indovinare i token resta
  lento senza bloccare gli spettatori (`docs/server.md`).
- 2026-10-15: cache di 30 s per link pubblici e cliente dell'hostname, con invalidazione esplicita (revoca del link,
  modifica dei clienti), perché ogni apertura di WebSocket leggeva il database e la revoca deve valere subito.
- 2026-10-15: nginx con `worker_connections` alzati (16384) e `nofile` 65536, perché ogni WebSocket usa due connessioni e
  i default non bastano per migliaia di spettatori (`docs/portale.md`).
- 2026-10-15: durata di un set chiuso presa da `[3SET]` invece che dalle ore delle righe, perché nei file reali tra la
  prima e l'ultima riga ci sono pause (110 minuti dalle ore contro i 20 ufficiali) (`docs/statistiche.md`).
- 2026-10-15: grafica del cliente letta dall'hostname e applicata come variabili CSS sopra `tokens.css`, perché i
  componenti e il tema ECharts non cambiano e i predefiniti restano in un solo posto (`docs/portale.md`).
- 2026-10-15: tipo e dimensioni delle immagini ricavati dai byte e SVG solo con una lista di elementi ammessi, più CSP
  `sandbox` sul file, perché il tipo dichiarato dal client non è affidabile e un SVG può eseguire script (`docs/server.md`).
- 2026-10-15: file delle immagini con nome sha256 per cliente e cache `immutable` di un anno, perché ogni file nuovo ha un
  `id` nuovo e la cache non invecchia mai (`docs/server.md`).
- 2026-10-15: caricamento delle immagini in JSON con base64, perché il guard delle rotte admin accetta solo JSON e non
  serve una dipendenza nuova per il multipart (`docs/server.md`).
- 2026-10-15: limiti delle immagini a 2 MB per file, 4096 px per lato e 50 MB per cliente (`ASSETS_QUOTA_MB`), perché
  loghi e sponsor sono piccoli e il disco del server è limitato (`docs/server.md`).
