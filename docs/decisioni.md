# Decisioni

Una riga per decisione: data, scelta, motivo.

- 2026-10-14: monorepo con pnpm workspaces e condizione di export `@arenalive/source`, perché typecheck e test leggono i
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
- 2026-10-15: codice breve dei link derivato con HMAC (`SHARE_CODE_SECRET`) e salvato solo come HMAC di lookup, perché
  rispetta «token solo come hash» e permette di riscaricare il QR (`docs/server.md`).
- 2026-10-15: limite globale dei codici brevi sbagliati applicato solo agli IP con errori recenti, perché un flusso di
  codici errati non deve poter bloccare gli spettatori (DoS); limite noto: IP condiviso con un errore recente
  (`docs/server.md`).
- 2026-10-15: log di nginx con token e codici brevi mascherati (`/l/[codice]`, `/live/[token]`, Referer `[omesso]`),
  perché nei log i link darebbero accesso alla partita (`docs/portale.md`).
- 2026-10-15: QR generato nel browser (libreria `qrcode`), senza servizi esterni, perché il link non deve uscire dal
  portale e il logo del cliente si disegna in locale (`docs/portale.md`).
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
- 2026-10-15: TV automatica solo con almeno 1600×800 px e proporzioni ≥ 16:10 (`?tv=1` la forza, `?tv=0` la esclude),
  perché un monitor desktop non deve perdere lo scorrimento (`docs/portale.md`).
- 2026-10-15: rotazione delle schermate TV con pulsante «Ferma rotazione», perché un cambio automatico va sempre
  fermabile (WCAG 2.2.2) (`docs/portale.md`).
- 2026-10-15: layout della pagina come elenco di blocchi per dispositivo (`defaultLayouts`), perché è la forma che
  produrrà l'editor a blocchi, poi realizzato come contratto in `@arenalive/shared` (`docs/portale.md`).
- 2026-10-15: larghezza dei blocchi da 1 a 12 su una griglia a 12 colonne (con i valori ammessi per tipo), perché 12 si
  divide in metà, terzi e quarti e le impaginazioni di prima (12/8/6/4) restano esprimibili (`docs/architettura.md`).
- 2026-10-15: layout come unione discriminata chiusa con opzioni per tipo (schema strict), perché il server non accetta mai
  un tipo o un'opzione sconosciuti e il portale non interpreta HTML né testo libero (`docs/architettura.md`).
- 2026-10-15: partita d'esempio dell'anteprima statica (`sampleMatch.json`), caricata solo dall'editor in un file a parte,
  perché la pagina pubblica non deve pesare di più e l'editor funziona anche senza partita live (`docs/portale.md`).
- 2026-10-15: classifica dei migliori giocatori (`topPlayers`) in `volley-stats` e non nel portale, perché i calcoli delle
  statistiche stanno solo lì, sono testabili e non si duplicano (`docs/statistiche.md`).
- 2026-10-15: fase della partita (pausa, gioco, fine set) calcolata solo dalle righe del `.dvw`, mai dall'orologio, perché
  deve essere uguale per ogni spettatore, riproducibile nei test e non dipendere dall'ora dei dispositivi
  (`docs/statistiche.md`).
- 2026-10-15: regola dell'MVP: più punti, poi efficienza d'attacco (senza attacchi conta meno di tutti), poi meno errori,
  poi casa, poi maglia più bassa, perché l'ordine deve essere sempre uguale e spiegabile al pubblico
  (`docs/statistiche.md`).
- 2026-10-15: la pausa di un singolo set sostituisce per intero quella generica di fine set, senza fusione dei campi,
  perché è prevedibile per chi la configura e l'anteprima mostra esattamente ciò che vedrà il pubblico
  (`docs/architettura.md`).
- 2026-10-15: ritorno alla partita fisso alla prima azione dopo la pausa e non configurabile, perché una schermata
  rimasta sopra il gioco farebbe perdere i punti al pubblico (`docs/portale.md`).
- 2026-10-15: le pause hanno un valore predefinito anche senza grafica caricata (e valgono se `GET /api/public/tenant`
  fallisce), perché un cliente nuovo deve avere le schermate senza configurare nulla; in caricamento non se ne mostra
  nessuna, per non far lampeggiare pause sbagliate (`docs/portale.md`).
- 2026-10-15: nessun logo per squadra, si usa il logo del cliente, perché i dati non hanno loghi di squadra e ne
  basta uno per cliente (`docs/portale.md`).
- 2026-10-15: eventi della partita (ace, set point, ...) calcolati in `volley-stats` e mandati nello stato (`events`, ultimi
  20), perché il portale non ha le azioni del rally e i calcoli di pallavolo non si duplicano (`docs/statistiche.md`).
- 2026-10-15: id degli eventi = tipo + set + punteggio, e il portale mostra solo gli eventi dalla riga più alta già vista in
  poi, perché una correzione dello scout a un rally passato cambia i punteggi e non deve rifar comparire avvisi vecchi
  (`docs/portale.md`).
- 2026-10-15: soglie degli avvisi: scambio lungo da 4 attacchi (le alzate non sono sempre registrate); pareggio e sorpasso solo
  dal 15-15 (9-9 al tie-break) o dopo una rimonta di 3 punti, perché a punteggi bassi sarebbero un avviso a ogni punto
  (`docs/statistiche.md`).
