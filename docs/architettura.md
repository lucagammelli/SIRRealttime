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
registrazioni, partite, link, utenti; una partita live per partita del calendario del club, più una tra le non abbinate)
e il superadmin sceglie su quale lavorare (`docs/server.md`). Ogni cliente può scegliere il suo club (campionati comuni
scaricati dai siti ufficiali): il server copia le sue partite dal calendario, dà a ognuna un link breve e abbina il `.dvw`
alla partita giusta; prima del `.dvw` la pagina pubblica mostra la «Prossima partita» (`docs/server.md`, «Club, calendario
e abbinamento»; `docs/portale.md`).

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
Esportati da `packages/shared/src/index.ts` (`admin.ts`, `assets.ts`, `colors.ts`, `ingest.ts`, `intermissions.ts`, `layout.ts`, `messages.ts`, `ourTeam.ts`, `overlays.ts`, `patch.ts`, `registration.ts`, `templates.ts`, `tenant.ts`).

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
  `NoMatchMessageSchema` / `NoMatchMessage`, `ScheduledMessageSchema` / `ScheduledMessage` (`type: 'scheduled'`,
  `fixture`: la «Prossima partita» di un link del calendario prima che arrivi il `.dvw`), `ErrorMessageSchema` / `ErrorMessage`,
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
  corrente o `null`), `CreateUserRequestSchema`, `UpdateUserRequestSchema` (`role`, `password`, `disabled`; almeno un
  campo), `UserSummarySchema` (con `disabled`, predefinito falso);
- credenziali (`packages/shared/src/credentials.ts`): `EmailSchema`, `PasswordSchema`, `PASSWORD_MIN_LENGTH` (12),
  `UserCredentialsSchema` (email e password di un nuovo utente, anche del primo utente di un cliente);
- clienti (`packages/shared/src/tenant.ts`): `TenantSummarySchema` con `userCount` (utenti del cliente, 0 se manca),
  `CreateTenantRequestSchema` con `firstUser` facoltativo (creato `admin` nella stessa transazione), `clampAgentQuota`
  (quota letta riportata in 0-`AGENT_QUOTA_MAX`);
- agenti: `CreateAgentRequestSchema`, `AgentSummarySchema`, `CreateAgentResponseSchema`;
- richieste di registrazione degli agenti (lato admin): `AgentRegistrationStateSchema` (`pending` | `approved` |
  `rejected` | `consumed`), `AgentRegistrationSummarySchema`;
- link pubblici: `CreateShareTokenRequestSchema`, `ShareTokenSummarySchema` (con `shortCode` e `shortUrl`, `null` se il
  link è revocato, e `clientFixtureId`, la partita del calendario a cui appartiene, `null` per i link normali), `CreateShareTokenResponseSchema`;
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
`TenantOverlaysSchema` (strict, con `version`), `TenantRefSchema`, `TenantSummarySchema`,
`CreateTenantRequestSchema`, `UpdateTenantRequestSchema`, `SetActiveTenantRequestSchema`. Regole di funzionamento in
`docs/server.md` («Clienti»), pagine in `docs/portale.md`.

