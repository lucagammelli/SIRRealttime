# Architettura

## A cosa serve
Descrive come i pacchetti del monorepo si collegano e quali contratti usano. Il piano completo è in `docs/piano.md`;
qui c'è lo stato attuale del codice. Il portale web è in `apps/web` (`docs/portale.md`).

## Come funziona

### Flusso dei dati
```
DataVolley (.dvw riscritto per intero)
   → agente: legge il file, estrae le righe di scout, calcola il diff, invia con POST /api/ingest (token agente)
   → server: salva le righe in Postgres, ricostruisce il DVW, ricalcola lo stato
   → WebSocket (/ws/public/:token, /ws/admin): stato intero alla connessione, poi patch (differenze) a ogni aggiornamento
   → portale (nginx + SPA React): mostra la partita
```

In produzione nginx (servizio `web`) è l'unico ingresso: serve il portale e inoltra `/api` e `/ws` al server, che resta
su `127.0.0.1`; anche l'agente invia a `<URL del portale>/api/ingest`.

1. L'agente (`docs/agente.md`) legge il file con polling, lo separa con `splitDvwText` (header + righe di scout),
   confronta le righe precedenti con le nuove con `diffScoutLines` (append se le precedenti sono un prefisso, altrimenti
   snapshot), calcola `hashScoutLines` e tiene in coda su disco ciò che il server non ha ancora confermato.
2. Il server (`docs/server.md`) applica la richiesta, ricostruisce il testo con `buildDvwText`, lo legge con `parseDvw`
   e calcola `computeMatchState`. Lo stato è ricalcolato da zero a ogni ingest; ai client va come patch (`PatchMessage`) a chi
   ha lo stato precedente, intero (`StateMessage`) agli altri e a chi chiede `resync`.
3. Il portale (`docs/portale.md`) riceve lo stato via WebSocket, applica i patch (`applyPatch`), con
   `GET /api/public/:token/state` come sonda del link, e lo disegna senza ricalcolare nulla.

Il sistema è **multi-cliente**: ogni dato appartiene a un cliente, ricavato dall'hostname della richiesta (agenti e
registrazioni, partite, link, utenti; una partita live per cliente) e il superadmin sceglie su quale lavorare
(`docs/server.md`).

Oggi esistono agente, server, portale, contratti, parser, statistiche e simulatore; il flusso si prova con l'agente e il
simulatore (`docs/agente.md`) o con i test del server (`apps/server/test/ingest.test.ts`).

### Pacchetti e dipendenze

| Pacchetto | Cartella | Dipende da | Ruolo |
|---|---|---|---|
| `@sir/dvw-parser` | `packages/dvw-parser` | - | legge il file DVW (`parseDvw`, `extractScoutLines`) |
| `@sir/volley-stats` | `packages/volley-stats` | dvw-parser | punteggio e statistiche (`computeMatchState`) |
| `@sir/shared` | `packages/shared` | dvw-parser, volley-stats | contratti: tipi e schemi zod |
| `@sir/server` | `apps/server` | dvw-parser, volley-stats, shared | backend |
| `@sir/agent` | `apps/agent` | dvw-parser, shared | agente Windows (`docs/agente.md`); dev-dependency: dvw-simulator, server, volley-stats (per i test) |
| `@sir/web` | `apps/web` | shared, volley-stats | portale: pagina pubblica `/live/:token` e `/l/:token` (codice breve) e area `/admin` (`docs/portale.md`); dev-dependency: agent, server, dvw-parser, dvw-simulator (solo per la demo) |
| `@sir/carico` | `tools/carico` | dvw-parser, volley-stats, shared | prova di carico dei WebSocket pubblici (`docs/infrastruttura.md`) |
| `@sir/dvw-simulator` | `tools/dvw-simulator` | dvw-parser | genera e "suona" file DVW sintetici; è anche dev-dependency di volley-stats, shared e server (per i test) |

### Contratti di `packages/shared`
Esportati da `packages/shared/src/index.ts` (`admin.ts`, `assets.ts`, `colors.ts`, `ingest.ts`, `messages.ts`, `patch.ts`, `registration.ts`, `tenant.ts`).

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
- `PatchMessageSchema` / `PatchMessage` (`type: 'patch'`, `matchId`, `baseVersion`, `version`, `ops`): le differenze fra
  due stati consecutivi, parte di `ServerMessage`; `ResyncMessageSchema` / `ClientMessageSchema` (client→server:
  `{ type: 'resync' }`, chiede lo stato intero); `LiveSocketQuerySchema` (`?enc=gzip` sull'URL del WebSocket: frame
  binari con il gzip del JSON); `LIVE_FRAME_MAX_DECODED_BYTES` (4 MB: un frame decompresso più grande è scartato);
