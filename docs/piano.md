# SIRRealtime – Piano di progetto

## Context
DataVolley 4 (Windows) produce in tempo reale, durante la partita, un file di scout `.dvw` su una pennina USB locale.
Vogliamo leggerlo in tempo reale, trasmettere i dati a un backend e pubblicarli su un portale web con grafici
accattivanti: punteggio live, statistiche giocatori, andamento partita, grafici di campo.
Il repository è vuoto: si costruisce tutto qui (agente locale + backend + portale).

Decisioni prese:
- PC DataVolley: **Windows** → agente locale Windows (eseguibile + servizio).
- Stack: **Node.js / TypeScript** ovunque.
- **Una partita live per volta** (il modello dati comunque usa `matchId` per lo storico).
- Accesso: **pagina pubblica raggiungibile con un token di condivisione** + **area riservata con login**.
- Hosting: da decidere → sviluppo con **Docker Compose**, deploy-agnostico.
- Nessun file `.dvw` di esempio → si parte dalla specifica del formato e si crea un generatore di file di test.

## Architettura

```
[DataVolley] --scrive--> E:\...\partita.dvw (USB)
      │
[Agente Windows]  watch (polling) → parse → diff → coda offline → HTTPS POST /ingest (token agente)
      │
[Backend Node]    Fastify + WebSocket, Postgres; ricalcola stato/statistiche; push ai client
      │
[Portale React]   /live/:shareToken (pubblico)   /admin (login)
```

Monorepo **pnpm workspaces**:
- `packages/dvw-parser` – parser DVW puro (nessun I/O), condiviso.
- `packages/volley-stats` – dalle azioni scout calcola punteggio, rotazioni, statistiche, momentum, mappe zone.
- `packages/shared` – tipi/DTO e schemi zod dei messaggi agente↔server↔web.
- `apps/agent` – agente locale Windows.
- `apps/server` – backend API + WebSocket.
- `apps/web` – portale React.
- `tools/dvw-simulator` – genera e "riproduce" un `.dvw` progressivamente per simulare DataVolley.

## 1. Parser DVW (`packages/dvw-parser`)
- File testo a sezioni: `[3DATAVOLLEYSCOUT]`, `[3MATCH]`, `[3TEAMS]`, `[3MORE]`, `[3SET]`,
  `[3PLAYERS-H]`, `[3PLAYERS-V]`, `[3ATTACKCOMBINATION]`, `[3SETTERCALL]`, `[3SCOUT]`.
- Decodifica con `iconv-lite` (Windows‑1252/latin1, fallback UTF‑8).
- Riga `[3SCOUT]`: codice principale + campi `;` nel layout DV4 (flag e fasi, coordinate, ora, set, posizione dei
  palleggiatori, file e tempo video, giocatori di casa e ospiti in posizione 1-6; dettaglio in `docs/dvw-parser.md`).
  Codice: squadra (`*` casa / `a` ospite), numero giocatore, fondamentale (`S R A B D E F`),
  tipo (`H M Q T U N O`), valutazione (`# + ! - / =`), combinazione attacco/chiamata, zona partenza/arrivo/sottozona,
  campi estesi. Codici speciali: `*p`/`ap` punto con punteggio, `*z`/`az` rotazione, `*c`/`ac` cambio,
  `*T`/`aT` timeout, `**Nset` fine set, `*P`/`aP` alzatore in campo.
- Tollerante: righe malformate → evento `unknown` con testo grezzo, mai eccezioni bloccanti.
- Output: `ParsedMatch { meta, teams, players, sets, actions[] }` con `rawLine` e indice per ogni azione.

## 2. Statistiche (`packages/volley-stats`)
Dettaglio e regole di calcolo: `docs/statistiche.md`.
Funzioni pure `computeMatchState(parsed)`:
- Punteggio live per set, set vinti, servizio, rotazioni correnti, timeout/cambi usati.
- Statistiche per giocatore e squadra: battuta (ace/errori), ricezione (positiva/perfetta %), attacco
  (kill/errori/murati, efficienza), muro, difesa.