Grafica per cliente (`tenant.ts`, `colors.ts`, `assets.ts`): `TenantBrandingSchema` / `TenantBranding` (`template`
predefinito `standard`, `ourTeam` predefinito `{ code: null, name: null }`, `displayName`,
`colors` con `primary`, `accent`, `home`, `away`, `background` in `#rrggbb` facoltativi, `logoMain`, `logoMark`,
`sponsorLogo`; `TENANT_CONFIG_VERSION` resta 1 perché ogni campo è facoltativo e `{}` è valido), `BrandColorsSchema`,
`BRANDING_IMAGE_SLOTS`, `defaultBranding`, `resolveBranding`, `publicAssetPath`, `DEFAULT_BRAND_NAME` («SIRRealtime»),
`PublicTenantResponseSchema` (`GET /api/public/tenant`), `BrandingResponseSchema` (`GET`/`PUT /api/admin/branding`).
Immagini (`assets.ts`): `AssetKindSchema` (`logo` | `sponsor`), `AssetMimeSchema`, `ASSET_MAX_BYTES` (2 MB),
`ASSET_MAX_BASE64_LENGTH`, `UploadAssetRequestSchema` (solo `kind` e `data` in base64), `AssetSummarySchema`,
`AssetListResponseSchema`. Colori (`colors.ts`, funzioni pure): `HEX_COLOR_PATTERN`, `HexColorSchema`,
`relativeLuminance`, `contrastRatio`, `textColorOn`, `mixColors`, `ensureContrast`, `MIN_TEXT_CONTRAST` (4,5),
`BRAND_COLOR_KEYS`, `DEFAULT_BRAND_COLORS`, `resolveBrandColors(colori, template)` (i colori del cliente sopra quelli del
template, standard: i predefiniti; usata da `webManifest`, `agentBranding` e `brandContrastIssues`), `brandPalette(colori, template)` (variabili CSS chiare e scure; per le squadre
anche `-soft` e `-ink`, la variante per il testo piccolo con 4,5:1 sul pannello scuro più chiaro del modello, per esempio il
rosso `#E30613` su `#151518` ha 3,7:1 e il testo piccolo usa `#eb515a`; inoltre `--sir-our*` e `--sir-opponent*`),
`brandContrastIssues(colori, template)` (nessun avviso per un modello solo scuro). Il
portale calcola variabili e avvisi di contrasto con queste funzioni, il server non le duplica. Flusso in
`docs/server.md` («Grafica per cliente») e `docs/portale.md`.

Modelli grafici (`templates.ts`): elenco chiuso `TEMPLATE_IDS` (`standard`, `sir-volley`), `TemplateIdSchema`,
`DEFAULT_TEMPLATE` (`standard`), `TEMPLATES` (`TemplateDefinition`: etichetta, `forcedTheme` `'dark'` o null, `ourColor`
`home` | `accent`, colori del modello, superfici scure `darkSurface` / `darkInkSurface` / `darkBackground`, immagini
`navbarLogo`, `courtArrows` `evaluation` | `team`) e `templateOf(id)` (modello standard per un
id sconosciuto). `standard` è l'aspetto di prima; `sir-volley` è il modello «SIR VOLLEY» (solo scuro, rosso `#e30613`,
bianco, logo; nessun piè di pagina). Specifiche e originali grafici di Luca: `docs/grafica/`. I token CSS del modello
stanno in `apps/web/src/styles/tokens.css` (`docs/portale.md`).

Nostra squadra (`ourTeam.ts`): `OurTeamSchema` / `OurTeam` (`code` e `name`, testi semplici, `OUR_TEAM_CODE_MAX` 10,
`OUR_TEAM_NAME_MAX` 60, entrambi nullable), `normalizeTeamText` (senza maiuscole e accenti), `ourTeamSide(teams, ourTeam)`
(funzione pura: prima il codice squadra del file, poi il testo contenuto nel nome; nessuna o due corrispondenze danno `null`,
cioè restano i colori casa/ospite) e `teamColorRoles(lato)` (`our` | `opponent` | `home` | `away`).

