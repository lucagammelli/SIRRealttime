# Agente Windows

## A cosa serve
`apps/agent` (`@sir/agent`, comando `sir-agent`) gira sul PC di DataVolley. Legge il file `.dvw`, che DataVolley riscrive
per intero a ogni azione, ne estrae le righe `[3SCOUT]`, calcola la differenza rispetto a quanto già inviato e la manda
al server con `POST /api/ingest` (token agente, HTTPS). Se la rete manca, i dati restano in una coda su disco e vengono
inviati appena possibile. Il server e il suo protocollo sono in `docs/server.md`; i contratti in `packages/shared`.

## Come funziona

### Lettura del file (`src/watcher.ts`, `src/dvw.ts`)
- **Polling con `fs.stat`** ogni `pollIntervalMs` (1 s): su pennina FAT/USB gli eventi del file system non sono
  affidabili (`docs/decisioni.md`).
- **Quale file**: se `watchPath` è un file, quello; se è una cartella, il `.dvw` con la data di modifica più recente.
  Sono ignorati i nomi che iniziano con `.` o `~` e quelli che non finiscono in `.dvw` (quindi anche `*.tmp`).
- **Stabilità**: il file si legge solo quando dimensione e data di modifica restano uguali per `stableMs` (700 ms).
  Se cambia durante la lettura, si aspetta il poll stabile successivo.
- **Rilettura**: anche senza modifiche il file è riletto ogni 10 s (la data di modifica di FAT32 ha risoluzione di 2 s).
- **File bloccato** da DataVolley (`EBUSY`, `EPERM`, `EACCES`): nuovo tentativo al poll successivo; dopo 10 tentativi
  di fila una riga di avviso nel log.
- **Pennina tolta** (percorso non raggiungibile, cartella senza `.dvw`): niente errore, una riga di avviso
  «file .dvw non disponibile (pennina tolta?): in attesa», poi polling; al ritorno «file .dvw di nuovo disponibile».
  La coda già accumulata continua a essere inviata.

### Anti-troncamento
- Senza la sezione `[3SCOUT]` (o file vuoto) il contenuto **non viene mai inviato**: si aspetta la scrittura successiva.
- Una lettura è «sospetta» se il file non termina con un a capo oppure ha **meno righe scout** dell'ultimo contenuto
  accodato per la stessa partita. Una lettura sospetta è inviata solo dopo una **seconda lettura stabile con byte
  identici** (messaggio «contenuto da confermare con una seconda lettura»). Così un file scritto a metà non cancella
  la partita sul server, mentre un'eliminazione vera di righe passa dopo la conferma.

### Chiave della partita (`deriveMatchKey`)
`matchKey` è composta da data e ora di `[3MATCH]`, dai codici squadra di `[3TEAMS]` (normalizzati, minuscoli) e da un hash
corto di 10 caratteri. Senza data e ora si usa il nome del file (`file_<nome>_<hash>`). **Avvertenza**: se lo scoutman
cambia data, ora o squadre a partita iniziata, la chiave cambia e sul server nasce **un'altra partita**; il link
pubblico fisso (legato a una `matchId`) non la segue, il link «live» (`matchId` nullo, `docs/server.md`) sì.

### Differenze e sincronizzazione (`src/sync.ts`, `planRequests`)
- Senza base (primo invio) o se una riga passata è cambiata: `snapshot` (header + tutte le righe); se le righe
  precedenti sono un prefisso delle nuove: `append` con `fromIndex`. Nessun cambiamento: nessuna richiesta.
- L'header viaggia con lo snapshot e ogni volta che cambia.
- Ogni richiesta ha `seq` crescente per partita (mai decrescente, anche dopo un riavvio) e `contentHash`
  (`hashScoutLines` delle righe dopo la richiesta).