- Andamento: serie punteggio punto per punto, break point vs side‑out, parziali/strisce.
- Mappe di campo: conteggi per zona partenza→arrivo per attacco e battuta.

## 3. Agente locale Windows (`apps/agent`)
- Config `config.json` accanto all'exe: cartella/file da monitorare (es. `E:\`), URL server, token agente,
  intervallo polling.
- Monitoraggio con `chokidar` in **polling** (affidabile su USB/FAT), sceglie il `.dvw` modificato più di recente.
- DataVolley **riscrive l'intero file**: l'agente rilegge tutto, attende stabilità (dimensione/mtime invariati
  ~500 ms, retry se file bloccato o troncato), poi parsa.
- **Diff**: confronta le righe `[3SCOUT]` con l'ultimo invio. Prefisso invariato → invia solo le righe nuove
  (`append`); righe precedenti modificate dallo scoutman → invia `snapshot` completo. Ogni messaggio ha
  `seq` crescente + hash del contenuto → ingest idempotente.
- **Coda offline** su file locale: se la rete cade i messaggi restano in coda e vengono reinviati in ordine.
- Gestione rimozione/reinserimento pennina senza crash; log su file ruotato.
- Distribuzione: Node SEA (single executable) → `sir-agent.exe`; installazione come servizio con NSSM o
  `node-windows`, più modalità console per test.

## 4. Backend (`apps/server`)
- Fastify + `@fastify/websocket`, Postgres con Drizzle ORM, validazione zod.
- Tabelle: `users`, `agents` (hash token), `matches`, `scout_lines` (testo + indice), `share_tokens`
  (token, match o "partita live corrente", scadenza, revoca).
- `POST /api/ingest` (Bearer token agente): applica append/snapshot, ricalcola con `volley-stats`, salva,
  invia via WebSocket lo stato aggiornato ai client della partita.
- Auth riservata: login email/password (argon2) con cookie di sessione httpOnly; ruoli `admin`/`viewer`.
- Pubblico: `GET /api/public/:shareToken/state` + WS `/ws/public/:shareToken`, sola lettura, rate limit.
- Admin API: gestione partite, token agente, token di condivisione (crea/revoca/copia link).

## 5. Portale (`apps/web`)
- React + Vite + TypeScript, Apache ECharts per i grafici, SVG custom per il campo, Tailwind per lo stile.
- `/live/:shareToken` – pagina pubblica pensata anche per maxischermo/mobile:
  tabellone punteggio live, andamento punteggio, statistiche squadra/giocatori, mappe di campo,
  animazione ad ogni punto.
- `/admin` – login, partita live e storico, gestione token agente e link pubblici.
- Aggiornamento via WebSocket con riconnessione automatica e stato completo al (ri)collegamento.

## 6. Infrastruttura
- `docker-compose.yml`: postgres, server, web (nginx per build statica + proxy `/api` e `/ws`).
- `.env.example`, script `pnpm dev` che avvia tutto, migrazioni Drizzle, seed utente admin.
- Deploy definitivo rimandato (il compose è portabile su VPS o cloud).

## Fasi di sviluppo
1. Scaffold monorepo, lint/format, vitest, CI base.
2. Parser DVW + generatore/simulatore di file sintetici + test.
3. `volley-stats` + test.
4. Backend ingest + DB + WebSocket + auth.
5. Agente Windows (watch, diff, coda offline, pacchetto exe).
6. Portale: pagina live pubblica, poi area admin.
7. Test end‑to‑end con simulatore; poi validazione su un vero file DataVolley appena disponibile.

## Fase Multi-cliente (dal 2026-10-15)
Più società sportive (clienti) sulla stessa installazione, con dati separati e un superadmin sopra; il cliente si ricava
dall'hostname (`docs/server.md`, `docs/decisioni.md`). Lavori, uno per job, in quest'ordine:

1. `clienti-base` (**fatto**): tabella `tenants`, `tenant_id` su tutti i dati, ruolo superadmin, pagina «Clienti» e
   una partita live per cliente. Il selettore del cliente iniziale è stato sostituito (2026-10-17, job
   `simulatore-partita`) da «Entra nel cliente» / «Esci dal cliente»; il login vale da qualunque hostname.
2. `scalabilita` (punti 1-5 **fatti**, 6 da fare solo se servirà): migliaia di spettatori. (1) aggiornamenti
   differenziali sul WebSocket con stato intero di riserva e `resync`; (2) compressione gzip fatta una volta per
   messaggio; (3) limiti adatti al pubblico in palestra; (4) riconnessioni senza valanghe; (5) cache di link e hostname,
   nginx per molte connessioni e prova di carico (`tools/carico`, un server 2 vCPU/2 GB regge circa 5000 spettatori,
   `docs/infrastruttura.md`); (6) più copie del server con Postgres LISTEN/NOTIFY (`StatePublisher`), solo se servirà.
   Prima degli altri perché cambia il protocollo del WebSocket.
3. `clienti-grafica` (**fatto**): colori, nome e loghi (orizzontale, quadrato, sponsor) per hostname, caricamento
   immagini controllato (2 MB, 4096 px, 50 MB per cliente, SVG a lista di elementi ammessi), pagina «Grafica»
   (`docs/server.md`, `docs/portale.md`).
4. `link-brevi-qr` (**fatto**): codice di condivisione breve (8 caratteri, `/l/<codice>`) derivato con HMAC da
   `SHARE_CODE_SECRET`, limite globale dei codici sbagliati, log di nginx mascherati e QR scaricabile (PNG e SVG, con
   il logo del cliente) generato nel browser (`docs/server.md`, `docs/portale.md`).
5. `portale-adattivo` (**fatto**): impaginazioni TV 16:9 con rotazione, tablet e smartphone, grafica più curata
   (`docs/portale.md`); da provare su dispositivi veri.
6. `layout-blocchi` (**fatto**): editor «Pagina pubblica» a blocchi per TV, tablet e telefono (13 tipi, larghezze su 12
   colonne, anteprima, `GET`/`PUT /api/admin/layout`); `docs/portale.md`, `docs/server.md`, `docs/architettura.md`.
7. `pause-partita` (**fatto**): schermate di time-out, fine set e fine partita con riepilogo, MVP e sponsor, a tutto
   schermo o a banda per dispositivo; pausa propria per i set 1-4, pagina «Pause» (già «Pause e sponsor»), `GET`/`PUT
   /api/admin/intermissions`, fase della partita in `volley-stats` (`docs/statistiche.md`, `docs/architettura.md`,
   `docs/server.md`, `docs/portale.md`).
8. `avvisi-eventi` (**fatto**): messaggi rapidi sopra la pagina per 12 eventi (ace, muro punto, break, scambio lungo, set
   point, match point, pareggio, sorpasso, time-out, cambio, fine set, fine partita), con testo a segnaposto, durata,
   dispositivi e priorità per cliente; eventi calcolati in `volley-stats`, pagina «Avvisi», `GET`/`PUT
   /api/admin/overlays` (`docs/statistiche.md`, `docs/architettura.md`, `docs/server.md`, `docs/portale.md`).
9. `agente-scaricabile` (**fatto**): `sir-agent.exe` costruito da Linux (`scripts/costruisci-agente.sh`) e scaricabile
   dalla pagina «Agenti» come zip per cliente, con `config.json` del cliente (senza token), `branding.json` e logo che la
   finestra dell'agente mostra (`docs/server.md`, «Agente scaricabile»; `docs/agente.md`, `docs/portale.md`,
   `docs/infrastruttura.md`, `docs/architettura.md`); da provare su Windows.