Pagina pubblica a blocchi (`layout.ts`, `configVersion.ts`): `TenantLayoutSchema` / `TenantLayout` = `{ version, tv, tablet,
phone }`, ogni dispositivo un elenco ordinato (al massimo `LAYOUT_MAX_BLOCKS` = 24) di `LayoutBlockSchema`, unione
discriminata chiusa su `type`. Ogni blocco ha `id` (`BlockIdSchema`, unico nell'elenco), `type`, `width` (1-12 su
`LAYOUT_COLUMNS` = 12, solo i valori di `BLOCK_WIDTHS` per quel tipo), `visible`, `collapsed` (solo telefono) e `options`
(`BLOCK_OPTIONS`, uno schema strict per tipo). Tipi (`BLOCK_TYPES`): `scoreboard`, `momentum`, `comparison`, `players`,
`court`, `rotations`, `logo`, `sponsor`, `message`, `qr`, `lastPoint`, `setScores`, `topPlayers`, `setScorers`, `aces`,
`blocks`, `attack`, `roleDuel`, `teamDuel` (statistiche in stile TV, vedi sotto), `nextMatch` e `standings` («Prossima
partita» e «Classifica» del club, larghezze 4/6/8/12, vedi «Club e calendario»). Opzioni: `logo`
`variant` (`main` | `mark`); `sponsor` `images` (al massimo `SPONSOR_MAX_IMAGES` = 12 id di immagini del cliente) e
`seconds` (3-60, predefinito 8); `message` `text` (testo semplice, al massimo `MESSAGE_MAX_LENGTH` = 280) e `size`
(`normal` | `large`); `qr` `caption` (al massimo `QR_CAPTION_MAX_LENGTH` = 80, predefinito `QR_DEFAULT_CAPTION`);
`topPlayers` `count` (1-`TOP_PLAYERS_MAX` = 10) e `team` (`both` | `home` | `away`). Opzioni dei sei nuovi blocchi (le
stesse delle diapositive omonime): `period` (`STAT_PERIODS`: `set` predefinito, `match`) in tutti; `limit` in `setScorers`
(`SCORERS_MIN` 3 - `SCORERS_MAX` 8, predefinito 5) e in `attack` (`ATTACKERS_MIN` 1 - `ATTACKERS_MAX` 5, predefinito 3);
`role` in `roleDuel` (`DUEL_ROLE_CHOICES`: `rotate` predefinito, cioè un duello per ogni ruolo, oppure
`opposite`/`outside`/`middle`/`setter`/`libero`); `rows` in `teamDuel` (`TEAM_DUEL_KEYS` di volley-stats, chiavi delle righe di `teamDuel`
di `@sir/volley-stats`; vuoto = tutte); `qr` in `nextMatch` (booleano, predefinito `true`); `scope` in `standings`
(`STANDINGS_SCOPES`: `top` le prime `count` righe, `all` tutta, `around` la nostra squadra ±`STANDINGS_AROUND` = 2;
predefinito `around`) e `count` (`STANDINGS_MIN_ROWS` 3 - `STANDINGS_MAX_ROWS` 16, predefinito 5, usato solo da `top`). Regole sull'elenco
(`DeviceBlocksSchema`): id unici, un solo `scoreboard`, larghezze ammesse. `{}` vale il predefinito
(`defaultLayout(template)`, `defaultDeviceBlocks(dispositivo, template)`: per `standard` i sei blocchi di prima con
larghezze 12/8/6/4; per `sir-volley` la pagina del mockup: tabellone, poi andamento, confronto e mappe di campo a un terzo
ciascuno, poi giocatori (8) e rotazioni (4); sul telefono una card per riga), `resolveLayout(documento, template)` legge un
layout salvato, riempie con il predefinito del modello i dispositivi mai salvati e **un layout non valido o di versione
futura vale il predefinito del modello** (quando `TENANT_CONFIG_VERSION` salirà servirà
una migrazione). Inoltre `layoutImageIds` (immagini usate, per i controlli del server), `newBlock` (blocco nuovo con le
opzioni predefinite), `LayoutResponseSchema` (`GET`/`PUT /api/admin/layout`); `PublicTenantResponseSchema` contiene anche
`layout`. `TENANT_CONFIG_VERSION` ora sta in `configVersion.ts`. Server in `docs/server.md` («Pagina pubblica a blocchi»),
editor in `docs/portale.md`, classifica in `docs/statistiche.md`.