- Oltre `INGEST_MAX_LINES` (5000) righe la richiesta è divisa: uno snapshot lungo diventa snapshot + append.
- Il corpo JSON oltre 4 KB è inviato con `Content-Encoding: gzip` (`src/sender.ts`). Il token va solo
  nell'intestazione `Authorization: Bearer`.

### Coda offline (`src/store.ts`)
- Una partita = un file `<dataDir>/matches/<matchKey>.json` (`MatchRecordSchema`, `version` 1). Campi: `matchKey`,
  `nextSeq` (prossimo `seq`), `base` (header e righe che il server avrà a coda consegnata), `confirmed` (ultima risposta:
  `seq`, `lineCount`, `contentHash`, `at`), `forceSnapshot` (il prossimo cambiamento parte come snapshot), `queue`
  (richieste con `order` globale, consegnate dalla più vecchia), `sourceFile`.
- Scrittura **atomica**: file `.tmp`, `datasync`, `rename`; su `EPERM`/`EBUSY`/`EACCES` (antivirus) fino a 5 nuovi
  tentativi. Un file di stato illeggibile è rinominato `.corrupt` e segnalato nel log.
- **Compattazione**: se la coda di una partita supera 20 messaggi, è sostituita da un solo snapshot del contenuto
  attuale («coda compattata in uno snapshot»).
- All'avvio le code sono riprese dal disco; una partita con coda vuota e ultimo contenuto non confermato dal server
  riparte con uno snapshot.
- **Backoff**: dopo un errore di rete o temporaneo il ritardo parte da 1 s e raddoppia fino a 30 s (con
  variazione casuale); `Retry-After` del server è rispettato (al massimo 60 s). I messaggi restano in coda.
- **Pulizia all'avvio**: il record con coda vuota non aggiornato da più di `retentionDays` (30) giorni è cancellato
  da `dataDir/matches` (`updatedAt`, aggiornato a ogni salvataggio) e segnalato nel log. Una partita con messaggi
  in coda non è mai cancellata.
- **Nuovo tentativo dello snapshot**: dopo un 4xx o un 413 la partita resta con `forceSnapshot` e `retrySnapshotAt`;
  se non arriva nessuna modifica del file, ogni `snapshotRetryMs` (5 minuti) lo snapshot è accodato di nuovo
  («nuovo tentativo dello snapshot rifiutato»).

### Risposte del server (`Agent.handleResponse`, `handleHttpError`)
| Risposta | Comportamento |
|---|---|
| `ok` | richiesta tolta dalla coda, `nextSeq` aggiornato, risposta salvata in `confirmed` |
| `duplicate` | uguale a `ok` se `seq` e `contentHash` coincidono con quelli inviati; altrimenti come `needSnapshot` |
| `needSnapshot` | coda sostituita da uno snapshot con `seq` oltre quello del server («server non allineato: invio uno snapshot»); se `needSnapshot` risponde a uno snapshot, si aspetta la modifica successiva o `snapshotRetryMs` |
| 401 / 403 | «token agente non valido o revocato»: coda conservata, nuovo tentativo ogni 60 s |
| 413 | richiesta scartata, coda svuotata, prossima modifica come snapshot; in più nuovo tentativo dello snapshot ogni `snapshotRetryMs` |
| altri 4xx | richiesta scartata; se era un `append` si accoda subito uno snapshot, se era uno snapshot si riprova alla modifica successiva o dopo `snapshotRetryMs` |
| 408, 429, 5xx, rete assente, risposta non valida | backoff come sopra, dati in coda: «server non raggiungibile: i dati restano in coda» (una volta, poi «server di nuovo raggiungibile») |

### Log (`src/logger.ts`)
- File giornalieri `sir-agent-AAAA-MM-GG.log` (giorno UTC) in `logDir`, formato JSON (pino); oltre 10 MB il file continua in
  `.1`, `.2`…; i file più vecchi di 14 giorni sono cancellati.