10. `template-sir-volley` (**fatto**, 2026-10-16): primo modello grafico (template) scelto dal cliente nella pagina
    «Grafica» («Modello grafico»): SIR VOLLEY (dal job `wizard-temi`, 2026-10-18, non più pubblico ma tema personalizzato
    assegnato dal superadmin; ai clienti si offrono quattro modelli), tema scuro forzato, rosso e bianco, font Google Sans Code self-hosted, logo
    SIR Real Time, pagina predefinita come il mockup (specifiche e originali in
    `docs/grafica/`), «Nostra squadra» che segue i colori del cliente e breakpoint telefono/tablet/desktop per tutti i
    modelli (`docs/portale.md`, `docs/architettura.md`, `docs/server.md`); da provare su dispositivi veri.
11. `diapositive-tv` (**fatto**, 2026-10-16): sei viste statistiche in stile TV (parziale e marcatori, ace, muri, attacco,
    sfida per ruolo, squadre a confronto) come diapositive delle pause e come blocchi della pagina, nuova pausa «ogni N
    punti» (attiva di default, non vicino al traguardo del set) e nuovi predefiniti di fine set e fine partita
    (`docs/portale.md`, `docs/architettura.md`, `docs/server.md`, `docs/statistiche.md`); da provare su una TV vera.

**Fase Multi-cliente completata** (2026-10-16): tutti i lavori sono fatti.

Piano completo e scelte di Luca nel piano approvato della fase.

## Campionati (dal 2026-10-16)
Calendario, classifica, squadre e loghi dei campionati ufficiali, scaricati dai siti della Lega e comuni a tutti i clienti
(`docs/server.md`, «Campionati»; `docs/architettura.md`). Lavori, uno per job, in quest'ordine:

1. `campionati-lega` (**fatto**, 2026-10-16): connettore della Lega Pallavolo Serie A (`www.legavolley.it`): contratti in
   `packages/shared/src/leagues.ts`, tabelle comuni a tutti i clienti, lettore HTML nostro, scaricamento educato,
   aggiornamento con lease, pianificazione notturna e nei giorni di partita, rotte per il superadmin
   (`/api/admin/leagues`), loghi `GET /api/public/team-logos/:id`. Provato sul campionato 974 (22 giornate, 132 partite,
   12 squadre, 12 loghi).