- 2026-10-15: avvisi scartati sopra una pausa a tutto schermo (e nessun avviso all'apertura, dopo resync o riconnessione),
  perché non devono coprire il riepilogo né raccontare cose già successe (`docs/portale.md`).
- 2026-10-16: un solo `arenalive-agent.exe` per tutti i clienti e zip generato al volo per ognuno (config, grafica, logo), perché
  l'exe pesa ~95 MB e non si ricostruisce per cliente (`docs/server.md`, «Agente scaricabile»).
- 2026-10-16: zip «store» (senza compressione) scritto in casa, senza dipendenze, perché l'exe è già un binario poco
  comprimibile, la dimensione è nota in anticipo (`Content-Length`) e non serve una libreria in più (`apps/server/src/lib/zip.ts`).
- 2026-10-16: `config.json` dello zip senza token, perché il token arriva con la registrazione automatica e uno zip
  scaricato e inoltrato non deve contenere credenziali (`docs/agente.md`).
- 2026-10-16: `proxy_buffering off` in nginx solo per `/api/admin/agent/download`, perché i ~90 MB dello zip passino al
  browser senza una copia su disco di nginx; per il resto resta il default (`docker/web.nginx.conf`).
- 2026-10-16: logo dell'agente fino a 1024×1024 px e 2 MB (PNG o JPEG), perché WinForms non legge SVG e WebP e un logo
  enorme appesantirebbe la finestra; oltre, grafica predefinita (`docs/agente.md`).
- 2026-10-16: duelli per ruolo abbinati per graduatoria interna (1° con 1°, 2° con 2°, solo fino al numero minore),
  perché nel `.dvw` non c'è chi marca chi e un abbinamento per posizione in campo cambierebbe a ogni rotazione
  (`docs/statistiche.md`, «Periodi, sintesi e duelli»).
- 2026-10-16: i «punti» dei giocatori contano solo le azioni (attacco, muro, ace), non gli errori avversari, perché un
  errore non è di un giocatore; la somma può quindi essere minore del parziale ufficiale (`docs/statistiche.md`).
- 2026-10-16: `pointMilestone` deterministica (dipende solo dallo stato) e il portale tiene per set la soglia più alta già
  mostrata, perché due spettatori vedano la stessa pausa «ogni N punti» e un salto di più soglie ne mostri una sola,
  senza orologio (`docs/statistiche.md`).
- 2026-10-16: modelli grafici (template) come elenco chiuso in `@arenalive/shared` (`TEMPLATES`) con i colori scelti dal cliente
  sopra, perché il server non accetta modelli sconosciuti e il cliente può comunque personalizzare i colori
  (`docs/architettura.md`, `docs/portale.md`).
- 2026-10-16: il modello SIR VOLLEY è solo scuro (tema forzato, niente pulsante del tema), perché le specifiche grafiche di
  Luca (`docs/grafica/`) prevedono solo il tema scuro.
- 2026-10-16: «nostra squadra» (codice e/o testo nel nome, senza maiuscole e accenti; nessuna o due corrispondenze: nessuna
  squadra) con le variabili casa/ospite ripuntate su nostra/avversaria anche in trasferta, perché i colori del cliente
  seguono la sua squadra qualunque sia il lato nel `.dvw` (`docs/portale.md`).
- 2026-10-16: rosso del testo piccolo con la variante `-ink` (`#eb515a`), perché `#E30613` su `#151518` ha solo 3,7:1 e
  sotto il 4,5:1 del WCAG (`docs/portale.md`).
- 2026-10-16: font Google Sans Code self-hosted (woff2 in `apps/web/src/styles/fonts/`, licenza OFL), perché la CSP resta
  chiusa su `'self'` e la pagina non chiama servizi esterni (`docs/portale.md`).
- 2026-10-16: breakpoint delle specifiche (telefono ≤767, tablet 768-1199, desktop ≥1200) per tutti i modelli, perché un
  solo insieme di soglie evita comportamenti diversi fra clienti (`docs/portale.md`).
- 2026-10-16: regole del telefono (colonne essenziali, rotazioni una squadra alla volta, filtri raccolti) valide per tutti i
  modelli, perché migliorano la lettura su schermo piccolo anche nel modello standard (`docs/portale.md`).
- 2026-10-16: niente loghi di squadra nel modello SIR VOLLEY per ora (scelta di Luca), perché i dati non li hanno
  (`docs/portale.md`).
- 2026-10-16: le diapositive in stile TV sono una vista dei calcoli di `period.ts`, perché i numeri restano in un solo
  posto (`volley-stats`) e il confronto del portale non duplica più le righe (`docs/portale.md`).
- 2026-10-16: la pausa «ogni N punti» ha una regola relativa al traguardo del set (`stopBeforeEnd`, predefinito 5: niente
  pausa a 5 punti o meno dal 25, o dal 15 al tie-break) e non un punteggio fisso, perché vale per ogni set e non si
  sovrappone al finale (`docs/architettura.md`).
- 2026-10-16: le diapositive senza dati sono saltate nelle pause (nei blocchi un messaggio), perché una pausa non mostri
  schermate vuote (`docs/portale.md`).
- 2026-10-16: area riservata con menu laterale a gruppi al posto della barra a pillole, perché le voci sono salite a nove
  e sul telefono non stavano più (`docs/portale.md`).
- 2026-10-16: tolto «Powered by Istante®» (piè di pagina, immagine, `footerLogo`/`footerText`), su richiesta di Luca.
- 2026-10-16: in TV l'altezza dei blocchi è misurata sullo schermo e i gruppi rifatti, invece di stime fisse, perché le
  stime tagliavano o sovrapponevano le schede con nomi e liste lunghe.
- 2026-10-16: verifica visiva con Chrome headless in una cartella temporanea, senza installarlo, perché il disco del
  server è quasi pieno (`docs/portale.md`, «Verifica visiva»).
- 2026-10-16: la pausa «ogni N punti» è attiva di default per tutti i clienti (richiesta di Luca) e si spegne da
  «Pause e sponsor» (`docs/portale.md`).
- 2026-10-16: i campionati si scaricano solo dai siti ufficiali (oggi `www.legavolley.it`), con host, percorsi e
  `robots.txt` controllati prima di ogni richiesta, e senza librerie di scraping (richiesta di Luca), perché i dati sono
  della Lega e il server deve comportarsi da client educato (`docs/server.md`, «Campionati»).
- 2026-10-16: lettore HTML nostro (`apps/server/src/leagues/html.ts`: tokenizer, pila esplicita, profondità 512) invece di
  una libreria, perché serve solo leggere tabelle e `select`, nessuna dipendenza in più e nessuna ricorsione su pagine
  ostili (`docs/server.md`).
- 2026-10-16: tabelle dei campionati (`leagues`, `league_teams`, `fixtures`, `standings`, `team_logos`) comuni a tutti i
  clienti, senza `tenant_id`, perché i dati sono pubblici e si scaricano una volta sola invece che una per cliente
  (`docs/server.md`, `docs/architettura.md`).
- 2026-10-16: aggiornamento con lease (`sync_started_at`, 15 minuti) e advisory lock solo nella scrittura, perché nessuna
  transazione deve restare aperta durante i download (lenti, anche 1 s fra una richiesta e l'altra) e due processi non
  devono aggiornare lo stesso campionato insieme (`docs/server.md`).
- 2026-10-16: id della partita = numero ufficiale (`n<numero>`), perché è stabile anche se cambiano data, ora o squadre di
  una partita rinviata (`docs/server.md`).
- 2026-10-16: loghi delle squadre in cache con nome sha256, sostituibili (riscaricati dopo 7 giorni), perché il sito può
  cambiarli; limite noto: quelli non più usati restano in `team_logos`. L'uso dei marchi va chiarito con Lega e club
  (`docs/server.md`).
- 2026-10-16: pagina «Club» in un gruppo «Club» della sidebar, separata da «Grafica», perché campionati e squadra non sono
  grafica: decidono calendario e link delle partite (`docs/portale.md`).
- 2026-10-16: il `.dvw` si collega alla partita del calendario con `matches.client_fixture_id` (più `.dvw` per la stessa
  partita) e l'unicità della live è nel database (due indici parziali: una live per partita del calendario, una tra le non
  abbinate), perché un incontro può avere più file (due PC, un riavvio) e la regola non deve dipendere dal codice
  (`docs/server.md`, «Club, calendario e abbinamento»).
- 2026-10-16: abbinamento `.dvw`-calendario con soglia 0,55 e margine 0,2 sul secondo candidato; nel dubbio `pending` e
  conferma dell'admin invece di indovinare, perché un abbinamento sbagliato manda la diretta sul link di un'altra partita
  e gli abbinamenti in silenzio non si notano (`docs/server.md`).
- 2026-10-16: il link «segue la live» passa a un'altra partita solo quando questa diventa live (non a ogni punto), perché
  due partite in contemporanea su due campi non devono strapparsi il link a ogni aggiornamento (`docs/server.md`).
- 2026-10-16: una conferma (dell'admin o di un aggiornamento del calendario) non toglie mai la diretta a chi è già live
  nello stesso gruppo, e la «Prossima partita» letta dal database resta in memoria 45 s (`SCHEDULED_TTL_MS`), svuotata
  quando arriva il `.dvw`, nel `retarget` e a ogni nuova copia del calendario, perché la diretta in onda non deve
  cambiare link per un errore di conferma e migliaia di aperture del QR prima della gara non devono leggere il database
  (`docs/server.md`).
- 2026-10-16: `client_fixtures` con `removed_at` invece di cancellare le partite sparite dal calendario, perché il loro link
  (QR già stampati) e i `.dvw` abbinati non si devono perdere se la Lega cambia il calendario (`docs/server.md`).
- 2026-10-16: rotta pubblica `GET /api/public/tenant/schedule` con cache di 60 s (server e browser, svuotata agli eventi
  che cambiano i dati), perché ogni spettatore della pagina la legge e i dati cambiano di rado: il database non deve
  sentire ogni telefono (`docs/server.md`).
- 2026-10-16: niente QR nella banda di «Prossima partita» sul telefono (il nome dell'avversario è il link), perché chi
  guarda è già sul telefono e non può inquadrarlo (`docs/portale.md`, «Blocchi del calendario»).
- 2026-10-16: blocchi e diapositive del calendario senza dati (nessun club, nessuna partita, classifica vuota) sono
  saltati invece di mostrare una card vuota, perché una pausa o una pagina pubblica non devono mai mostrare vuoti.
- 2026-10-16: la classifica è una tabella a colonne fisse (`table-fixed`: posizione, logo, squadra, Pt, G, V, P, SV, SP),
  perché a distanza, in TV, le colonne devono restare allineate e leggibili con nomi di squadra di lunghezza diversa.
- 2026-10-17: la voce «Pause e sponsor» si chiama «Pause» (sidebar, titoli, titolo della scheda); le righe del 2026-10-16
  restano com'erano scritte (`docs/portale.md`).
- 2026-10-17: Inter (self-hosted, variabile 400-700) per tutta l'area riservata e cifre tabulari, perché l'admin deve
  leggersi uguale con ogni modello grafico del cliente; la pagina pubblica SIR VOLLEY resta Google Sans Code
  (`docs/portale.md`).
- 2026-10-17: anteprima fissa (`PreviewDock`) in Grafica, Pagina pubblica, Pause e Avvisi, perché chi modifica deve vedere
  il risultato senza scorrere fino in fondo alla pagina (`docs/portale.md`).
- 2026-10-17: avvisi posizionabili (in alto, al centro, in basso; tre dimensioni, generali e per avviso), perché il
  punto migliore dipende dalla grafica e dallo schermo del cliente, e deve poterlo scegliere lui (`docs/architettura.md`).
- 2026-10-17: app installabile (PWA) con service worker minimo senza cache e CSP `worker-src 'self'` (era `'none'`), perché
  il browser lo richiede per l'installazione e nessuna cache evita dati vecchi in partita; se un giorno si aggiunge una
  cache vanno esclusi `/admin`, `/api` e `/ws` (`docs/portale.md`, `docs/infrastruttura.md`).
- 2026-10-17: kiosk per le TV (script che avvia il browser con `--kiosk`), perché il browser non permette lo schermo intero
  automatico senza un gesto dell'utente (`docs/portale.md`).
- 2026-10-17: «Studio grafico» unico (`/admin/studio/:sezione`) al posto delle quattro pagine Grafica, Pagina pubblica,
  Pause e Avvisi, per richiesta di Luca: erano lunghe e non era chiaro cosa cambiasse ogni impostazione; le vecchie rotte
  rimandano alla sezione dello Studio (`docs/portale.md`).
- 2026-10-17: nello Studio la scena dell'anteprima è automatica per sezione ma sempre scelta a mano, la configurazione
  guidata si apre al primo accesso, si salva una sezione per volta e sul telefono le pause sono a banda: decisioni di
  Luca sul prototipo, perché chi configura veda subito l'effetto e non perda lavoro per un cambio di sezione
  (`docs/portale.md`).
- 2026-10-17: l'anteprima dello Studio usa i componenti veri della pagina pubblica (`MatchView`, `Intermission`,
  `OverlayBanner`) con la bozza non salvata e marcatori inerti `data-studio-*`, perché un'anteprima separata si
  scosterebbe dalla pagina reale e basta un attributo senza effetto sul pubblico per trovare l'elemento cliccato
  (`docs/portale.md`).
- 2026-10-17: copertura predefinita «Casa e trasferta» (`homeAndAway`), perché nessuna partita deve sparire finché il
  cliente non sceglie «Solo partite in casa» (`docs/server.md`).
- 2026-10-17: quota iniziale di agenti = agenti non revocati dei clienti esistenti (almeno 1), perché la migrazione non
  deve spegnere né bloccare nessuno di quelli già in uso; poi la cambia solo il superadmin (`docs/server.md`).
- 2026-10-17: i vecchi link «segue la live» (`matchId` e `clientFixtureId` nulli) diventano il canale del club, senza
  migrazione, perché il bersaglio si ricava dal link e i QR già stampati continuano a funzionare (`docs/server.md`).
- 2026-10-17: le `.dvw` non abbinate a una partita del calendario restano visibili nel canale (quelle abbinate a una
  partita non trasmessa no), perché un'amichevole fuori calendario va comunque in onda (`docs/server.md`).
- 2026-10-17: nel canale la partita finita resta fino alle 00:00 (Roma) del giorno della successiva, perché il pubblico
  vede il risultato per giorni e il conto alla rovescia parte solo nel giorno della gara (`docs/server.md`).
- 2026-10-17: punti in sequenza (600 ms l'uno, al massimo 5) solo come presentazione nel portale, con gli stati intermedi
  da `matchStateUntilPoint` e lo stato che resta del server, perché due punteggi che saltano insieme sembrano un errore
  ma il server non deve conoscere il ritmo di chi guarda (`docs/portale.md`).
- 2026-10-17: salto alla fine se l'ultimo punto cadrebbe oltre 3 s e con `prefers-reduced-motion`, perché una pagina
  non deve restare indietro sulla partita e chi riduce il movimento non vuole attese (`docs/portale.md`).
- 2026-10-17: attesa massima di 2 s (`maxWaitMs`) per un file che cambia di continuo, perché un punto non resti fermo
  finché DataVolley scrive; polling non ridotto, perché a ritmo reale arriva già un punto per invio (`docs/agente.md`).
- 2026-10-17: agente riscritto in C# .NET 10 LTS come exe unico single-file (scelta di Luca), perché è un linguaggio solido e
  produce un exe nativo senza il trucco SEA/postject; il Node resta finché il C# non è provato su Windows (`docs/agente.md`).
- 2026-10-17: l'agente C# si costruisce in un container temporaneo dell'SDK su Linux (`scripts/costruisci-agente-dotnet.sh`),
  perché sul server non si installa .NET e il disco è poco: container, cache e immagine si rimuovono alla fine.
- 2026-10-17: servizio dell'agente C# creato dall'exe stesso con `--service` e `New-Service`, senza NSSM, perché toglie una
  dipendenza esterna da scaricare e il servizio gestisce da sé stop e codici di uscita.
- 2026-10-17: contratti dell'agente C# come JSON Schema generati da zod (`pnpm --filter @arenalive/shared schemi:agente`) con test
  che fallisce se sono vecchi, perché `packages/shared` resta l'unica fonte e il C# non può importare zod.
- 2026-10-17: fedeltà al Node garantita da un riferimento generato dal codice Node (`riferimento-node.json`), perché hash,
  `seq` e `matchKey` devono coincidere byte per byte e un confronto automatico evita di rifare i calcoli a mano.
- 2026-10-17: librerie del C#: JsonSchema.Net (solo test), xunit.v3 (test), System.ServiceProcess.ServiceController
  (servizio); `tsx` come devDependency di `@arenalive/shared` per generare gli schemi.
- 2026-10-17: quota agenti limitata solo alla lettura (`clampAgentQuota`) e schema di risposta stretto (0-100, più CHECK
  nel database), perché la migrazione 0007 aveva lasciato valori fuori limite (378) che rendevano illeggibile l'elenco dei clienti.
- 2026-10-17: un utente disattivato riceve lo stesso 401 «Credenziali non valide» della password sbagliata, perché la
  risposta non deve rivelare che l'account esiste né che è sospeso.
- 2026-10-17: ogni cliente ha sempre almeno un admin attivo (409 altrimenti, superadmin escluso, controllo sotto lock per
  cliente), perché un cliente senza admin non potrebbe più gestire i propri utenti.
- 2026-10-17: il primo utente si crea con il cliente, nella stessa transazione (email già usata: nessun cliente), perché
  il superadmin non deve lasciare un cliente nel quale nessuno può accedere.
- 2026-10-17: simulazione di una partita nel server, nella stessa pipeline dell'ingest (`applyIngest`) e senza agente,
  perché così si prova il comportamento reale (patch, pause, avvisi, link) e non una copia che potrebbe divergere.
- 2026-10-17: la partita simulata è isolata dalle vere (`matches.simulated`: mai live, mai nel canale, nel calendario,
  nelle liste né nei link fissi; stato solo ai client del suo link), perché una prova non deve toccare ciò che il
  pubblico vede.
- 2026-10-17: una simulazione per cliente e al massimo 5 attive nel server (`SIMULATION_MAX_ACTIVE`), perché ogni
  simulazione tiene timer e invii all'ingest e il carico deve restare limitato.
- 2026-10-17: partita e link della simulazione cancellati 6 ore dopo la fine o la pausa (e riusati tra una simulazione e
  l'altra), perché uno schermo di prova resti agganciato allo stesso link ma i dati finti non si accumulino.
- 2026-10-17: la simulazione ha solo due sorgenti, «Casuale» (generata dal simulatore) e il file `.dvw` caricato; gli
  esempi già pronti sono stati tolti, perché un file vero si carica e uno finto si genera, senza file da mantenere nel
  repository (`docs/server.md`, `docs/portale.md`).
- 2026-10-17: i tempi della simulazione sono a «durata» (secondi per set e pausa) o a «velocità» sul ritmo reale del file
  (`planPlayback`, funzione pura nel simulatore), perché serve sia una prova di durata nota sia il ritmo vero di una partita.
- 2026-10-17: l'etichetta «Simulazione» sulla pagina pubblica viene da `simulated: true` nello stato, perché chi guarda
  il link di prova non deve scambiarlo per una partita vera.
- 2026-10-17: il login vale da qualunque hostname e la sessione admin usa il cliente dell'utente, perché l'area riservata
  non deve dipendere dall'hostname da cui si arriva (restano per hostname solo pagine pubbliche e registrazione agenti).
- 2026-10-17: il superadmin lavora solo dentro un cliente in cui è entrato («Entra nel cliente»); fuori risponde 409
  `TENANT_REQUIRED` «Scegli prima un cliente» e il menu ha solo Clienti e Campionati, perché un'azione non deve finire
  per caso sul cliente dell'hostname. Barra gialla «Stai gestendo «X» come superadmin», prefisso «[X]» nel titolo della
  scheda ed entrata e uscita nei log lo rendono sempre evidente e tracciato; il vecchio selettore del cliente è tolto.
- 2026-10-17: la scansione DAST usa un admin del cliente «Predefinito» e non il superadmin (che fuori da un cliente ha 409
  e HawkScan non sa entrarci); la prova di carico entra da sola nel cliente se l'utente è il superadmin
  (`tenantForBase`), perché gli strumenti non devono dipendere dal vecchio cliente dell'hostname.
- 2026-10-17: i link delle partite del calendario si creano da soli a ogni aggiornamento del calendario
  (`ensureFixtureLinks`) e «Link pubblici» propone la partita live e le prossime trasmesse avvisando «Questa partita ha
  già il suo link»; i revocati sono nascosti dietro «Mostra revocati (N)», perché l'elenco resti leggibile e non si
  creino link doppi.
- 2026-10-17: menu dell'area riservata in gruppi «Partite» (Partita live, Partite, Calendario) e «Pagina pubblica» (Studio
  grafico, Link pubblici, Simulazione); il viewer vede in «Pagina pubblica» solo Link pubblici, perché raggruppa ciò che
  vedono gli spettatori e il viewer non modifica nulla.
- 2026-10-17: la data scelta a mano sta in colonne a parte (`override_*`) e non sovrascrive la data ufficiale, perché la
  sincronizzazione del calendario continua ad aggiornare la Lega e si può avvisare se la sposta dopo la modifica.
- 2026-10-17: `ClubFixture.startsAt` è la data effettiva (quella a mano, altrimenti l'ufficiale), così abbinamento `.dvw`,
  prossima partita, canale e link usano una sola data; l'ufficiale è in `officialStartsAt`.
- 2026-10-17: una data uguale all'ufficiale (o `null`) non crea nessuna modifica a mano, perché non c'è nulla da congelare
  e la partita resta allineata agli spostamenti della Lega.
- 2026-10-17: nel calendario date e ore sono sempre in ora di Roma, anche nei moduli, indipendentemente dal fuso del
  browser, perché le partite si giocano in Italia.
- 2026-10-17: il server di posta si imposta nella pagina «Posta» del superadmin e non nel `.env`, per volere di Luca, perché
  si cambia senza toccare il server; è uno solo per tutti i clienti (tabella `mail_settings`, una riga).
- 2026-10-17: la password SMTP è cifrata in database (AES-256-GCM, chiave `SETTINGS_ENCRYPTION_KEY` nel `.env`) e non
  torna mai al portale, perché un database copiato non riveli la password della posta; se la chiave cambia si reinserisce.
- 2026-10-17: dipendenza nuova `nodemailer` (solo nel server) per l'invio SMTP, con timeout brevi (5/8/10 s), perché la
  posta lenta non blocchi il portale.
- 2026-10-17: «Annulla invito» elimina l'utente, perché chi non ha mai scelto la password non ha dati da conservare e un
  utente a metà resterebbe in elenco senza poter accedere.
- 2026-10-17: il recupero password risponde sempre e subito allo stesso modo (il lavoro va in background), perché la
  risposta e i tempi non rivelino se un'email è registrata.
- 2026-10-17: il limite di 3 richieste di recupero all'ora per email sta in memoria (`FailureLimiter`) e si azzera al
  riavvio, perché basta a fermare l'invio di mail a catena senza una tabella in più; il limite per IP resta in più.
- 2026-10-17: link di invito (72 h) e di recupero (1 h) monouso, con solo l'sha256 nel database, costruiti da
  `PUBLIC_BASE_URL` e mai dall'intestazione `Host`; dopo il reset le sessioni dell'utente sono chiuse e, con un invito
  aperto, il login è rifiutato.
- 2026-10-17: il catalogo delle serie si scopre dal sito della Lega (menu e link di `/calendario/`) invece di un elenco di
  `IdCampionato` scritto nel codice, perché a ogni stagione gli id cambiano; gli indirizzi li costruiamo sempre noi e dal
  sito leggiamo solo numeri, con tetto di 10 pagine.
- 2026-10-17: la Serie A3 è una sola voce del catalogo con due gironi (si scaricano entrambi, resta collegato quello della
  squadra scelta), perché il club sceglie la serie e solo dopo la squadra, che decide il girone.
- 2026-10-17: «configurazione fatta» sta nel DB (`tenants.onboarded_at`, migrazione `0012`) e non in `localStorage`, perché
  vale per tutti i dispositivi e utenti del cliente; i clienti già configurati sono segnati come fatti dalla migrazione.
- 2026-10-17: la procedura guidata del primo accesso si apre da sola solo all'admin («Lettura e scrittura»), mai al viewer
  né al superadmin, perché solo l'admin può salvare le scelte; gli altri vedono al più l'avviso o il link.
- 2026-10-17: il cambio di stagione è automatico nell'aggiornamento notturno (squadra ritrovata per id esterno o nome,
  altrimenti avviso «Nuova stagione: scegli di nuovo la squadra»), perché ogni estate i campionati ripartono con id nuovi.
- 2026-10-17: nessuno «spettatore unico» nelle statistiche, solo visite, perché contarli richiederebbe un identificativo
  persistente (cookie, IP o impronta), che non vogliamo salvare.
- 2026-10-17: il desktop è contato come tablet nei dispositivi (`tv`, `tablet`, `phone`), perché la pagina pubblica ha
  solo questi tre impianti.
- 2026-10-17: la pagina iniziale dell'area riservata resta «Partita live»; «Statistiche» è un gruppo di menu a parte.
- 2026-10-17: nessun banner dei cookie, perché la pagina pubblica non usa cookie né salva nulla sul dispositivo (l'id di
  visita è solo in memoria).
- 2026-10-17: la pulizia a 90 giorni delle statistiche ha un timer orario proprio (`StatsService.housekeeping`), perché
  non deve dipendere da `LEAGUE_SYNC`, che può essere spento.
- 2026-10-17: le visite sotto i 3 s sono scartate e una riconnessione entro 30 s è la stessa visita, perché una pagina
  aperta e chiusa subito o un telefono che perde un attimo la rete falserebbero i conteggi.
- 2026-10-18: SIR VOLLEY non è più un modello pubblico: ai clienti si offrono quattro modelli (Standard, Chiaro e pulito,
  Scuro sportivo, Alto contrasto per TV), perché SIR VOLLEY è il look di un solo cliente; lo assegna il superadmin e il
  server rifiuta (403) chi non lo è (`docs/architettura.md`, `docs/portale.md`, `docs/server.md`).
- 2026-10-18: i temi personalizzati sono documenti JSON in `packages/shared/src/themes/` con il CSS generato da
  `pnpm --filter @arenalive/web themes` in un file versionato, perché un nuovo cliente costa un file e non codice, e la CSP
  `style-src 'self'` non ammette stili inseriti a runtime (`docs/architettura.md`).
- 2026-10-18: `ErrorBoundary` con ricarica automatica una sola volta per sessione quando un file del portale non esiste
  più, perché dopo un aggiornamento una scheda lasciata aperta resta bianca, ma un guasto vero non deve andare in ciclo
  (`docs/portale.md`).
- 2026-10-18: Caddy invece di nginx + certbot per l'HTTPS di produzione, perché ottiene e rinnova da solo i certificati
  Let's Encrypt per un elenco di hostname (`ARENALIVE_HOSTNAMES`) senza cron né script di rinnovo (`docs/infrastruttura.md`).
- 2026-10-18: Caddy senza access log, perché nel percorso ci sono i token dei link (`/live/<token>`, `/l/<codice>`) che
  nginx maschera nei suoi log e Caddy non saprebbe mascherare.
- 2026-10-18: aggiornamento in uno script separato (`aggiorna-produzione.sh`) con backup prima, verifica di salute e
  rollback del codice, perché si usa spesso e non deve rifare l'installazione del sistema; il database non torna indietro,
  per questo il backup `pre-aggiornamento`.
- 2026-10-18: l'agente scaricabile si costruisce solo con Docker (`pubblica-agente-produzione.sh`, ricostruito solo se
  cambia la versione), perché sul server non si installa .NET e il disco è poco.
- 2026-10-18: la guida utente è fatta di dati nel portale (`guide/content.ts`, pagina «Guida») e non è un documento
  esterno, con un test che vieta le parole tecniche, perché cambia insieme all'interfaccia, rispetta il ruolo (link solo
  verso pagine del menu) e chi la legge non è tecnico (`docs/portale.md`).
- 2026-10-18: «Il mio account» (cambio password con la password attuale) è per tutti i ruoli, anche il superadmin fuori da un
  cliente, perché la rotta non dipende dal cliente e ognuno deve poter cambiare la propria password senza un admin
  (`docs/server.md`, `docs/portale.md`).
- 2026-10-18: DAST con OWASP ZAP in Docker (`scripts/dast_zap.sh`) al posto di StackHawk, piano scaduto; specifica OpenAPI
  spostata in `scripts/dast/openapi.yaml` e aggiornata alle rotte recenti, regole dei falsi positivi in
  `scripts/dast/zap-regole.tsv` (oggi vuoto: prima scansione pulita, 0 avvisi Alto/Medio/Basso); portale e WebSocket non coperti.
- 2026-10-18: in produzione, finché non ci sono domini pubblici, `CERTIFICATI="interno"` usa la CA locale di Caddy (`tls internal`) e la sua radice si installa sui PC Windows (anche per l'agente, che continua a validare il TLS); si passa a Let's Encrypt rilanciando lo script con `CERTIFICATI="letsencrypt"` (`docs/infrastruttura.md`).
- 2026-10-18: `installa-produzione.sh` accetta Ubuntu 24.04 e 26.04; la suite apt di Docker è il nome in codice della release (`noble`, `resolute`: verificato che esiste su download.docker.com) e, se manca, lo script si ferma con un errore chiaro invece di ripiegare su un'altra suite.
- 2026-10-18: «Esporta / Importa configurazione» della grafica: pacchetto JSON versionato (`arenalive-grafica`, v1; dal 2026-10-20 il nome, prima `sirrealtime-grafica`, che si importa ancora) con branding, pagina, pause, avvisi e immagini (`GET /api/admin/branding/export`, `POST /api/admin/branding/import`, scheda nello Studio); l'importazione ricontrolla le immagini come un caricamento, rimappa gli id e sostituisce tutto in una transazione; un tema personalizzato lo importa solo il superadmin (altrimenti 403 chiaro, non si importa con un altro tema in silenzio).
- 2026-10-18: versione unica = campo `version` del `package.json` alla radice (1.0.0, tag `v1.0.0`); i `package.json` dei workspace restano a `0.0.0` (privati, mai pubblicati: allinearli sarebbe un secondo posto da tenere in pari senza alcun beneficio, e lo script di rilascio ne cambia uno solo). Server (`dist/build-info.json`), portale (Vite `define`), agente Node e C# (Version/FileVersion/InformationalVersion) la leggono al build con il commit corto (`ARENALIVE_COMMIT` nei build Docker, che non hanno `.git`); `GET /api/health` espone solo `version` e `commit`. Ogni rilascio ha un tag annotato `vX.Y.Z` creato da `scripts/rilascia.sh` (PR con versione e `CHANGELOG.md`, poi `--tagga` dopo il merge) e la produzione si aggiorna al tag.
- 2026-10-20: «Link e QR per singola partita» è un'opzione per cliente (`tenants.match_links_enabled`) che accende solo il
  superadmin; spenta di base, perché la maggior parte dei club si serve del solo canale con un QR; spegnerla revoca per
  sempre i link per partita (nessun ritorno a link vecchi, riaccendendo ne nascono di nuovi); la migrazione `0014` la
  accende per chi aveva già link validi (simulazioni escluse), così i QR già stampati non smettono di funzionare;
  l'indice unico su `client_fixture_id` è parziale (solo link non revocati), per ricreare i link dopo la riaccensione
  (`docs/server.md`, `docs/portale.md`).
- 2026-10-20: anagrafica sponsor separata dagli asset (tabella `sponsors`, `assets.sponsor_id` con `ON DELETE SET NULL`,
  migrazione `0015`) e blocco/diapositiva che scelgono gli sponsor, non le singole immagini, perché uno sponsor ha più
  immagini e un sito, e la rotazione segue l'ordine dell'elenco; `images` resta nello schema (immagini singole, dopo gli
  sponsor) per non rompere i documenti salvati; l'export della grafica include gli sponsor scelti (`version` ancora 1) e
  all'import si uniscono per nome (`docs/server.md`, `docs/portale.md`, `docs/architettura.md`).
- 2026-10-20: l'area riservata legge le immagini da `GET /api/admin/assets/:id/file` (cliente della sessione, cache
  privata) e non dalla rotta pubblica, perché questa dipende dall'`Host` e da un indirizzo di un altro cliente le
  anteprime davano 404; le diapositive delle pause hanno `enabled` (predefinito `true`) e gli sponsor di quelle spente
  contano comunque «in uso» (`docs/server.md`, `docs/architettura.md`).
- 2026-10-20: loghi di sistema globali (tabella `system_logos`, slot `left`/`right`, migrazione `0016`), caricati solo dal
  superadmin, con limite 150×50 px anche per gli SVG (per la misura dichiarata), perché sono un marchio della piattaforma,
  uguale per ogni cliente, e un logo grande romperebbe la testata sul telefono (`docs/server.md`, `docs/portale.md`).
- 2026-10-20: i loghi di sistema hanno due varianti per lato, positivo (sfondi chiari) e negativo (sfondi scuri), chiave
  `(slot, variant)` e migrazione `0017` (i loghi esistenti diventano positivi); il portale sceglie la variante dallo
  sfondo reale dietro al logo (luminanza < 0,5 → negativo, solo `background-color`), perché palette del cliente, modello
  e tema cambiano lo sfondo e un solo logo non è leggibile su tutti; il logo sinistro sostituisce il marchio dell'area
  riservata e la riga dei loghi resta solo nella pagina live (`docs/server.md`, `docs/portale.md`, `docs/architettura.md`).
- 2026-10-20: produzione su domini pubblici: portale `rt.istante.info`, cliente SIR `sir.istante.info`, certificati
  Let's Encrypt (`CERTIFICATI="letsencrypt"`, avvisi a development@istante.info), passaggio fatto rilanciando
  `installa-produzione.sh` insieme all'aggiornamento a v1.2.0; tolti i nomi privati `realtime.local` e
  `rt.sirsafetyperugia.it`, perché un nome senza DNS pubblico farebbe fallire certificato e rinnovi; gli agenti vanno
  puntati a `https://sir.istante.info/` (non seguono redirect) e la radice della CA interna si può togliere dai PC.
  (Superata dalla voce seguente: i domini sono poi diventati `*.arenalive.studio`.)
- 2026-10-20: il prodotto si chiama **ArenaLive** (sito arenalive.studio) e la rinomina riguarda anche i nomi tecnici
  (pacchetti `@arenalive/*`, condizione `@arenalive/source`, progetto compose, volumi, database e utente, variabili
  `ARENALIVE_*`, cookie `arenalive_session`, percorsi `/opt|/etc|/var/backups/arenalive`, unità systemd, file di backup,
  `arenalive-agent`, progetti .NET `ArenaLive.Agent.*`, formato `arenalive-grafica`, User-Agent `ArenaLive/<ver>`), perché
  è un cambio di marchio e la produzione si rifà da zero (`admin.arenalive.studio`, cliente SIR `sir.arenalive.studio`,
  stesso server, Let's Encrypt) senza nessun agente installato: non c'è compatibilità da mantenere, e nomi misti
  confonderebbero. I dati della vecchia produzione passano con `scripts/ripristina-produzione.sh` (`docs/infrastruttura.md`).
  Restano come erano, di proposito: l'etichetta HMAC dei codici brevi in `apps/server/src/lib/shortCode.ts` (cambiarla
  invaliderebbe i QR dei link ripristinati); il nome del repository GitHub `SIRRealttime`; i prefissi `sir-`, `--sir-`,
  `data-sir-` di CSS e localStorage (non sono il nome del prodotto); il modello grafico `sir-volley` (è il cliente SIR);
  l'import dei pacchetti grafica `sirrealtime-grafica`.
- 2026-10-20: marchio ArenaLive in `apps/web/public/brand/` (loghi positivo e negativo; icone generate da
  `apps/web/scripts/brand-icons.ts`, `favicon.svg` rimosso), scelto in automatico dalla luminanza dello sfondo come i loghi
  di sistema; il modello `sir-volley` usa il logo negativo e le vecchie immagini «sir real time» sono state tolte
  (`docs/portale.md`, `docs/agente.md`).
- 2026-10-22: il token agente incollato a mano resta come alternativa (riserva se la registrazione non è possibile; servizio
  e `--once` con `config.json` scritto a mano) ma nella finestra sta sotto «Avanzate», chiuso di default, perché la via
  normale è la registrazione online e il campo del token confondeva chi apre l'agente la prima volta
  (`docs/agente.md`, `docs/portale.md`).
- 2026-10-23: certificati dei clienti «on demand» con `ask` al server (`/internal/tls/ask`: 200 solo per gli hostname in
  `tenants.hostnames`) invece di rilanciare `installa-produzione.sh` a ogni nuovo cliente o di un certificato wildcard (che
  richiederebbe la sfida DNS-01 e un plugin del provider DNS); la rotta è difesa rifiutando (404) le richieste con
  intestazioni di inoltro invece di un listener separato, e il limite è fisso a 600 richieste al minuto, perché Caddy
  chiede solo per hostname senza certificato (`docs/infrastruttura.md`, `docs/server.md`).
- 2026-10-23: la pagina live recepisce le modifiche dello Studio con un messaggio WebSocket `config` senza dati (il
  client rilegge la grafica con la solita GET, nessun contenuto sul socket) e con una lettura dopo un ritardo casuale di
  0–3 s, perché migliaia di spettatori non devono chiedere la grafica nello stesso istante; riconnessione e ritorno in
  primo piano rileggono al più una volta al minuto come rete di sicurezza. Al cambio di modello lo Studio chiede se
  applicare anche i blocchi, perché sostituirli di nascosto cancellerebbe la disposizione scelta
  (`docs/server.md`, `docs/portale.md`, `docs/architettura.md`).
