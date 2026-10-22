# Agente Windows

## A cosa serve
`apps/agent` (`@arenalive/agent`, comando `arenalive-agent`) gira sul PC di DataVolley. Legge il file `.dvw`, che DataVolley riscrive
per intero a ogni azione, ne estrae le righe `[3SCOUT]`, calcola la differenza rispetto a quanto già inviato e la manda
al server con `POST /api/ingest` (token agente, HTTPS). Se la rete manca, i dati restano in una coda su disco e vengono
inviati appena possibile. Il server e il suo protocollo sono in `docs/server.md`; i contratti in `packages/shared`.
Il modo più semplice di usarlo è la **finestra** (doppio clic su `arenalive-agent.exe`): registrazione automatica
dell'agente, cartella del `.dvw`, START e STOP, senza console. Il servizio NSSM (`--config`) resta per l'avvio automatico.
Esiste anche una riscrittura in C# (.NET 10) con le stesse funzioni: sezione «Agente C# (.NET 10)» più sotto.

## Come funziona

### Lettura del file (`src/watcher.ts`, `src/dvw.ts`)
- **Polling con `fs.stat`** ogni `pollIntervalMs` (1 s): su pennina FAT/USB gli eventi del file system non sono
  affidabili (`docs/decisioni.md`).
- **Quale file**: se `watchPath` è un file, quello; se è una cartella, il `.dvw` con la data di modifica più recente.
  Sono ignorati i nomi che iniziano con `.` o `~` e quelli che non finiscono in `.dvw` (quindi anche `*.tmp`).
- **Stabilità**: il file si legge solo quando dimensione e data di modifica restano uguali per `stableMs` (700 ms).
  Se cambia durante la lettura, si aspetta il poll stabile successivo. Un file che cambia di continuo è letto comunque
  dopo un'**attesa massima di 2 s** (`maxWaitMs`, `DEFAULT_TIMING` in `src/agent.ts`, valore interno non presente in
  `config.json`), così un punto non resta fermo finché DataVolley scrive.
- **Ritmo misurato** (polling 1000 ms, stabilità 700 ms): a velocità reale c'è 1 punto per invio (22-32 s tra i punti;
  121 punti, 121 invii), quindi il polling non è stato ridotto; a velocità 20 del simulatore al massimo 3 punti per
  invio. Più punti in un solo aggiornamento arrivano dal simulatore veloce o da una coda che si svuota dopo
  un'interruzione; il portale li mostra uno alla volta (`docs/portale.md`, «Punti in sequenza»).
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
Vale anche al contrario: due file con data, ora e squadre uguali (succede con il simulatore, che usa un orario fisso) sono
visti come la **stessa partita**. L'agente si riallinea con uno snapshot (il server risponde `needSnapshot`, log
«server non allineato»); osservato nel collaudo del 2026-10-14.

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
| 401 / 403 | «token agente non valido o revocato»: coda conservata, nuovo tentativo ogni 60 s. Se il 401 ha il testo `AGENT_EXPIRED_ERROR` («Registrazione scaduta: registrati di nuovo», `expiredAnswer` in `sender.ts` → `expired` nel risultato dell'invio, `registrationExpired` in `agent.ts`) l'agente lo scrive nel log al posto del messaggio di token non valido; la finestra mostra «● Registrazione scaduta: registrati di nuovo (STOP, poi «Registra»)» (`window.ps1`). Un admin può prolungare la validità dal portale («Agenti», «Prolunga») oppure serve una nuova registrazione |
| 413 | richiesta scartata, coda svuotata, prossima modifica come snapshot; in più nuovo tentativo dello snapshot ogni `snapshotRetryMs` |
| altri 4xx | richiesta scartata; se era un `append` si accoda subito uno snapshot, se era uno snapshot si riprova alla modifica successiva o dopo `snapshotRetryMs` |
| 408, 429, 5xx, rete assente, risposta non valida | backoff come sopra, dati in coda: «server non raggiungibile: i dati restano in coda» (una volta, poi «server di nuovo raggiungibile») |

### Finestra (`src/gui/`)
- **Modi dell'eseguibile**: senza argomenti (doppio clic) o con `--gui` si apre la finestra; con `--config`, `--console`
  o `--once` l'agente gira come prima. `--gui` insieme a `--once` o `--console` è un errore («--gui non si usa con
  --once o --console», uscita 1). Fuori da Windows la finestra non si apre: messaggio e uscita 1. Il servizio NSSM
  passa sempre `--config`, quindi non cambia (`scripts/installa-servizio.ps1`).
- **Come è fatta**: una finestra WinForms disegnata da PowerShell (`src/gui/window.ps1`), scelta al posto di Electron o
  di una pagina nel browser (`docs/decisioni.md`). L'agente (Node) ne scrive il testo in `<dataDir>/gui/window.ps1`
  (UTF-8 con BOM) a **ogni avvio** e la lancia con `powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File`
  (`powershellArgs`, `src/gui/host.ts`); le modifiche fatte a quel file si perdono. Il testo è incluso nell'eseguibile
  (`--loader:.ps1=text` nello script `bundle`): la finestra funziona solo dall'exe impacchettato o dal bundle, non
  dal `dist/` di `tsc`, che non contiene `window.ps1`.
- **Dialogo**: righe JSON su stdin/stdout del processo PowerShell (`src/gui/protocol.ts`). Finestra → agente: `start`
  (`watchPath`, `token` facoltativo), `stop`, `quit`, `register` (`name`), `cancelRegistration`; agente → finestra:
  `init`, `state`, `log`, `error`, `registration`. Gli schemi
  zod sono `.strict()`; le righe oltre 8 KB (`MAX_GUI_LINE`) o non valide sono scartate (nel log solo la lunghezza).
  Se la finestra muore l'agente si ferma; se l'agente muore la finestra si chiude.