2. `cliente-club` (**fatto**, 2026-10-16): pagina «Club» (logo, nome, campionato e squadra del cliente, da cui «nostra
   squadra»), pagina «Calendario» con link breve e QR per ogni partita, abbinamento automatico del `.dvw` alla partita del
   calendario (con conferma dell'admin se dubbio), pagina pubblica «Prossima partita» prima della gara; una live per partita
   del calendario (`docs/server.md`, «Club, calendario e abbinamento»; `docs/portale.md`). Provato sulla SuperLega 2026/27
   (999), Perugia: 22 partite con link. Limiti noti: le partite non abbinate si spengono a vicenda; revocando il link di una
   partita non se ne crea uno nuovo.
3. `blocchi-calendario` (**fatto**, 2026-10-16): blocchi della pagina e diapositive delle pause «Prossima partita» (con QR
   del link della partita) e «Classifica» (prime righe, tutta, intorno alla nostra squadra), rotta pubblica
   `GET /api/public/tenant/schedule` (`docs/server.md`; `docs/portale.md`, «Blocchi del calendario»). Limiti noti:
   «Prossima partita» non è nel layout TV predefinito del tema personalizzato `sir-volley` (griglia piena); flag live in ritardo fino a 60 s;
   la partita senza orario non si vede.

**Fase «Campionati» completata** (2026-10-16) con la Lega Pallavolo Serie A. Passo futuro: il connettore FIPAV (altri
campionati), con lo stesso schema di dati comuni a tutti i clienti.

Punto aperto: l'uso dei marchi (loghi) va chiarito con la Lega e con i club. L'`IdCampionato` cambia ogni stagione
(SuperLega 2025/26 = 974, 2026/27 = 999): a ogni stagione il campionato si aggiunge di nuovo.

## Area riservata: usabilità (dal 2026-10-17)
1. `admin-ux` (**fatto**, 2026-10-17): font Inter in tutta l'area riservata, anteprime sempre visibili con schermo intero
   (Grafica, Pagina pubblica, Pause, Avvisi), «Pause e sponsor» rinominata «Pause», avvisi con posizione e dimensione,
   nomi di «Prossima partita» nei colori delle squadre, app installabile (PWA), suggerimento di schermo intero e script
   kiosk per le TV (`docs/portale.md`, `docs/architettura.md`, `docs/infrastruttura.md`). Da provare su dispositivi veri.
2. `studio-grafico` (**fatto**, 2026-10-17): le quattro pagine Grafica, Pagina pubblica, Pause e Avvisi diventano le
   sezioni di un solo «Studio grafico» (`/admin/studio/:sezione`): impostazioni in schede brevi, anteprima grande
   sempre visibile con dispositivo e scena, salvataggio per sezione, configurazione guidata al primo accesso
   (`docs/portale.md`). Da provare su dispositivi veri.
3. `ruoli-calendario` (**fatto**, 2026-10-17): ruoli di sola lettura (il `viewer` legge club, calendario, agenti, link e
   grafica), profilo del club (serie, copertura «Solo partite in casa», loghi delle squadre), partite aggiunte a mano e
   «Trasmessa»/«Non trasmessa», loghi per partita, canale «tutte le partite del calendario», validità e quota degli
   agenti, pagina «Campionati» del superadmin, manifest dell'app per cliente (`docs/server.md`, `docs/portale.md`,
   `docs/architettura.md`, `docs/agente.md`).
4. `punti-in-sequenza` (**fatto**, 2026-10-17): più punti in un solo aggiornamento sono mostrati uno alla volta nel
   portale (600 ms, al massimo 5, salto alla fine oltre 3 s e con movimento ridotto), attesa massima di 2 s
   nell'agente, colori mancanti dell'agente dal template (`docs/portale.md`, `docs/statistiche.md`, `docs/agente.md`,
   `docs/architettura.md`, `docs/server.md`).
5. `agente-csharp` (**fatto** nel codice, 2026-10-17, **da provare su Windows da Luca**): agente riscritto in C# .NET 10 (`apps/agent-dotnet`,
   exe unico, servizio senza NSSM, `scripts/costruisci-agente-dotnet.sh`); il portale scarica ancora l'agente Node finché
   il C# non è provato; firma del codice ancora da fare (`docs/agente.md`, `docs/infrastruttura.md`, `docs/architettura.md`).
6. `utenti-clienti` (**fatto**, 2026-10-17): pagina «Utenti» completa (cambio ruolo, reimposta password, disattiva e
   riattiva, elimina) con ruoli «Lettura e scrittura» e «Sola lettura», almeno un admin attivo per cliente, sessioni
   chiuse ai cambi; pagina «Clienti» con numero di utenti, «Utenti» e primo utente alla creazione (`docs/server.md`,
   `docs/portale.md`, `docs/architettura.md`).
7. `simulatore-partita` (**fatto**, 2026-10-17): menu a gruppi «Partite» e «Pagina pubblica», superadmin solo dentro un
   cliente («Entra nel cliente», barra gialla, 409 `TENANT_REQUIRED`), link del calendario creati da soli, «Link
   pubblici» con la partita live e le prossime trasmesse; pagina «Simulazione» (`/admin/simulazione`, solo admin): il server gioca
   una partita casuale o un file `.dvw` caricato nella stessa pipeline dell'ingest, con tempi a durata o a velocità,
   su un link a parte con QR e l'etichetta «Simulazione»; una per cliente, 5 nel server, cancellata 6 ore dopo la fine
   (`docs/server.md`, `docs/portale.md`, `docs/simulatore.md`, `docs/architettura.md`).
