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
- Riga `[3SCOUT]`: codice principale + campi `;` (flag, ora, set, rotazioni, video time, posizioni giocatori).
  Codice: squadra (`*` casa / `a` ospite), numero giocatore, fondamentale (`S R A B D E F`),
  tipo (`H M Q T U N O`), valutazione (`# + ! - / =`), combinazione attacco/chiamata, zona partenza/arrivo/sottozona,
  campi estesi. Codici speciali: `*p`/`ap` punto con punteggio, `*z`/`az` rotazione, `*c`/`ac` cambio,
  `*T`/`aT` timeout, `**Nset` fine set, `*P`/`aP` alzatore in campo.
- Tollerante: righe malformate → evento `unknown` con testo grezzo, mai eccezioni bloccanti.
- Output: `ParsedMatch { meta, teams, players, sets, actions[] }` con `rawLine` e indice per ogni azione.

## 2. Statistiche (`packages/volley-stats`)
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

## Verifica
- Unit test (vitest) su parser (righe normali, speciali, malformate, encoding) e statistiche
  (punteggi/set coerenti con le righe `*p`).
- `tools/dvw-simulator`: scrive una partita sintetica nel tempo riscrivendo il file come DataVolley,
  incluse correzioni di righe passate → verifica append vs snapshot e la convergenza dello stato.
- E2E: `docker compose up` + agente puntato alla cartella del simulatore → la pagina `/live/:token`
  si aggiorna entro ~2 s; staccando la rete il backlog viene recuperato senza duplicati.
- Scansione di sicurezza DAST (HawkScan) sul backend/portale al termine delle modifiche.
- Appena disponibile, test con un vero `.dvw` prodotto da DataVolley sul PC Windows.