- **Console**: quella nera di Node è nascosta solo se l'ha aperta il doppio clic (nella console ci sono soltanto
  `arenalive-agent.exe` e `powershell.exe`); lanciato da un prompt, resta visibile.
- **Cosa si vede**: «Cartella del .dvw» e «Sfoglia…» (menu: cartella, oppure singolo file `.dvw`; la ricerca parte dalla
  prima pennina), «Server» (sola lettura, da `config.json`), la riga di registrazione (sotto), il link «Avanzate ▸» (chiuso
  all'apertura; aperto diventa «Avanzate ▾») e, solo da aperto, la riga «Token agente (alternativa)» (mascherato) con a
  fianco «salvato (…abcd)» o «mancante: incollalo». Se la registrazione è rifiutata, «Avanzate» si apre da sola. Poi START, STOP, lo stato («Fermo: premi START per leggere il .dvw», «Avvio…», «In lettura: <file>»,
  «In attesa del file .dvw», «Arresto…», con «server non raggiungibile» se serve), una riga con righe, coda e ultimo
  invio, e il riquadro «Ultimi messaggi» (gli ultimi 200 del log, `LogSink`). START è attivo solo da fermo e con un
  token salvato o incollato. Chiudendo la finestra durante la lettura compare «La lettura del .dvw è in corso: fermarla
  e chiudere?». START è permesso anche mentre una registrazione è in attesa.
- **Registrazione automatica** (`src/register.ts`, `GuiController.register`): è la **via normale** per avere il token; incollarlo a mano (sotto «Avanzate») è l'alternativa.
  - **Cosa si vede**: la riga «Nome agente» (precompilata con il nome del PC, massimo 100 caratteri) e «Registra»; in
    attesa «Registra» diventa «Annulla». Sotto, il **codice di abbinamento** in caratteri grandi (Consolas) e una riga di
    stato: «Scrivi il nome e premi «Registra», oppure usa un token in «Avanzate»» (iniziale), «In attesa di
    abilitazione nel portale: Agenti → Richieste in attesa (scade gg/MM hh:mm)», «Abilitato: token salvato. Premi START»
    (se la lettura è in corso: «Abilitato. Token salvato: vale dal prossimo START», perché l'agente già avviato tiene il
    token con cui è partito), «Rifiutata nel portale: registra di nuovo o incolla un token in «Avanzate»» (e «Avanzate» si apre), «Scaduta senza
    abilitazione: registra di nuovo», «Token già consegnato in precedenza: registra di nuovo», «Errore: <motivo>».
  - **Flusso**: «Registra» invia `POST /api/agents/registrations` (nome) e il server risponde con codice di abbinamento
    e segreto; l'amministratore abilita la richiesta nel portale (pagina «Agenti», «Richieste in attesa»,
    `docs/portale.md`, `docs/server.md`); ogni 5 s (`registrationPollMs`, una interrogazione alla volta)
    l'agente chiede `POST /api/agents/registrations/status` col segreto come `Bearer`. All'abilitazione il token è scritto
    in `config.json` (`saveToken`, come per il token incollato) e START si attiva. Le richieste hanno timeout di 10 s;
    le risposte sono validate con gli schemi di `packages/shared`.
  - **Server non raggiungibile durante l'attesa**: il codice resta visibile, la riga di stato diventa arancione con il
    motivo e «nuovo tentativo tra 5 s»; l'attesa continua da sola.
  - **Stato su disco**: `<dataDir>/registration.json` (scrittura atomica, `version` 1) conserva richiesta e segreto. Alla
    riapertura della finestra l'attesa riprende e il codice torna visibile; un file non valido è cancellato.
    Il file è cancellato a registrazione conclusa o su «Annulla».
  - **Annulla e chiusura**: «Annulla» e la chiusura della finestra interrompono subito la richiesta in volo
    (`AbortSignal`). Se il server aveva già abilitato e il token arriva dopo «Annulla», è **ignorato** e nel log compare
    «token ricevuto dopo l'annullamento della registrazione: ignorato (revoca l'agente dal portale)» con `agentId`:
    l'agente va revocato dal portale. **Limite noto**: chiudere proprio mentre il server consegna il token lo perde; alla
    riapertura la registrazione risulta «Token già consegnato in precedenza»: registrarsi di nuovo e revocare dal portale
    l'agente rimasto.
  - **Rifiuti**: «Registra» è rifiutato durante la lettura («Ferma la lettura (STOP) prima di registrare l'agente») e con
    una registrazione già in corso («Registrazione già in corso: premi «Annulla» per ricominciare»).
  - **`config.json` minimo**: basta `serverUrl` (con `http` verso IP privato solo se `allowHttpPrivateNetwork` è
    `true`, come per START); il resto della configurazione è completato al primo START.
- **Grafica del cliente** (`src/gui/branding.ts`, `readWindowBranding`): accanto all'exe lo zip scaricato dal portale
  (`docs/server.md`, «Agente scaricabile») contiene `branding.json` (`AgentBrandingSchema`, versione 1: nome e sei colori
  `#rrggbb`, schema `.strict()`, al massimo 16 KB) e un logo `logo.png` o `logo.jpg` (al massimo 2 MB e 1024×1024 px,
  controllati sui byte, non sull'estensione). L'agente li legge a ogni avvio della finestra e manda colori, nome e percorso
  del logo nel messaggio `init`; `window.ps1` (`Set-Branding`) mostra una testata col colore primario, il logo, il nome del
  cliente e il titolo «<Cliente> – Agente ArenaLive», con START colorato. Senza `branding.json`, o se non è valido, la
  finestra ha la grafica predefinita **del prodotto**: una testata con il logo ArenaLive (`Set-ProductHeader` in
  `window.ps1`), nella variante positivo su sfondo chiaro e negativo su sfondo scuro (luminanza WCAG del colore di fondo
  < 0,5, come `pickSystemLogo` di `packages/shared`), e l'icona della finestra (`Set-WindowIcon`). Le immagini
  (`arenalive-positivo.png`, `arenalive-negativo.png`, `arenalive-agent.ico` in `apps/agent/src/gui/brand/`) sono incluse
  nell'exe (`--loader:.png=binary --loader:.ico=binary` nello script `bundle`), scritte a ogni avvio accanto a `window.ps1`
  (`productAssets.ts`) e passate col campo `product` del messaggio `init`; se è il logo a mancare o non essere valido (troppo grande, rotto, non PNG/JPEG) si
  vedono i colori senza logo. I colori che il cliente non ha scelto vengono dal suo template (`resolveBrandColors`, via `agentBranding` nel server). Un file scartato è scritto nel log con il motivo e non ferma mai la finestra.
- **Pennina intatta** (`assertNotOnStick`, `src/config.ts`): START, «Registra» e la ripresa dell'attesa sono rifiutati
  se `dataDir` o `logDir` stanno dentro `watchPath`. In modalità finestra, in quel caso, lo script e i log vanno in
  `%TEMP%\ArenaLiveAgent` (`data`, `logs`) e la finestra mostra l'errore. **Avvertenza**: non avviare l'agente dalla pennina:
  `config.json` (che contiene il token) e, con i percorsi relativi predefiniti, `data/` e `logs/` finirebbero lì.
- **`config.json` mancante**: la finestra si apre ma mostra «config.json non trovato (…): scaricalo dall'area admin,
  pagina «Agenti», e mettilo accanto a arenalive-agent.exe». Il file non è creato dalla finestra.
- **START** (`GuiController`): salva `agentToken` (se incollato) e `watchPath` in `config.json` (`saveTokenToFile`,
  `saveWatchPath` in `src/gui/config-file.ts`): conservano gli altri campi, validano prima con `parseConfig` (se non
  è valido non scrivono nulla) e scrivono in modo atomico (`writeFileAtomic`). Poi prende il lucchetto e avvia
  l'agente. **STOP** lo ferma; la coda resta su disco. Un errore compare sotto STOP in rosso.
- **Il token non arriva mai in chiaro alla finestra**: nel messaggio `init` ci sono solo la presenza e gli ultimi 4
  caratteri; ogni riga in uscita ha i token e i segreti di registrazione noti sostituiti con `[nascosto]`. Il log dell'agente ha la stessa
  redazione anche per la copia mostrata nella finestra (`extraStream`, `src/logger.ts`).

### Lucchetto (`src/lock.ts`)
- Un solo agente per cartella dati: `<dataDir>/agent.lock` contiene `pid` e `startedAt`, creato in modo esclusivo.
  Lo prendono la lettura continua (console e servizio) e la finestra; **non** `--once` (`installa-servizio.ps1` lo
  lancia mentre il servizio può essere attivo).
- **Finestra**: START è rifiutato se il lucchetto appartiene a un'altra istanza attiva («Un'altra istanza dell'agente è
  già in lettura (pid N, per esempio il servizio ArenaLiveAgent): fermala prima di avviare questa»).
- **Console e servizio**: non escono; scrivono nel log «un'altra istanza dell'agente è attiva (pid N): attendo» e
  riprovano ogni 30 s fino allo stop (`waitForLock`), così NSSM non riavvia il servizio a ripetizione.
- **Lucchetto stantio** (sostituito): pid uguale a quello del processo stesso; scritto prima dell'avvio del PC (margine
  60 s); `startedAt` illeggibile; processo non più esistente. Limiti noti: un pid riassegnato a un altro programma
  vivo nella stessa sessione di Windows sembra ancora attivo; con l'avvio rapido di Windows (Fast Startup) l'ora di
  avvio non si azzera; due processi che sostituiscono lo stesso lucchetto stantio nello stesso istante possono
  incrociarsi (non succede con un servizio e una finestra).