8. `date-modificabili` (**fatto**, 2026-10-17): data e ora di ogni partita del calendario modificabili a mano («Cambia data e
   ora», «Torna alla data ufficiale»), tenute accanto a quella ufficiale che la sincronizzazione continua ad aggiornare;
   avviso «La Lega ha spostato la partita»; ora di Roma ovunque nel calendario (`docs/server.md`, `docs/portale.md`,
   `docs/architettura.md`).
9. `email-utenti` (**fatto**, 2026-10-17): posta nel portale (pagina «Posta» del superadmin, password SMTP cifrata con
   `SETTINGS_ENCRYPTION_KEY`), utenti invitati senza password («Crea e invita», link di 72 ore, «Invia di nuovo», «Annulla
   invito»), «Password dimenticata?» con link di un'ora, «Link per nuova password» da copiare quando manca la posta,
   primo utente del cliente invitabile da «Clienti» (`docs/server.md`, `docs/portale.md`, `docs/architettura.md`,
   `docs/infrastruttura.md`). Da provare con un vero server di posta.
10. `primo-accesso` (**fatto**, 2026-10-17): serie scelte da un catalogo scoperto dal sito della Lega (SuperLega, A2, A3 con
   due gironi), cambio di stagione notturno, procedura guidata di 5 passi al primo accesso dell'admin
   (`tenants.onboarded_at`, migrazione `0012`) al posto dell'apertura automatica dello Studio (`docs/server.md`,
   `docs/portale.md`, `docs/architettura.md`).
11. `statistiche-visite` (**fatto**, 2026-10-17): statistiche delle visite alla pagina pubblica senza dati personali
   (messaggio `hello`, tabelle `page_views`, `viewer_peaks`, `view_daily`, migrazione `0013`), pagina «Statistiche» con
   «Adesso», periodo, partite con curva, link e QR, dispositivi ed esportazione CSV (`docs/server.md`, `docs/portale.md`,
   `docs/architettura.md`).
12. `wizard-temi` (**fatto**, 2026-10-18): quattro modelli grafici per tutti i clienti (Standard, Chiaro e pulito, Scuro
   sportivo, Alto contrasto per TV) nella procedura guidata e nello Studio; SIR VOLLEY diventa tema personalizzato (JSON in
   `packages/shared/src/themes/`, CSS generato con `pnpm --filter @sir/web themes`) assegnato dal superadmin, con 403 del
   server per gli altri; avviso «La pagina non si è caricata» con ricarica automatica una volta; «Apri lo Studio grafico»
   nel passo finale (`docs/portale.md`, `docs/architettura.md`, `docs/server.md`).
**Agente: da rifare in seguito** (decisione di Luca, 2026-10-15): riscrittura in C# (.NET) più strutturata, senza
PowerShell a runtime; firma del codice con un certificato e informazioni di versione nell'exe, perché oggi Windows lo
mostra con «autore sconosciuto».

## Verifica
- Unit test (vitest) su parser (righe normali, speciali, malformate, encoding) e statistiche
  (punteggi/set coerenti con le righe `*p`).
- `tools/dvw-simulator`: scrive una partita sintetica nel tempo riscrivendo il file come DataVolley,
  incluse correzioni di righe passate → verifica append vs snapshot e la convergenza dello stato.
- E2E: `docker compose up` + agente puntato alla cartella del simulatore → la pagina `/live/:token`
  si aggiorna entro ~2 s; staccando la rete il backlog viene recuperato senza duplicati.
- Scansione di sicurezza DAST (HawkScan) sul backend/portale al termine delle modifiche.
- Appena disponibile, test con un vero `.dvw` prodotto da DataVolley sul PC Windows.
