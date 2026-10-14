# Architettura

## A cosa serve
Descrive come i pacchetti del monorepo si collegano e quali contratti usano. Il piano completo è in `docs/piano.md`;
qui c'è lo stato attuale del codice. Il portale web e l'agente non esistono ancora (`apps/agent`, `apps/web`).

## Come funziona

### Flusso dei dati
```
DataVolley (.dvw riscritto per intero)
   → agente: legge il file, estrae le righe di scout, calcola il diff, invia con POST /api/ingest (token agente)
   → server: salva le righe in Postgres, ricostruisce il DVW, ricalcola lo stato
   → WebSocket (/ws/public/:token, /ws/admin): stato intero a ogni aggiornamento
   → portale: mostra la partita
```

1. L'agente separa il file con `splitDvwText` (header + righe di scout), confronta le righe precedenti con le nuove con
   `diffScoutLines` (append se le precedenti sono un prefisso, altrimenti snapshot) e calcola `hashScoutLines`.
2. Il server (`docs/server.md`) applica la richiesta, ricostruisce il testo con `buildDvwText`, lo legge con `parseDvw`
   e calcola `computeMatchState`. Lo stato è ricalcolato da zero a ogni ingest e inviato intero (`StateMessage`).
3. Il portale riceve lo stato via WebSocket o con `GET /api/public/:token/state`.

Oggi esistono server, contratti, parser, statistiche e simulatore; per provare il flusso senza agente si usano i test
del server (`apps/server/test/ingest.test.ts`) e il simulatore (`docs/simulatore.md`).

### Pacchetti e dipendenze

| Pacchetto | Cartella | Dipende da | Ruolo |
|---|---|---|---|
| `@sir/dvw-parser` | `packages/dvw-parser` | - | legge il file DVW (`parseDvw`, `extractScoutLines`) |
| `@sir/volley-stats` | `packages/volley-stats` | dvw-parser | punteggio e statistiche (`computeMatchState`) |
| `@sir/shared` | `packages/shared` | dvw-parser, volley-stats | contratti: tipi e schemi zod |
| `@sir/server` | `apps/server` | dvw-parser, volley-stats, shared | backend |
| `@sir/dvw-simulator` | `tools/dvw-simulator` | dvw-parser | genera e "suona" file DVW sintetici; è anche dev-dependency di volley-stats, shared e server (per i test) |

### Contratti di `packages/shared`
Esportati da `packages/shared/src/index.ts` (`admin.ts`, `ingest.ts`, `messages.ts`).

Ingest (`ingest.ts`):

- costanti: `INGEST_PROTOCOL` (1), `INGEST_MAX_LINES`, `INGEST_MAX_LINE_LENGTH`, `INGEST_MAX_HEADER_LENGTH`,
  `INGEST_MAX_WIRE_BYTES`, `INGEST_MAX_DECODED_BYTES`, `SCOUT_SECTION_MARKER`;
- schemi e tipi: `IngestRequestSchema` / `IngestRequest`, `IngestResponseSchema` / `IngestResponse`,
  `IngestKindSchema` / `IngestKind` (`append` | `snapshot`), `IngestStatusSchema` / `IngestStatus`
  (`ok` | `duplicate` | `needSnapshot`), `ScoutLineSchema`, `MatchKeySchema`, `Sha256HexSchema`, tipo `ScoutDiff`;
- funzioni pure: `diffScoutLines(prev, next)`, `hashScoutLines(lines)` (sha256 di righe unite con `"\n"`, Web Crypto),
  `splitDvwText(text)` → `{ header, scoutLines }`, `buildDvwText(header, scoutLines)` (inverso di `splitDvwText`).

Messaggi (`messages.ts`):

- `StateMessageSchema` / `StateMessage` (`type: 'state'`, `matchId`, `version`, `state`),
  `NoMatchMessageSchema` / `NoMatchMessage`, `ErrorMessageSchema` / `ErrorMessage`,
  `ServerMessageSchema` / `ServerMessage` (unione discriminata su `type`);
- `ApiErrorSchema` / `ApiError`: corpo di ogni errore HTTP (`{ error }`).

Amministrazione (`admin.ts`):

- `SHARE_TOKEN_PATTERN`, `ShareTokenParamSchema`, `IdParamSchema`, `PASSWORD_MIN_LENGTH` (12);
- utenti e sessioni: `UserRoleSchema` / `UserRole`, `LoginRequestSchema`, `MeResponseSchema`, `CreateUserRequestSchema`,
  `UserSummarySchema`;
- agenti: `CreateAgentRequestSchema`, `AgentSummarySchema`, `CreateAgentResponseSchema`;
- link pubblici: `CreateShareTokenRequestSchema`, `ShareTokenSummarySchema`, `CreateShareTokenResponseSchema`;
- partite: `MatchSummarySchema` / `MatchSummary`, `MatchDetail` (con `lastSeq`, `contentHash`, `state`).

Ogni schema ha il tipo omonimo senza `Schema` (`z.infer`). Dettagli d'uso: `docs/server.md`.

### Regole
- **I contratti stanno solo in `packages/shared`**: server, agente e portale importano tipi e schemi da lì, mai definiti
  in copia.
- **I calcoli di punteggio e statistiche stanno solo in `packages/volley-stats`**: server e portale non li duplicano.
- Il server non fida del client: ogni richiesta è validata con lo schema di `shared`.

## Configurazione
Nessuna: l'architettura non ha variabili proprie. Quelle del server sono in `docs/server.md`, la struttura del
monorepo in `docs/infrastruttura.md`.

## Come si usa / si prova
```bash
# --- variabili ---
RADICE="/percorso/del/repository"   # radice del repository o del worktree del job

# --- comandi ---
cd "$RADICE"
pnpm install
pnpm --filter @sir/shared test      # test dei contratti (ingest.test.ts, messages.test.ts)
pnpm --filter @sir/server test      # il flusso completo agente→server→WebSocket con PGlite
```

## Riferimenti
- `packages/shared/src/ingest.ts`, `messages.ts`, `admin.ts`, `index.ts`
- `packages/dvw-parser/src/index.ts`, `packages/volley-stats/src/index.ts`
- `apps/server/src/ingest.ts`
- `docs/piano.md`, `docs/server.md`, `docs/dvw-parser.md`, `docs/statistiche.md`, `docs/simulatore.md`,
  `docs/infrastruttura.md`, `docs/decisioni.md`