Pause della partita (`intermissions.ts`): `TenantIntermissionsSchema` / `TenantIntermissions` = `{ version, timeout,
setBreak, setBreakBySet, matchEnd, milestone }`. Quattro tipi di pausa (`INTERMISSION_KINDS`: `timeout`, `setBreak`,
`matchEnd`, come i `kind` di `MatchPhase` in `docs/statistiche.md`, e `milestone`, «ogni N punti», che non è una fase).
Ogni pausa ha `enabled`, `modes` (per `tv`, `tablet`, `phone`:
`fullscreen` o `banner`, `INTERMISSION_MODES`), `delaySeconds` (0-`INTERMISSION_MAX_DELAY_SECONDS` = 60) e `slides`
(al massimo `INTERMISSION_MAX_SLIDES` = 12, id unici). Una pausa attiva ha almeno una diapositiva. Tipi di diapositiva
(`SLIDE_TYPES`): `setSummary`, `finalResult`, `mvp`, `setScores` (senza opzioni) e `setScorers`, `aces`, `blocks`,
`attack`, `roleDuel`, `teamDuel`, `nextMatch`, `standings`, `sponsor`, `message`, `qr`, `logo` (le stesse opzioni dei blocchi omonimi,
`SLIDE_OPTIONS` da `BLOCK_OPTIONS`; per le statistiche `period` è il set della pausa o la partita); ogni diapositiva ha `seconds` (3-60,
predefinito 8: `SLIDE_MIN_SECONDS`, `SLIDE_MAX_SECONDS`, `SLIDE_DEFAULT_SECONDS`). `setBreakBySet` (chiavi `'1'`-`'4'`,
`SET_BREAK_SETS`) dà a un set una pausa propria che **sostituisce per intero** quella generica `setBreak`, senza fonderla;
il 5° set chiude la partita e usa `matchEnd`. Il ritorno alla partita non è configurabile: avviene alla prima azione.
`{}` vale i predefiniti (`defaultIntermissions`, `defaultIntermission(kind)`): time-out a banda su ogni dispositivo con una
diapositiva sponsor (10 s); fine set a tutto schermo su TV e tablet e a banda sul telefono, ritardo 5 s, con
`setSummary` (12 s), poi `setScorers`, `aces`, `blocks`, `roleDuel` (a rotazione), `teamDuel`, `standings`, `nextMatch`
(10 s ciascuna) e sponsor; fine partita a
tutto schermo su ogni dispositivo, ritardo 5 s, con `finalResult`, `mvp`, `setScorers`, `roleDuel` e `teamDuel` con
`period: 'match'`, `standings`, `nextMatch`, un messaggio `THANKS_MESSAGE` («Grazie per aver seguito la partita», grande) e sponsor.
`milestone` (`MilestoneIntermissionSchema`) ha in più `every` (punti fra due pause, somma dei due punteggi del set:
`MILESTONE_MIN_EVERY` 4 - `MILESTONE_MAX_EVERY` 25, predefinito 8) e `stopBeforeEnd` K (predefinito 5: nessuna pausa se una
squadra è a K punti o meno dal traguardo del set, 25 o 15 al tie-break, calcolato da `@sir/volley-stats`, non nel
contratto); predefiniti: attiva per tutti i clienti, banda su tablet e telefono e tutto schermo su TV, ritardo 3 s,
diapositive `setScorers` e `teamDuel` del set in corso. Funzioni pure:
`resolveIntermissions` (un documento non valido vale i predefiniti), `intermissionFor(config, kind, set?)` (la pausa da
usare, null se spenta o senza diapositive), `allIntermissions`, `intermissionImageIds` (immagini delle diapositive
sponsor, per i controlli del server). `IntermissionsResponseSchema` (`GET`/`PUT /api/admin/intermissions`);
`PublicTenantResponseSchema` contiene anche `intermissions`. Server in `docs/server.md` («Pause della partita»),
schermate ed editor in `docs/portale.md`, fase e riepiloghi in `docs/statistiche.md`.