- `MatchStateSchema`: lo `state` dei messaggi, verificato solo come oggetto (`z.custom<MatchState>`); il portale
  controlla in più i campi che legge (`looksLikeMatchState`, `apps/web/src/lib/messages.ts`);
- `ApiErrorSchema` / `ApiError`: corpo di ogni errore HTTP (`{ error }`).

Aggiornamenti differenziali (`patch.ts`, funzioni pure e deterministiche, senza I/O):

- `diffJson(a, b)` → elenco di operazioni `PatchOp` che trasforma `a` in `b`; `applyPatch(doc, ops)` le applica senza
  modificare `doc` (le parti non toccate sono condivise). Operazioni: `set` (sostituisce un valore o la radice), `del`
  (toglie una chiave di oggetto), `push` (aggiunge in coda a un array), `trunc` (accorcia un array). Applicando
  `diffJson(a, b)` ad `a` si ottiene un valore con lo stesso `JSON.stringify` di `b`;
- `PatchError` (codice `PATCH_INVALID`) se una operazione non combacia con il valore (chiave mancante, indice fuori
  dall'array, tipo sbagliato); limiti dello schema `PatchOpsSchema`: profondità del percorso `PATCH_MAX_DEPTH` (64) e
  numero di operazioni `PATCH_MAX_OPS` (20000); anche `PatchOpSchema`, `PatchPath`, `JsonValue`, `jsonEqual`.

Amministrazione (`admin.ts`):

- `SHARE_TOKEN_PATTERN` (token lungo di almeno 22 caratteri, oppure codice breve di al più 9, anche minuscolo e con il
  trattino a metà), `ShareTokenParamSchema` (il parametro diventa `{ kind: 'token' | 'code', value }`, tipo `ShareAccess`),
  `IdParamSchema`, `PASSWORD_MIN_LENGTH` (12);
- codici brevi dei link pubblici: `SHORT_CODE_LENGTH` (8), `ShortCodeSchema`, `normalizeShortCode` (forma canonica
  maiuscola senza trattino), `formatShortCode` (`K7M2-QX9P`); alfabeto `PAIRING_CODE_ALPHABET` (`docs/server.md`, «Link
  breve e codice»);
- utenti e sessioni: `UserRoleSchema` / `UserRole` (`superadmin` | `admin` | `viewer`), `TenantUserRoleSchema` (`admin` |
  `viewer`: i ruoli assegnabili dall'area riservata), `LoginRequestSchema`, `MeResponseSchema` (con `tenant`, il cliente
  corrente o `null`), `CreateUserRequestSchema`, `UserSummarySchema`;
- agenti: `CreateAgentRequestSchema`, `AgentSummarySchema`, `CreateAgentResponseSchema`;
- richieste di registrazione degli agenti (lato admin): `AgentRegistrationStateSchema` (`pending` | `approved` |
  `rejected` | `consumed`), `AgentRegistrationSummarySchema`;
- link pubblici: `CreateShareTokenRequestSchema`, `ShareTokenSummarySchema` (con `shortCode` e `shortUrl`, `null` se il
  link è revocato), `CreateShareTokenResponseSchema`;
- partite: `MatchSummarySchema` / `MatchSummary`, `MatchDetailSchema` / `MatchDetail` (estende il riepilogo con `lastSeq`,
  `contentHash` e `state`, che è `MatchStateSchema` o `null`); è la risposta di `GET /api/admin/matches/:id`, usata dal
  dettaglio partita del portale.

Auto-registrazione dell'agente (`registration.ts`): `PAIRING_CODE_ALPHABET`, `PAIRING_CODE_LENGTH` (6), `PairingCodeSchema`,
`CreateRegistrationRequestSchema` (`name`), `CreateRegistrationResponseSchema` (`registrationId`, `secret`, `pairingCode`,
`expiresAt`), `RegistrationStatusResponseSchema` (unione su `status`: `pending`, `approved` con `token` e `agentId`,
`consumed`, `rejected`, `expired`). Flusso e regole in `docs/server.md`, pagina di abilitazione in `docs/portale.md`.

Clienti (`tenant.ts`): `DEFAULT_TENANT_SLUG` (`predefinito`), `TENANT_SLUG_PATTERN`, `TenantSlugSchema`,
`TENANT_MAX_HOSTNAMES` (20), `isValidHostname`, `HostnameSchema`, `HostnamesSchema`, `TENANT_CONFIG_VERSION` (1) e i
quattro documenti di configurazione `TenantBrandingSchema`, `TenantLayoutSchema`, `TenantIntermissionsSchema`,
`TenantOverlaysSchema` (strict, con `version`; `TenantOverlaysSchema` per ora senza altri campi), `TenantRefSchema`, `TenantSummarySchema`,
`CreateTenantRequestSchema`, `UpdateTenantRequestSchema`, `SetActiveTenantRequestSchema`. Regole di funzionamento in
`docs/server.md` («Clienti»), pagine in `docs/portale.md`.

Grafica per cliente (`tenant.ts`, `colors.ts`, `assets.ts`): `TenantBrandingSchema` / `TenantBranding` (`displayName`,
`colors` con `primary`, `accent`, `home`, `away`, `background` in `#rrggbb` facoltativi, `logoMain`, `logoMark`,
`sponsorLogo`; `TENANT_CONFIG_VERSION` resta 1 perché ogni campo è facoltativo e `{}` è valido), `BrandColorsSchema`,
`BRANDING_IMAGE_SLOTS`, `defaultBranding`, `resolveBranding`, `publicAssetPath`, `DEFAULT_BRAND_NAME` («SIRRealtime»),
`PublicTenantResponseSchema` (`GET /api/public/tenant`), `BrandingResponseSchema` (`GET`/`PUT /api/admin/branding`).
Immagini (`assets.ts`): `AssetKindSchema` (`logo` | `sponsor`), `AssetMimeSchema`, `ASSET_MAX_BYTES` (2 MB),
`ASSET_MAX_BASE64_LENGTH`, `UploadAssetRequestSchema` (solo `kind` e `data` in base64), `AssetSummarySchema`,
`AssetListResponseSchema`. Colori (`colors.ts`, funzioni pure): `HEX_COLOR_PATTERN`, `HexColorSchema`,
`relativeLuminance`, `contrastRatio`, `textColorOn`, `mixColors`, `ensureContrast`, `MIN_TEXT_CONTRAST` (4,5),
`BRAND_COLOR_KEYS`, `DEFAULT_BRAND_COLORS`, `brandPalette` (variabili CSS chiare e scure), `brandContrastIssues`. Il
portale calcola variabili e avvisi di contrasto con queste funzioni, il server non le duplica. Flusso in
`docs/server.md` («Grafica per cliente») e `docs/portale.md`.

Pagina pubblica a blocchi (`layout.ts`, `configVersion.ts`): `TenantLayoutSchema` / `TenantLayout` = `{ version, tv, tablet,
phone }`, ogni dispositivo un elenco ordinato (al massimo `LAYOUT_MAX_BLOCKS` = 24) di `LayoutBlockSchema`, unione
discriminata chiusa su `type`. Ogni blocco ha `id` (`BlockIdSchema`, unico nell'elenco), `type`, `width` (1-12 su
`LAYOUT_COLUMNS` = 12, solo i valori di `BLOCK_WIDTHS` per quel tipo), `visible`, `collapsed` (solo telefono) e `options`
(`BLOCK_OPTIONS`, uno schema strict per tipo). Tipi (`BLOCK_TYPES`): `scoreboard`, `momentum`, `comparison`, `players`,
`court`, `rotations`, `logo`, `sponsor`, `message`, `qr`, `lastPoint`, `setScores`, `topPlayers`. Opzioni: `logo`
`variant` (`main` | `mark`); `sponsor` `images` (al massimo `SPONSOR_MAX_IMAGES` = 12 id di immagini del cliente) e
`seconds` (3-60, predefinito 8); `message` `text` (testo semplice, al massimo `MESSAGE_MAX_LENGTH` = 280) e `size`
(`normal` | `large`); `qr` `caption` (al massimo `QR_CAPTION_MAX_LENGTH` = 80, predefinito `QR_DEFAULT_CAPTION`);
`topPlayers` `count` (1-`TOP_PLAYERS_MAX` = 10) e `team` (`both` | `home` | `away`). Regole sull'elenco
(`DeviceBlocksSchema`): id unici, un solo `scoreboard`, larghezze ammesse. `{}` vale il predefinito
(`defaultLayout`, `defaultDeviceBlocks`: i sei blocchi di prima con larghezze 12/8/6/4), `resolveLayout` legge un layout
salvato e **un layout non valido o di versione futura vale il predefinito** (quando `TENANT_CONFIG_VERSION` salirà servirà
una migrazione). Inoltre `layoutImageIds` (immagini usate, per i controlli del server), `newBlock` (blocco nuovo con le
opzioni predefinite), `LayoutResponseSchema` (`GET`/`PUT /api/admin/layout`); `PublicTenantResponseSchema` contiene anche
`layout`. `TENANT_CONFIG_VERSION` ora sta in `configVersion.ts`. Server in `docs/server.md` («Pagina pubblica a blocchi»),
editor in `docs/portale.md`, classifica in `docs/statistiche.md`.

Pause della partita (`intermissions.ts`): `TenantIntermissionsSchema` / `TenantIntermissions` = `{ version, timeout,
setBreak, setBreakBySet, matchEnd }`. Tre tipi di pausa (`INTERMISSION_KINDS`: `timeout`, `setBreak`, `matchEnd`, come i
`kind` di `MatchPhase` in `docs/statistiche.md`). Ogni pausa ha `enabled`, `modes` (per `tv`, `tablet`, `phone`:
`fullscreen` o `banner`, `INTERMISSION_MODES`), `delaySeconds` (0-`INTERMISSION_MAX_DELAY_SECONDS` = 60) e `slides`
(al massimo `INTERMISSION_MAX_SLIDES` = 12, id unici). Una pausa attiva ha almeno una diapositiva. Tipi di diapositiva
(`SLIDE_TYPES`): `setSummary`, `finalResult`, `mvp`, `setScores` (senza opzioni) e `sponsor`, `message`, `qr`, `logo`
(le stesse opzioni dei blocchi omonimi, `SLIDE_OPTIONS` da `BLOCK_OPTIONS`); ogni diapositiva ha `seconds` (3-60,
predefinito 8: `SLIDE_MIN_SECONDS`, `SLIDE_MAX_SECONDS`, `SLIDE_DEFAULT_SECONDS`). `setBreakBySet` (chiavi `'1'`-`'4'`,
`SET_BREAK_SETS`) dà a un set una pausa propria che **sostituisce per intero** quella generica `setBreak`, senza fonderla;
il 5° set chiude la partita e usa `matchEnd`. Il ritorno alla partita non è configurabile: avviene alla prima azione.
`{}` vale i predefiniti (`defaultIntermissions`, `defaultIntermission(kind)`): time-out a banda su ogni dispositivo con una
diapositiva sponsor (10 s); fine set a tutto schermo su TV e tablet e a banda sul telefono, ritardo 5 s, con
`setSummary` (12 s) e sponsor (8 s); fine partita a tutto schermo su ogni dispositivo, ritardo 5 s, con `finalResult`,
`mvp`, un messaggio `THANKS_MESSAGE` («Grazie per aver seguito la partita», grande) e sponsor. Funzioni pure:
`resolveIntermissions` (un documento non valido vale i predefiniti), `intermissionFor(config, kind, set?)` (la pausa da
usare, null se spenta o senza diapositive), `allIntermissions`, `intermissionImageIds` (immagini delle diapositive
sponsor, per i controlli del server). `IntermissionsResponseSchema` (`GET`/`PUT /api/admin/intermissions`);
`PublicTenantResponseSchema` contiene anche `intermissions`. Server in `docs/server.md` («Pause della partita»),
schermate ed editor in `docs/portale.md`, fase e riepiloghi in `docs/statistiche.md`.

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
- `packages/shared/src/ingest.ts`, `messages.ts`, `patch.ts`, `admin.ts`, `registration.ts`, `tenant.ts`, `assets.ts`, `colors.ts`, `layout.ts`, `intermissions.ts`, `configVersion.ts`, `index.ts`
- `packages/dvw-parser/src/index.ts`, `packages/volley-stats/src/index.ts`
- `apps/server/src/ingest.ts`, `apps/agent/src/agent.ts`, `apps/web/src/App.tsx`
- `docs/piano.md`, `docs/agente.md`, `docs/server.md`, `docs/portale.md`, `docs/dvw-parser.md`, `docs/statistiche.md`, `docs/simulatore.md`,
  `docs/infrastruttura.md`, `docs/decisioni.md`
