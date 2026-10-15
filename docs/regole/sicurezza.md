# Regole: sicurezza (server e agente)

## Accessi
- Tre tipi di accesso, separati:
  1. **Agente** → `POST /api/ingest` con `Authorization: Bearer <token agente>`. Token generati dall'area admin,
     salvati **solo come hash** (sha256), revocabili, mostrati in chiaro una sola volta.
  2. **Pubblico** → `/api/public/:shareToken/*` e `/ws/public/:shareToken`: sola lettura, token casuale ≥ 128 bit,
     con scadenza e revoca, salvato come hash. Mai dati personali oltre a nome/numero dei giocatori.
  3. **Riservato** → login email/password (argon2id), sessione in cookie `httpOnly`, `Secure`, `SameSite=Lax`;
     ruoli `admin` e `viewer`. Ogni rotta `/api/admin/*` dichiara il ruolo richiesto.
- Nessuna rotta senza una di queste tre protezioni, salvo `/api/health`.

## Input e output
- Ogni body, query, parametro e messaggio WebSocket validato con gli schemi zod di `packages/shared`.
- Limite di dimensione sul body dell'ingest (un file DVW completo compresso con gzip sta sotto 1 MB).
- Rate limit su login, ingest e rotte pubbliche (`@fastify/rate-limit`).
- DB solo via Drizzle con parametri; mai SQL composto con stringhe.
- Header di sicurezza con `@fastify/helmet`; CORS solo per l'origine del portale.
- Errori al client senza stack trace né dettagli interni.

## Segreti
- Solo in `.env` (mai nel repository); `.env.example` elenca tutte le variabili con un commento.
- Agente: token in `config.json` accanto all'eseguibile, file escluso da git; comunicazione solo HTTPS
  (HTTP ammesso solo verso `localhost` in sviluppo; eccezione: con `allowHttpPrivateNetwork: true` nel
  `config.json` dell'agente, HTTP anche verso IPv4 privati 10/8, 172.16/12, 192.168/16, solo per prove in LAN;
  in produzione sempre HTTPS).

## Verifica
- Dopo modifiche a server o portale si esegue la scansione DAST (HawkScan) sul server in esecuzione e si correggono
  i problemi trovati.