Avvisi sugli eventi (`overlays.ts`): `TenantOverlaysSchema` / `TenantOverlays` = `{ version, ace, block, run, longRally,
setPoint, matchPoint, tie, lead, timeout, substitution, setEnd, matchEnd }` (`OVERLAY_KINDS`, gli eventi di
`MatchState.events`, `docs/statistiche.md`; strict). Ogni avviso (`Overlay`) ha `enabled`, `text`, `seconds`
(`OVERLAY_MIN_SECONDS` 2 - `OVERLAY_MAX_SECONDS` 8, predefinito 4), `devices` (`tv`, `tablet`, `phone`) e `priority`
(1-10, predefinita quella dell'evento in `volley-stats`). Il testo è semplice (al massimo `OVERLAY_TEXT_MAX` = 80) con i soli
segnaposto di `OVERLAY_PLACEHOLDERS`: `{giocatore}`, `{numero}`, `{squadra}`, `{punteggio}`, `{set}`, `{serie}`,
`{attacchi}`. `overlayTextProblem` (e `OverlayTextSchema`) rifiuta segnaposto sconosciuti, graffe fuori da un segnaposto e i
caratteri `<` e `>`; `fillOverlayText(testo, valori)` li sostituisce (valore mancante: vuoto) e ripulisce gli spazi. `{}` vale
i predefiniti (`defaultOverlays`, `defaultOverlay(kind)`, `defaultOverlayText`, `resolveOverlays`: un documento non valido
vale i predefiniti), per esempio «ACE! {giocatore}», «Muro di {giocatore}», «Break di {serie} punti per {squadra}», «SET
POINT {squadra}», «MATCH POINT {squadra}», «{squadra} vince il {set}° set {punteggio}», «{squadra} vince la partita!».
Time-out spento (la pausa lo mostra già); cambio e scambio lungo non sul telefono. Posizione e dimensione: il documento ha
`position` (`OVERLAY_POSITIONS`: `top`, `center`, `bottom`; predefinito `OVERLAY_DEFAULT_POSITION` `top`) e `size`
(`OVERLAY_SIZES`: `small`, `medium`, `large`; predefinita `medium`) generali; ogni avviso può avere `position` e `size`
propri (facoltativi) e `overlayPlacement(config, overlay)` dà i valori in uso. Un documento salvato prima resta valido. `OverlaysResponseSchema`
(`GET`/`PUT /api/admin/overlays`); `PublicTenantResponseSchema` contiene anche `overlays`. `TENANT_CONFIG_VERSION` resta 1.
Server in `docs/server.md` («Avvisi sugli eventi»), portale ed editor in `docs/portale.md`.

Agente scaricabile (`agentDownload.ts`): `AgentReleaseSchema` (`sir-agent.json`: `version`, `builtAt`, `sha256`,
`nodeVersion` facoltativa), `AgentDownloadInfoSchema` (`GET /api/admin/agent/info`: `available` e, se vero, `version`,
`builtAt`, `bytes`, `sha256`, `fileName`), `AgentBrandingSchema` (`branding.json` versione `AGENT_BRANDING_VERSION` 1: nome e
sei colori `#rrggbb`, strict) con `agentBranding(nome, colori)`, `agentDownloadConfig(serverUrl)` (`config.json` dello zip:
mai un token; `allowHttpPrivateNetwork` solo per `http` verso IPv4 privato), `agentDownloadFileName`, `AGENT_ZIP_FOLDER`,
`AGENT_LOGO_FILES`, `AGENT_LOGO_MAX_BYTES` (2 MB), `AGENT_LOGO_MAX_SIDE` (1024). `isPrivateIPv4` è qui (era nell'agente), perché la
usano sia l'agente sia lo zip. Server in `docs/server.md`, finestra in `docs/agente.md`, pagina in `docs/portale.md`.

Campionati (`leagues.ts`, dati pubblici scaricati dai siti ufficiali, **comuni a tutti i clienti**): `LeagueProviderSchema`
(oggi solo `legavolley`), `LeagueExternalIdSchema` (intero positivo fino a `LEAGUE_MAX_EXTERNAL_ID` 99.999.999),
`LeagueSeasonSchema` (primo anno, 1945-2100), `seasonLabel` (`2025` → `2025/2026`), `CreateLeagueRequestSchema` (strict:
`provider`, `externalId`, `season`; per `legavolley` l'`externalId` è l'`IdCampionato`, diverso a ogni stagione),
`LeagueSyncStateSchema` (`status` `never`/`ok`/`error`, `message`, `at`, `lastSuccessAt`, `running`), `LeagueSummarySchema`
con `LeaguePhaseSchema`, `LeagueListResponseSchema`, `LeagueTeamSchema` (con `logoUrl`), `LeagueFixtureSchema`
(`FixtureStatusSchema` `scheduled`/`played`/`postponed`, `FixtureResultSchema` con `sets` nullo se il fornitore non dà i
parziali, `FixtureTeamRefSchema`), `StandingRowSchema`, `LeagueDetailResponseSchema` e `publicTeamLogoPath`
(`/api/public/team-logos/<id>`). Rotte e scaricamento in `docs/server.md` («Campionati»); test `packages/shared/src/leagues.test.ts`.

Club e calendario (`club.ts`): il club di un cliente (campionati e squadra in ognuno), le sue partite del calendario con un
link ciascuna e l'abbinamento fra `.dvw` e partita. `CLUB_MAX_LEAGUES` (8), `ClubLeagueChoiceSchema`,
`UpdateClubRequestSchema` (strict, campionati senza ripetizioni), `ClubResponseSchema` (nome, logo, `ourTeam`, campionati
scelti, `available`), `ClubLeagueOptionSchema`, `ClubTeamSchema`, `ClubTeamsResponseSchema`, `ClubSyncResponseSchema`;
`suggestedOurTeamName` (pura: dalla squadra scelta ricava il testo «nostra squadra», città senza provincia o ultima parola
del nome); `FixtureLinkSchema` (`auto`/`manual`/`pending`/`none`), `ClubFixtureStateSchema` (`scheduled`/`live`/`finished`/
`postponed`/`pending`/`removed`) e `clubFixtureState` (pura: lo stato dalla partita del calendario e dal `.dvw` abbinato);
`UpcomingFixtureSchema` (ciò che la pagina pubblica mostra prima del `.dvw`: solo dati pubblici del campionato),
`ClubFixtureSchema`, `PendingMatchSchema`, `FixtureCandidateSchema`, `CalendarResponseSchema`,
`LinkMatchFixtureRequestSchema` (`PUT /api/admin/matches/:id/fixture`, `clientFixtureId` nullo = «nessuna (amichevole)»).
Per i blocchi e le diapositive «Prossima partita» e «Classifica»: `ScheduleResponseSchema` (`GET /api/public/tenant/schedule`:
`fixtures`, al massimo `SCHEDULE_MAX_FIXTURES` = 3, e `standings`), `ScheduleFixtureSchema` (dati pubblici della partita più
`live` e `shortUrl`, il link breve del suo QR, nullo se revocato), `ScheduleStandingsSchema` (`leagueName`, `updatedAt`,
`rows`), `ScheduleStandingRowSchema` (posizione, squadra, punti, giocate, vinte, perse, set vinti e persi, `logoUrl`, `ours`
= la squadra del club), `EMPTY_SCHEDULE` (senza club: nessuna partita e nessuna classifica) e `standingsRowsToShow(righe,
scope, count)` (pura: `top` le prime `count`, `all` tutte, `around` la nostra squadra ±2 con la finestra che scorre ai
bordi per tenere sempre 5 righe; senza la nostra squadra, le prime `count`). Rotta in `docs/server.md`, blocchi in
`docs/portale.md` («Blocchi del calendario»). Rotte, abbinamento e tabelle in `docs/server.md` («Club, calendario e abbinamento»), pagine in `docs/portale.md`; test
`packages/shared/src/club.test.ts`.

Profilo del club, partite del cliente e loghi (`club.ts`, lavoro «ruoli-calendario»; rotte e canale in `docs/server.md`,
pagine in `docs/portale.md`): `ClubProfileSchema` (`series` fino a `CLUB_SERIES_MAX` = 60, `coverage`
`ClubCoverageSchema` = `homeAndAway` predefinita o `homeOnly`, `teamLogos` `TeamLogosModeSchema` = `all` predefinita,
`ours`, `none`) e `resolveClubProfile` (pura, i campi mancanti o un documento non valido tornano ai predefiniti),
`UpdateClubProfileRequestSchema` (`displayName`, `logoMark`, `ourTeam`, `profile`; `PUT /api/admin/club/profile`);
partite: `FixtureOriginSchema` (`league`/`manual`), `ManualFixtureKindSchema` (`friendly`/`cup`/`other`) e
`MANUAL_FIXTURE_LABEL`, `FixtureBroadcastSchema` (`auto`/`on`/`off`), `isFixtureBroadcast` (pura: nascosta mai; altrimenti
la scelta della partita, con `auto` la copertura), `ManualFixtureRequestSchema`, `CreatedFixtureResponseSchema`,
`FixtureSettingsRequestSchema` (`broadcast`, `hidden`, `ourLogo`, `opponentLogo`, almeno un campo), e in `ClubFixtureSchema`
i campi `origin`, `kind`, `broadcast`, `broadcasted`, `hidden`, `logos`; loghi: `chooseTeamLogo` (pura: logo della partita
→ logo del profilo, solo per la nostra squadra → logo pubblico della Lega → nessuno), `teamLogoShown`, `shownTeamLogo`
(l'impostazione `teamLogos` decide se mostrarlo) e `matchTeamLogos` (i loghi dei due lati del `.dvw`: il lato nostro è la
«nostra squadra» riconosciuta nel file, altrimenti il lato del club nel calendario; ignoto: nessun logo). `StateMessage` ha
il campo facoltativo `logos` (`TeamLogoPairSchema`, `home` e `away`).

Validità e quota degli agenti, canale, manifest: `admin.ts` ha `AgentSummary.expiresAt`, `AgentValidityRequestSchema`
(`expiresAt` nulla = senza scadenza; corpo di `approve` e di `PATCH /api/admin/agents/:id`), `AgentQuotaResponseSchema`
(`quota`, `used`), `agentActive` (pura); `CreateShareTokenRequestSchema` con `matchId` nullo = canale del club;
`tenant.ts` ha `AgentQuotaSchema` (0-`AGENT_QUOTA_MAX` = 100, `DEFAULT_AGENT_QUOTA` = 1) in `TenantSummary`,
`CreateTenantRequest` e `UpdateTenantRequest`; `leagues.ts` ha `plan` in `LeagueSummary`; `registration.ts` ha
`AGENT_EXPIRED_ERROR` («Registrazione scaduta: registrati di nuovo», il testo del 401 `AGENT_EXPIRED`); `manifest.ts` ha
`webManifest` e `DEFAULT_MANIFEST_ICONS` (manifest dell'app del cliente).

Ogni schema ha il tipo omonimo senza `Schema` (`z.infer`). Dettagli d'uso: `docs/server.md`.

**Schemi per l'agente C#**: l'agente in C# (`apps/agent-dotnet`, `docs/agente.md`) non può importare gli schemi zod, quindi
`packages/shared/scripts/agent-schemas.ts` elenca quelli che lo riguardano (ingest, registrazione, errore API, grafica
dell'agente) e `pnpm --filter @sir/shared schemi:agente` (`genera-schemi-agente.ts`) li scrive come JSON Schema in
`apps/agent-dotnet/schemas/`, con `agent-constants.json`. Sono file generati, da non modificare; `agent-schemas.test.ts`
fallisce se non sono aggiornati. Chi cambia quei contratti rigenera gli schemi e ricostruisce l'agente C#.

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
pnpm --filter @sir/shared test      # test dei contratti (ingest.test.ts, messages.test.ts, agent-schemas.test.ts)
pnpm --filter @sir/shared schemi:agente   # rigenera gli schemi JSON dell'agente C#
pnpm --filter @sir/server test      # il flusso completo agente→server→WebSocket con PGlite
```

## Riferimenti
- `packages/shared/src/ingest.ts`, `messages.ts`, `patch.ts`, `admin.ts`, `registration.ts`, `tenant.ts`, `assets.ts`, `colors.ts`, `layout.ts`, `intermissions.ts`, `overlays.ts`, `agentDownload.ts`, `configVersion.ts`, `templates.ts`, `ourTeam.ts`, `leagues.ts`, `club.ts`, `manifest.ts`, `index.ts`
- `packages/dvw-parser/src/index.ts`, `packages/volley-stats/src/index.ts`
- `apps/server/src/ingest.ts`, `apps/agent/src/agent.ts`, `apps/web/src/App.tsx`
- `docs/piano.md`, `docs/agente.md`, `docs/server.md`, `docs/portale.md`, `docs/dvw-parser.md`, `docs/statistiche.md`, `docs/simulatore.md`,
  `docs/infrastruttura.md`, `docs/decisioni.md`