- Ogni 60 s una riga `stato`: `file`, `matchKey`, `lines`, `queue`, `lastSuccessAt`, `serverReachable`.
- Il token non compare mai nei log (`REDACT_PATHS`, censurato come `[nascosto]`) e viaggia solo nell'intestazione.
- Messaggi principali: «agente avviato», «partita in lettura», «token agente non valido o revocato»,
  «file .dvw non disponibile (pennina tolta?): in attesa», «server non raggiungibile: i dati restano in coda»,
  «contenuto da confermare con una seconda lettura», «coda ripresa dal disco», «coda compattata in uno snapshot».

## Configurazione
`config.json` (default: accanto all'eseguibile; `--config <file>` per un altro). Campi sconosciuti sono rifiutati. Modello:
`apps/agent/config.example.json`; regole: `apps/agent/src/config.ts` (`AgentConfigFileSchema`, `parseConfig`).

| Campo | Default | Regola |
|---|---|---|
| `watchPath` | obbligatorio | cartella (es. `E:\`) o singolo `.dvw` |
| `serverUrl` | obbligatorio | `https` sempre; `http` solo verso `localhost`, `127.0.0.1`, `[::1]` o, con `allowHttpPrivateNetwork`, verso IPv4 privati; senza credenziali nell'URL |
| `allowHttpPrivateNetwork` | `false` | ammette `http` verso IPv4 letterali privati (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), mai verso nomi host o IP pubblici. **Solo per prove in rete locale; in produzione https.** All'avvio con `http` attivo l'agente scrive un warning («connessione senza cifratura verso `<host>`: usare https in produzione»). Assente in `config.example.json` (il JSON non ammette commenti) |
| `agentToken` | obbligatorio | 20-200 caratteri `A-Za-z0-9_-`, copiato intero dall'area admin |
| `pollIntervalMs` | `1000` | intero 10-60000 |
| `stableMs` | `700` | intero 0-60000 |
| `dataDir` | `data` accanto all'eseguibile | coda e stato; **non dentro `watchPath`** |
| `logDir` | `logs` accanto all'eseguibile | log; **non dentro `watchPath`** (se `watchPath` è un file, vale la sua cartella) |
| `logLevel` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `snapshotRetryMs` | `300000` | intero 1000-86400000; nuovo tentativo dello snapshot rifiutato (4xx/413) anche senza modifiche del file |
| `retentionDays` | `30` | intero 1-3650; giorni dopo i quali il record di una partita ferma con coda vuota è cancellato all'avvio |

I percorsi relativi sono risolti rispetto alla cartella dell'eseguibile (in sviluppo, la cartella corrente). Un BOM
iniziale nel JSON è tollerato. Configurazione non valida: messaggio chiaro e codice di uscita 1.

## Come si usa / si prova

### CLI (`src/cli.ts`)
`sir-agent [--config <file>] [--console] [--once] [--help]`

| Opzione | Effetto |
|---|---|
| `--config <file>` | file di configurazione |
| `--console` | log anche sulla console |
| `--once` | legge una volta (attesa massima `max(30 s, stableMs × 10)`), invia la coda ignorando il backoff e termina |
| `--help` | aiuto |

Codici di uscita di `--once`: `0` tutto inviato, `2` dati rimasti in coda, `3` nessun file `.dvw` letto, `1`
configurazione non valida o errore. Senza `--once` il processo gira finché riceve SIGINT/SIGTERM (uscita 0).

### Installazione su Windows
1. **Token agente**: nell'area admin del server (o con `POST /api/admin/agents`, esempio con `curl` in
   `docs/server.md`) si crea un agente; la risposta contiene `token`, **mostrato una sola volta**. Un agente
   revocato con `DELETE /api/admin/agents/:id` riceve 401.
2. **Build** (su Windows con Node 24, corepack e `pnpm install` già fatto). Lo script
   `apps/agent/scripts/build-exe.ps1` ha le sue variabili in cima (percorsi ricavati dalla posizione dello script,
   `node.exe` dal PATH, opzioni SEA) e di norma non va modificato:

   ```powershell
   # --- variabili ---
   $Repo = "C:\SIRRealtime"   # radice del repository clonato sul PC di build
   $Dest = "C:\SIRAgent"      # cartella di installazione (mai la pennina)

   # --- comandi ---
   powershell -ExecutionPolicy Bypass -File (Join-Path $Repo "apps\agent\scripts\build-exe.ps1")
   if ($LASTEXITCODE -ne 0) { throw "build fallita" } else { Write-Host "Build completata" }
   New-Item -ItemType Directory -Force -Path $Dest | Out-Null
   Copy-Item (Join-Path $Repo "apps\agent\build\sir-agent.exe") $Dest -Force
   Copy-Item (Join-Path $Repo "apps\agent\scripts\installa-servizio.ps1") $Dest -Force
   ```

3. **Configurazione**:

   ```powershell
   # --- variabili ---
   $Dest      = "C:\SIRAgent"                       # cartella di installazione
   $WatchPath = "E:\"                               # pennina o cartella dei .dvw
   $ServerUrl = "https://sir.example.it"            # indirizzo pubblico del server (https)
   $Token     = "<token agente dell'area admin>"    # campo "token" della risposta di /api/admin/agents

   # --- comandi ---
   $Config = [ordered]@{
       watchPath      = $WatchPath
       serverUrl      = $ServerUrl
       agentToken     = $Token
       pollIntervalMs = 1000
       stableMs       = 700
       dataDir        = (Join-Path $Dest "data")
       logDir         = (Join-Path $Dest "logs")
       logLevel       = "info"
   }
   $Json = $Config | ConvertTo-Json
   [System.IO.File]::WriteAllText((Join-Path $Dest "config.json"), $Json)
   & (Join-Path $Dest "sir-agent.exe") --config (Join-Path $Dest "config.json") --once --console
   Write-Host "Codice di uscita: $LASTEXITCODE (0 inviato, 2 dati in coda, 3 nessun .dvw, 1 errore)"
   ```

4. **Servizio** (PowerShell come amministratore): `apps\agent\scripts\installa-servizio.ps1` installa il servizio `SIRAgent`
   con NSSM (avvio automatico, riavvio dopo 5 s, uscita standard in `logs\servizio.log`). Prima di lanciarlo si
   compilano le variabili in cima allo script: `$Nssm` (percorso di `nssm.exe`, da nssm.cc, cartella `win64`),
   `$CartellaAgente` (`C:\SIRAgent`) e, se serve, `$NomeServizio`, `$NomeVisibile`, `$Descrizione`, `$TipoAvvio`,
   `$AzioneUscita`, `$RitardoRiavvio`, `$RuotaFile`, `$RuotaByte`.
   Lo script prova prima la configurazione con `--once`, poi installa e avvia; rilanciarlo reinstalla il servizio.

   ```powershell
   # --- variabili ---
   $Script = "C:\SIRAgent\installa-servizio.ps1"   # copia dello script con le variabili in cima già compilate

   # --- comandi ---
   powershell -ExecutionPolicy Bypass -File $Script
   ```

### Prova su Linux con il simulatore
Serve il server in sviluppo (`docs/server.md`, un terminale) e un token agente. Poi:

```bash
# --- variabili ---
RADICE="/percorso/del/repository"      # radice del repository o del worktree
SERVER="http://127.0.0.1:8090"         # server in sviluppo (http ammesso solo verso localhost)
TOKEN_AGENTE="<token agente>"          # campo "token" della risposta di POST /api/admin/agents
CARTELLA_DVW="/tmp/sir-dvw"            # cartella osservata, dove il simulatore scrive il .dvw
DATI="/tmp/sir-agent/data"             # dataDir (fuori da CARTELLA_DVW)
LOG="/tmp/sir-agent/logs"              # logDir (fuori da CARTELLA_DVW)
CONFIG="/tmp/sir-agent/config.json"    # file di configurazione generato
VELOCITA="20"                          # velocità di riproduzione del simulatore

# --- comandi ---
cd "$RADICE"
pnpm install
pnpm --filter @sir/dvw-simulator build
mkdir -p "$CARTELLA_DVW" "$DATI" "$LOG"
cat > "$CONFIG" <<EOF
{
  "watchPath": "$CARTELLA_DVW",
  "serverUrl": "$SERVER",
  "agentToken": "$TOKEN_AGENTE",
  "dataDir": "$DATI",
  "logDir": "$LOG",
  "logLevel": "info"
}
EOF
node tools/dvw-simulator/dist/cli.js play --out "$CARTELLA_DVW/partita.dvw" --seed 1 --sets 3 \
  --speed "$VELOCITA" --corrections &
pnpm --filter @sir/agent dev --config "$CONFIG"      # sir-agent da sorgente, con log anche sulla console
```

`dev` esegue `tsx --conditions=@sir/source src/main.ts --console` (`apps/agent/package.json`). In alternativa
`pnpm --filter @sir/agent bundle` produce `apps/agent/build/sir-agent.cjs`, avviabile con `node` e le stesse opzioni.
Con `--corrections` il simulatore riscrive righe passate: l'agente invia uno snapshot. Lo stato si legge con
`GET /api/public/:token/state` (`docs/server.md`). Test dell'agente: `pnpm --filter @sir/agent test`.

### Prova in LAN senza https
Per un portale raggiungibile solo in http su rete locale (es. `http://192.168.104.102:8085`), `config.json` su Windows:

```json
{
  "watchPath": "E:\\",
  "serverUrl": "http://192.168.104.102:8085",
  "allowHttpPrivateNetwork": true,
  "agentToken": "<token agente creato nell'area admin del portale>"
}
```

Con un nome host, un IPv6 o un IP pubblico la configurazione è rifiutata; sono accettate anche le forme ottali e decimali dell'IP privato (es. `http://0300.0250.0.1`, `http://3232235777`), perché normalizzate allo stesso indirizzo. Il token non compare mai nei log.

### Da provare su Windows vero
Mai provati fuori da Linux; da verificare:
- build SEA e `postject` (`build-exe.ps1`) con Node 24 per Windows;
- servizio NSSM come LocalSystem: il servizio vede `E:\` (le unità USB appaiono quando l'utente è collegato?);
- codici d'errore reali con la pennina tolta e con il file aperto da DataVolley (`ENOENT`, `EBUSY`, `EPERM`, `EACCES`);
- data di modifica di FAT32 a 2 s: la rilettura ogni 10 s la copre;
- `rename` della coda con antivirus attivo;
- fine riga CRLF dei file DVW reali.

## Riferimenti
- `apps/agent/src/`: `main.ts` (ingresso), `cli.ts` (`runCli`), `config.ts` (`parseConfig`, `loadConfig`),
  `watcher.ts` (`FileWatcher`), `dvw.ts` (`readDvw`, `suspicion`, `deriveMatchKey`), `sync.ts` (`planRequests`),
  `store.ts` (`MatchStore`, `writeFileAtomic`), `sender.ts` (`Sender`, `GZIP_THRESHOLD_BYTES`), `agent.ts` (`Agent`,
  `DEFAULT_TIMING`), `logger.ts` (`RotatingFileStream`, `createLogger`)
- `apps/agent/config.example.json`, `apps/agent/scripts/build-exe.ps1`, `apps/agent/scripts/installa-servizio.ps1`
- test: `apps/agent/test/` (`truncation.test.ts`, `resilience.test.ts`, `e2e.test.ts`, `store.test.ts`, `sync.test.ts`)
- contratti: `packages/shared/src/ingest.ts`; server e token: `docs/server.md`; file DVW: `docs/dvw-parser.md`;
  simulatore: `docs/simulatore.md`; architettura: `docs/architettura.md`; decisioni: `docs/decisioni.md`