### Log (`src/logger.ts`)
- File giornalieri `arenalive-agent-AAAA-MM-GG.log` (giorno UTC) in `logDir`, formato JSON (pino); oltre 10 MB il file continua in
  `.1`, `.2`…; i file più vecchi di 14 giorni sono cancellati.
- Ogni 60 s una riga `stato`: `file`, `matchKey`, `lines`, `queue`, `lastSuccessAt`, `serverReachable`.
- Token e segreto di registrazione non compaiono mai nei log (`REDACT_PATHS`: `agentToken`, `authorization`, `secret`,
  `token`, censurati come `[nascosto]`) e viaggiano solo nell'intestazione.
- Messaggi principali: «agente avviato», «partita in lettura», «token agente non valido o revocato»,
  «file .dvw non disponibile (pennina tolta?): in attesa», «server non raggiungibile: i dati restano in coda»,
  «contenuto da confermare con una seconda lettura», «coda ripresa dal disco», «coda compattata in uno snapshot».

## Configurazione
`config.json` (default: accanto all'eseguibile; `--config <file>` per un altro). Campi sconosciuti sono rifiutati. Modello:
`apps/agent/config.example.json`; regole: `apps/agent/src/config.ts` (`AgentConfigFileSchema`, `parseConfig`).

| Campo | Default | Regola |
|---|---|---|
| `watchPath` | obbligatorio | cartella (es. `E:\`) o singolo `.dvw` |
| `serverUrl` | obbligatorio | URL **del portale** (nginx), es. `https://<host>/`; `https` sempre; `http` solo verso `localhost`, `127.0.0.1`, `[::1]` o, con `allowHttpPrivateNetwork`, verso IPv4 privati; senza credenziali nell'URL |
| `allowHttpPrivateNetwork` | `false` | ammette `http` verso IPv4 letterali privati (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), mai verso nomi host o IP pubblici. **Solo per prove in rete locale; in produzione https.** All'avvio con `http` attivo l'agente scrive un warning («connessione senza cifratura verso `<host>`: usare https in produzione»). Assente in `config.example.json` (il JSON non ammette commenti) |
| `agentToken` | obbligatorio | 20-200 caratteri `A-Za-z0-9_-`; di norma lo scrive l'agente dopo la registrazione, in alternativa (servizio, `--once`, config scritto a mano) il token intero di «Agenti → Nuovo agente». Se non è valido: «agentToken non valido (registra di nuovo l'agente o incolla il token intero)» |
| `pollIntervalMs` | `1000` | intero 10-60000 |
| `stableMs` | `700` | intero 0-60000 |
| `dataDir` | `data` accanto all'eseguibile | coda, stato, `agent.lock`, `registration.json` e `gui/window.ps1`; **non dentro `watchPath`**; **non deve essere scrivibile da altri utenti**, perché la finestra esegue lì uno script con `-ExecutionPolicy Bypass` (`C:\ArenaLiveAgent\data` va bene) |
| `logDir` | `logs` accanto all'eseguibile | log; **non dentro `watchPath`** (se `watchPath` è un file, vale la sua cartella) |
| `logLevel` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `snapshotRetryMs` | `300000` | intero 1000-86400000; nuovo tentativo dello snapshot rifiutato (4xx/413) anche senza modifiche del file |
| `retentionDays` | `30` | intero 1-3650; giorni dopo i quali il record di una partita ferma con coda vuota è cancellato all'avvio |

L'agente invia a `ingestUrl(serverUrl)` (`apps/agent/src/sender.ts`): aggiunge `api/ingest` a `serverUrl`, con o senza `/`
finale, e mantiene un eventuale prefisso di percorso (`apiUrl`, usata anche dalla registrazione). Quindi `https://<host>/` dà `https://<host>/api/ingest`, che nginx
del portale inoltra al server; la porta 8090 del server non si espone in rete (`docs/portale.md`, `docs/server.md`).
L'area admin (pagina «Agenti») propone un `config.json` già compilato con l'indirizzo del portale come `serverUrl`; lo zip
«Scarica l'agente per Windows» ne contiene uno senza token: `watchPath` `E:\`, `serverUrl` del cliente, `dataDir`
`C:\ArenaLiveAgent\data`, `logDir` `C:\ArenaLiveAgent\logs` (il token arriva con la registrazione).

I percorsi relativi sono risolti rispetto alla cartella dell'eseguibile (in sviluppo, la cartella corrente). Un BOM
iniziale nel JSON è tollerato. Configurazione non valida: messaggio chiaro e codice di uscita 1.

## Come si usa / si prova

### CLI (`src/cli.ts`)
`arenalive-agent` (finestra) · `arenalive-agent --gui [--config <file>]` · `arenalive-agent [--config <file>] [--console] [--once] [--help]`

| Opzione | Effetto |
|---|---|
| (nessuna) | finestra, come `--gui` (doppio clic) |
| `--gui` | finestra (solo Windows); non con `--once` o `--console` |
| `--config <file>` | file di configurazione; da solo, lettura continua senza finestra |
| `--console` | log anche sulla console |
| `--once` | legge una volta (attesa massima `max(30 s, stableMs × 10)`), invia la coda ignorando il backoff e termina |
| `--help` | aiuto |

Codici di uscita di `--once`: `0` tutto inviato, `2` dati rimasti in coda, `3` nessun file `.dvw` letto, `1`
configurazione non valida o errore. Senza `--once` il processo gira finché riceve SIGINT/SIGTERM (uscita 0).

### Installazione su Windows
1. **Token agente**: di norma non serve crearlo a mano, lo scrive la **registrazione** dalla finestra (passo 4). Il token
   manuale è l'alternativa, utile per servizio o `--once` con `config.json` scritto a mano (passo 3): nell'area admin
   («Agenti → Nuovo agente») o con `POST /api/admin/agents` (esempio con `curl` in `docs/server.md`) si crea un agente; la
   risposta contiene `token`, **mostrato una sola volta**. Un agente revocato con `DELETE /api/admin/agents/:id` riceve 401.
2. **Build** (su Windows con Node 24, corepack e `pnpm install` già fatto). Lo script
   `apps/agent/scripts/build-exe.ps1` ha le sue variabili in cima (percorsi ricavati dalla posizione dello script,
   `node.exe` dal PATH, opzioni SEA) e di norma non va modificato:

   ```powershell
   # --- variabili ---
   $Repo = "C:\ArenaLive"   # radice del repository clonato sul PC di build
   $Dest = "C:\ArenaLiveAgent"      # cartella di installazione (mai la pennina)

   # --- comandi ---
   powershell -ExecutionPolicy Bypass -File (Join-Path $Repo "apps\agent\scripts\build-exe.ps1")
   if ($LASTEXITCODE -ne 0) { throw "build fallita" } else { Write-Host "Build completata" }
   New-Item -ItemType Directory -Force -Path $Dest | Out-Null
   Copy-Item (Join-Path $Repo "apps\agent\build\arenalive-agent.exe") $Dest -Force
   Copy-Item (Join-Path $Repo "apps\agent\scripts\installa-servizio.ps1") $Dest -Force
   ```

3. **Configurazione con token manuale** (alternativa alla registrazione: serve solo per servizio o `--once` con `config.json`
   scritto a mano; con la finestra basta un `config.json` con `serverUrl` e si registra l'agente):

   ```powershell
   # --- variabili ---
   $Dest      = "C:\ArenaLiveAgent"                       # cartella di installazione
   $WatchPath = "E:\"                               # pennina o cartella dei .dvw
   $ServerUrl = "https://arenalive.example.it/"           # indirizzo pubblico del portale (nginx, https); l'agente aggiunge api/ingest
   $Token     = "<token agente dell'area admin>"    # alternativa alla registrazione: campo "token" della risposta di /api/admin/agents (Agenti → Nuovo agente)

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
   & (Join-Path $Dest "arenalive-agent.exe") --config (Join-Path $Dest "config.json") --once --console
   Write-Host "Codice di uscita: $LASTEXITCODE (0 inviato, 2 dati in coda, 3 nessun .dvw, 1 errore)"
   ```

4. **Uso con il doppio clic** (senza servizio), passo per passo:
   1. Dal portale (area admin, pagina «Agenti», riquadro «Agente per Windows») premi «Scarica l'agente per Windows» e
      scompatta lo zip `ArenaLive-agente-<cliente>-<versione>.zip` in `C:\ArenaLiveAgent` (non sulla pennina): dentro ci sono
      `arenalive-agent.exe`, `config.json` con `serverUrl` già compilato, `branding.json`, il logo e `LEGGIMI.txt`. L'exe non è
      firmato: se Windows mostra SmartScreen, «Ulteriori informazioni» e poi «Esegui comunque». In alternativa, `arenalive-agent.exe`
      costruito a mano e il `config.json` della pagina «Agenti».
   2. Doppio clic su `arenalive-agent.exe`: si apre la finestra (la console nera sparisce).
   3. Controlla «Server». Poi **registra l'agente** (via normale): controlla «Nome agente», premi «Registra», comunica il
      codice di abbinamento a chi gestisce il portale (area admin, pagina «Agenti», «Richieste in attesa») e aspetta
      «Abilitato: token salvato. Premi START». In alternativa apri «Avanzate ▸» e incolla in «Token agente (alternativa)» il
      token di «Agenti → Nuovo agente» (se a fianco c'è «salvato (…abcd)» e vale ancora, lascia vuoto). Non avviare
      l'agente dalla pennina.
   4. «Cartella del .dvw» → «Sfoglia…»: scegli la pennina (o la cartella) oppure un singolo `.dvw`.
   5. START: lo stato diventa «In lettura: <file>»; righe, coda e ultimo invio si aggiornano. Gli errori compaiono in rosso.
   6. STOP per fermare la lettura (la coda resta su disco e riparte al prossimo START). Per chiudere la finestra durante
      la lettura si conferma la domanda.
   Se il servizio `ArenaLiveAgent` è attivo, START è rifiutato: fermare prima il servizio.

5. **Servizio** (PowerShell come amministratore): `apps\agent\scripts\installa-servizio.ps1` installa il servizio `ArenaLiveAgent`
   con NSSM (avvio automatico, riavvio dopo 5 s, uscita standard in `logs\servizio.log`). Prima di lanciarlo si
   compilano le variabili in cima allo script: `$Nssm` (percorso di `nssm.exe`, da nssm.cc, cartella `win64`),
   `$CartellaAgente` (`C:\ArenaLiveAgent`) e, se serve, `$NomeServizio`, `$NomeVisibile`, `$Descrizione`, `$TipoAvvio`,
   `$AzioneUscita`, `$RitardoRiavvio`, `$RuotaFile`, `$RuotaByte`.
   Lo script prova prima la configurazione con `--once`, poi installa e avvia; rilanciarlo reinstalla il servizio.

   ```powershell
   # --- variabili ---
   $Script = "C:\ArenaLiveAgent\installa-servizio.ps1"   # copia dello script con le variabili in cima già compilate

   # --- comandi ---
   powershell -ExecutionPolicy Bypass -File $Script
   ```

### Prova su Linux con il simulatore
Serve il server in sviluppo (`docs/server.md`, un terminale) e un token agente. Poi:

```bash
# --- variabili ---
RADICE="/percorso/del/repository"      # radice del repository o del worktree
SERVER="http://127.0.0.1:8090"         # server in sviluppo (http ammesso solo verso localhost); con Docker, il portale http://localhost:8080
TOKEN_AGENTE="<token agente>"          # token manuale (alternativa alla registrazione): campo "token" della risposta di POST /api/admin/agents, o Agenti → Nuovo agente
CARTELLA_DVW="/tmp/arenalive-dvw"            # cartella osservata, dove il simulatore scrive il .dvw
DATI="/tmp/arenalive-agent/data"             # dataDir (fuori da CARTELLA_DVW)
LOG="/tmp/arenalive-agent/logs"              # logDir (fuori da CARTELLA_DVW)
CONFIG="/tmp/arenalive-agent/config.json"    # file di configurazione generato
VELOCITA="20"                          # velocità di riproduzione del simulatore

# --- comandi ---
cd "$RADICE"
pnpm install
pnpm --filter @arenalive/dvw-simulator build
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
pnpm --filter @arenalive/agent dev --config "$CONFIG"      # arenalive-agent da sorgente, con log anche sulla console
```

`dev` esegue `tsx --conditions=@arenalive/source src/main.ts --console` (`apps/agent/package.json`). In alternativa
`pnpm --filter @arenalive/agent bundle` produce `apps/agent/build/arenalive-agent.cjs`, avviabile con `node` e le stesse opzioni.
Con `--corrections` il simulatore riscrive righe passate: l'agente invia uno snapshot. Lo stato si legge con
`GET /api/public/:token/state` (`docs/server.md`). Test dell'agente: `pnpm --filter @arenalive/agent test`.

### Prova in LAN senza https
Per un portale raggiungibile solo in http su rete locale (es. `http://192.168.104.102:8085`), `config.json` su Windows:

```json
{
  "watchPath": "E:\\",
  "serverUrl": "http://192.168.104.102:8085",
  "allowHttpPrivateNetwork": true,
  "agentToken": "<token agente: di norma lo scrive l'agente dopo la registrazione; in alternativa Agenti → Nuovo agente>"
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
- fine riga CRLF dei file DVW reali;
- finestra: si apre col doppio clic, i testi con accenti e «…» sono leggibili (script con BOM, PowerShell 5.1), la console
  nera sparisce col doppio clic e resta lanciando da un prompt;
- «Sfoglia…» parte dalla prima pennina e accetta sia cartella sia file `.dvw`;
- START con `config.json` mancante, con token assente o malformato, con cartella inesistente: messaggio rosso chiaro;
- START salva `watchPath` e `agentToken` in `config.json` senza perdere gli altri campi; il token non compare né nella
  finestra (solo «…abcd») né nel log;
- STOP e chiusura durante la lettura (domanda di conferma), la coda resta su disco;
- finestra aperta con il servizio `ArenaLiveAgent` attivo: START rifiutato; servizio avviato con la finestra in lettura: nel
  log «un'altra istanza dell'agente è attiva» e nessun riavvio a ripetizione di NSSM;
- lucchetto stantio dopo spegnimento forzato del PC: START funziona senza intervento;
- antivirus o SmartScreen che bloccano l'esecuzione di `window.ps1` da `dataDir\gui`;
- registrazione: «Registra», abilitazione nel portale → «Abilitato: token salvato. Premi START» e START attivo;
- «Avanzate ▸» chiuso all'apertura, «Avanzate ▾» mostra «Token agente (alternativa)»; registrazione rifiutata → si apre da sola;
- chiudere la finestra durante l'attesa e riaprirla → il codice di abbinamento torna visibile;
- «Annulla» e poi una nuova registrazione;
- server spento durante l'attesa → riga arancione con «nuovo tentativo tra 5 s», poi l'attesa riprende da sola;
- agente avviato dalla pennina: errore mostrato nella finestra, script e log in `%TEMP%\ArenaLiveAgent`;
- agente scaricato dal portale: scompattare lo zip, doppio clic, avviso SmartScreen e «Esegui comunque»; testata, colori,
  nome e titolo del cliente; logo PNG e logo JPEG; logo troppo grande o rotto → colori senza logo; `branding.json` rotto o
  assente → grafica predefinita; «Registra» → «Abilita» nel portale → START.

## Agente C# (.NET 10)
`apps/agent-dotnet` è la riscrittura dell'agente in C# (.NET 10 LTS, scelta di Luca: linguaggio solido, exe nativo; motivi in
`docs/decisioni.md`, 2026-10-17). **Stato**: codice fatto e testato su Linux (xUnit); **non ancora provato su Windows**.
L'agente Node (sopra) resta nel repository, ma **il portale serve l'agente C#**: in produzione
`scripts/pubblica-agente-produzione.sh` (lanciato da `aggiorna-produzione.sh`) chiama `scripts/costruisci-agente-dotnet.sh`
e pubblica `arenalive-agent.exe` e `arenalive-agent.json` nella cartella `AGENT_DOWNLOAD_HOST_DIR` (`docs/infrastruttura.md`,
«Agente scaricabile»). `scripts/costruisci-agente.sh` costruisce invece l'exe Node (SEA) e resta per prove a mano. La firma
del codice è ancora da fare: l'exe mostra «autore sconosciuto» (SmartScreen).

### Struttura
- `apps/agent-dotnet/ArenaLive.Agent.slnx`; `global.json` e `Directory.Build.props` (azienda «ArenaLive», prodotto «ArenaLive
  Agent», versione di default 0.1.0, sovrascritta da `-p:Version`).
- `src/ArenaLive.Agent.Core` (net10.0): tutta la logica, senza interfaccia: `Dvw.cs`, `DvwDecoder.cs`, `FileWatcher.cs`,
  `MatchStore.cs`, `Ingest.cs`, `IngestValidator.cs`, `Sender.cs`, `Registration.cs`, `AgentConfig.cs`, `AgentLock.cs`,
  `Logging.cs`, `Branding.cs`, `GuiController.cs`, `Agent.cs`, `Cli.cs`.
- `src/ArenaLive.Agent.App` (net10.0-windows, WinForms, `AssemblyName` `arenalive-agent`): `Program.cs`, `MainForm.cs`, `WindowHost.cs`,
  `app.manifest`, `arenalive-agent.ico`. Unica dipendenza: `System.ServiceProcess.ServiceController`.
- `tests/ArenaLive.Agent.Core.Tests` (xUnit v3): comportamento dell'agente, confronto col Node, schemi, lettura condivisa.
- **Exe unico** `arenalive-agent.exe` per win-x64, autosufficiente (runtime .NET incluso, compresso, niente trimming), circa 48 MB,
  con informazioni di versione (`<versione>+<commit>`) e icona (`arenalive-agent.ico`, la stessa generata da
  `apps/web/scripts/brand-icons.ts` per il portale, copiata negli agenti).
- **Marchio nella finestra**: senza grafica del cliente (`branding.json` assente o non valido) la testata mostra il logo
  ArenaLive, scelto in base alla luminanza dello sfondo (`Branding.ProductLogoFor(r, g, b)`: negativo sotto 0,5, positivo
  altrimenti). I loghi sono **risorse incorporate** nell'exe (`brand\arenalive-positivo.png` e `brand\arenalive-negativo.png`
  in `ArenaLive.Agent.App.csproj`, copie di `apps/web/public/brand/`); titolo predefinito «ArenaLive – Agente <versione>».

### Cosa fa (stesse funzioni dell'agente Node)
- **Finestra** con le stesse voci e gli stessi testi (cartella del `.dvw`, «Sfoglia…», registrazione con codice di
  abbinamento e scadenza, «Registrazione scaduta: registrati di nuovo», START e STOP, «Ultimi messaggi»), `GuiController`
  nel Core come `GuiController` del Node.
- **Dati**: coda offline con lo stesso JSON (`<dataDir>/matches/<matchKey>.json`), diff `append`/`snapshot` con `seq` e
  `contentHash` identici, decodifica windows-1252, `agent.lock`, log a rotazione (`arenalive-agent-AAAA-MM-GG.log`, 10 MB, 14
  giorni), `registration.json`. `config.json` identico (stessi campi, stessi limiti, stesso `apps/agent/config.example.json`).
- **Grafica del cliente**: `branding.json` (al massimo 16 KB) e logo PNG/JPEG (al massimo 2 MB e 1024×1024 px, controllati
  sui byte) validati con gli stessi limiti dell'agente Node (`apps/agent/src/gui/branding.ts`; `MaxBrandingBytes` in `Branding.cs`, logo con `AGENT_LOGO_MAX_BYTES` e `AGENT_LOGO_MAX_SIDE` di `packages/shared/src/agentDownload.ts`), stessi messaggi nel log.
- **Il `.dvw` non si blocca mai** (`FileWatcher`): apertura con `FileShare.ReadWrite | FileShare.Delete`, lettura intera e
  chiusura subito, nessun handle tenuto tra due poll. Se non si può aprire (`ReadOutcome.Busy`: `EACCES`, `EBUSY`, `EIO`)
  si riprova al giro dopo.
- **Log iniziale**: la riga «agente avviato» ha il campo `agent: "dotnet"` per distinguerlo dal Node.

### Modi dell'exe (`Cli.cs`)
Come il Node (nessun argomento o `--gui`: finestra; `--config`, `--console`, `--once`, `--help`, stessi codici di uscita di
`--once`) più `--service` (servizio di Windows `ArenaLiveAgent`, non con `--once` o `--gui`). `--help` e gli errori di riga di
comando scrivono nella console del chiamante (`AttachConsole`). **L'exe è a finestra**: da PowerShell o prompt non
aspetta la fine né restituisce il codice di uscita, quindi si usa `start /wait arenalive-agent.exe --once --console` oppure
`Start-Process -Wait -PassThru`.

### Servizio senza NSSM
`apps/agent-dotnet/scripts/installa-servizio.ps1` (PowerShell come amministratore) prova la configurazione con `--once`, poi
crea il servizio `ArenaLiveAgent` con `New-Service` (`arenalive-agent.exe --service --config …`, avvio automatico, riavvio dopo 5 s
con `sc.exe failure`), sostituendo un eventuale servizio NSSM con lo stesso nome. Il servizio gira come LocalSystem.
**Permessi** (`icacls`, con SID validi in ogni lingua di Windows): perché chi sostituisce l'exe non esegua codice come
SYSTEM, lo script toglie l'ereditarietà dei permessi dalla cartella dell'agente (`$CartellaAgente`, `C:\ArenaLiveAgent`) e la
restringe a controllo completo per Administrators e SYSTEM e lettura/esecuzione per Users (variabili `$SidAdmin`,
`$SidSystem`, `$SidUtenti`). Restano modificabili dagli utenti solo `$CartellaDati` (`data`) e `$CartellaLog` (`logs`),
perché li scrive anche la finestra. **Conseguenze**: dopo l'installazione `config.json` (token, cartella del `.dvw`) si
cambia solo da amministratore, quindi **prima si fa la registrazione dalla finestra, poi si installa il servizio**; se
`dataDir` o `logDir` di `config.json` non sono quelli predefiniti, vanno messi anche in `$CartellaDati` e `$CartellaLog`.
I log sono in `logs\` (o `logDir`); gli errori prima che esista il log (configurazione non valida) vanno in
`logs\servizio-errori.log` accanto all'exe. Se le cartelle dati o log non si possono creare: messaggio su stderr (nel
servizio, in quel file) e uscita 1. Gli errori di file (`IOException`, accesso negato, percorsi non validi) danno un
messaggio e il codice 1, non un crash. In lettura, `RetryRefusedSnapshots` e `FlushAsync` scrivono qualunque errore nel
log («errore nel nuovo tentativo dello snapshot», «errore nella gestione della coda», poi backoff) e continuano.

### Fedeltà al Node
- **Riferimento**: `apps/agent-dotnet/riferimento/genera-riferimento.ts` usa `apps/agent/src/dvw.ts` e `sync.ts` per
  calcolare, su varianti di `packages/dvw-parser/test/fixtures/partita.dvw` (codifiche, fine riga, troncamenti, spazi),
  intestazione e righe decodificate, `matchKey`, sospetto e richieste pianificate; scrive
  `tests/ArenaLive.Agent.Core.Tests/riferimento-node.json`. `RiferimentoNodeTests.cs` esige gli stessi risultati in C#.
  **Da rigenerare se cambiano `apps/agent/src/dvw.ts` o `sync.ts`**:

  ```bash
  # --- variabili ---
  RADICE="/percorso/del/repository"   # radice del repository o del worktree del job

  # --- comandi ---
  cd "$RADICE"
  pnpm install
  pnpm --filter @arenalive/agent exec tsx --conditions=@arenalive/source ../agent-dotnet/riferimento/genera-riferimento.ts
  ```
- **Contratti**: gli schemi JSON in `apps/agent-dotnet/schemas/` (`ingest-request`, `ingest-response`,
  `create-registration-request`/`-response`, `registration-status-response`, `api-error`, `agent-branding`, più
  `agent-constants.json`) sono **generati** da zod con `pnpm --filter @arenalive/shared schemi:agente`; non si modificano a mano.
  `packages/shared/test/agent-schemas.test.ts` fallisce se non sono aggiornati («schemi non aggiornati: lancia pnpm --filter
  @arenalive/shared schemi:agente»); `SchemaTests.cs` valida i messaggi del C# con JsonSchema.Net. `docs/architettura.md`.

### Costruzione e prova
**Versione**: è quella del `package.json` alla radice (la stessa del rilascio). `scripts/costruisci-agente-dotnet.sh` la passa
a `dotnet publish` come `Version` (`a.b.c`), `FileVersion` (`a.b.c.0`) e `InformationalVersion` (`a.b.c+commit`): compaiono nelle
Proprietà → Dettagli dell'exe di Windows (`Directory.Build.props` ha solo i valori di ripiego per build a mano). La finestra
la mostra nel titolo («ArenaLive – Agente 1.0.0 (85952d0)», con la grafica del cliente «<Cliente> – Agente ArenaLive 1.0.0 (…)»;
`AppVersion.cs`, test `AppVersionTests.cs`). Lo zip scaricato dal portale ha già la versione nel nome
(`ArenaLive-agente-<cliente>-<versione>.zip`, da `arenalive-agent.json`).
L'exe si costruisce da Linux con `scripts/costruisci-agente-dotnet.sh` (test xUnit + `dotnet publish` in un container,
`docs/infrastruttura.md`) e finisce in `dist/arenalive-agent-<versione>.exe`. Su Windows: rinominarlo `arenalive-agent.exe` in
`C:\ArenaLiveAgent` con `config.json`, poi doppio clic (finestra) o `installa-servizio.ps1` (copiato accanto all'exe).
Da provare su Windows: finestra e testi, registrazione, lettura con DataVolley che scrive (nessun blocco del `.dvw`),
servizio come LocalSystem e visibilità di `E:\`, `logs\servizio-errori.log`, SmartScreen, `--once` con `start /wait`.

## Riferimenti
- Agente C#: `apps/agent-dotnet/src/ArenaLive.Agent.Core/` (`Cli.cs`, `Agent.cs`, `FileWatcher.cs`, `Dvw.cs`, `MatchStore.cs`,
  `Ingest.cs`, `Registration.cs`, `Branding.cs`, `AppVersion.cs`), `src/ArenaLive.Agent.App/` (`Program.cs`, `MainForm.cs`, `WindowHost.cs`),
  `scripts/installa-servizio.ps1`, `riferimento/genera-riferimento.ts`, `schemas/`, `packages/shared/scripts/agent-schemas.ts`,
  `packages/shared/scripts/genera-schemi-agente.ts`
- `apps/agent/src/`: `main.ts` (ingresso), `cli.ts` (`runCli`), `config.ts` (`parseConfig`, `loadConfig`),
  `watcher.ts` (`FileWatcher`), `dvw.ts` (`readDvw`, `suspicion`, `deriveMatchKey`), `sync.ts` (`planRequests`),
  `store.ts` (`MatchStore`, `writeFileAtomic`), `sender.ts` (`Sender`, `apiUrl`, `GZIP_THRESHOLD_BYTES`),
  `register.ts` (`RegistrationClient`, `RegistrationError`, `loadPendingRegistration`, `savePendingRegistration`,
  `clearPendingRegistration`), `config.ts` anche `assertNotOnStick`, `agent.ts` (`Agent`,
  `DEFAULT_TIMING`), `logger.ts` (`RotatingFileStream`, `createLogger`, opzione `extraStream`), `lock.ts`
  (`acquireLock`, `waitForLock`, `LockError`)
- finestra, `apps/agent/src/gui/`: `main.ts` (`runGui`), `host.ts` (`runGuiHost`, `powershellArgs`), `controller.ts`
  (`GuiController`), `protocol.ts` (`GuiInMessageSchema`, `GuiOutMessageSchema`, `MAX_GUI_LINE`), `config-file.ts`
  (`saveTokenToFile`, `saveWatchPath`, `registrationServerUrl`, `registrationDataDir`, `guiWritablePaths`), `log-sink.ts` (`LogSink`), `window.ps1`, `window-script.ts`,
  `branding.ts` (`readWindowBranding`, `imageSize`); test `apps/agent/test/gui-branding.test.ts`
- agente scaricabile: costruzione dell'exe in `docs/infrastruttura.md` (`scripts/pubblica-agente-produzione.sh` →
  `scripts/costruisci-agente-dotnet.sh`; Node: `scripts/costruisci-agente.sh`), zip in
  `docs/server.md`, pulsante in `docs/portale.md`; contratti `packages/shared/src/agentDownload.ts` (`AgentBrandingSchema`,
  `isPrivateIPv4`, spostata qui dall'agente)
- `apps/agent/config.example.json`, `apps/agent/scripts/build-exe.ps1`, `apps/agent/scripts/installa-servizio.ps1`
- test: `apps/agent/test/` (`truncation.test.ts`, `resilience.test.ts`, `e2e.test.ts`, `store.test.ts`, `sync.test.ts`)
- contratti: `packages/shared/src/ingest.ts`; server e token: `docs/server.md`; file DVW: `docs/dvw-parser.md`;
  simulatore: `docs/simulatore.md`; architettura: `docs/architettura.md`; decisioni: `docs/decisioni.md`
