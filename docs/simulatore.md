# Simulatore DataVolley

## A cosa serve
`@arenalive/dvw-simulator` (`tools/dvw-simulator/`) genera partite sintetiche coerenti e le "suona" nel tempo scrivendo un file
`.dvw` come farebbe DataVolley, così agente, server e portale si provano senza un file vero né un computer di
scout. Il formato scritto è quello letto da `docs/dvw-parser.md`.

## Come funziona
- **Generazione** (`generateMatch`): partita deterministica; stesso seme e stesse opzioni, stesso risultato. Usa il
  PRNG mulberry32 (`src/rng.ts`, classe `Rng`), mai `Math.random`. Squadre da 12-14 giocatori, set a 25 (il quinto a 15)
  con scarto di 2, rotazioni, cambi, timeout, alternanza della battuta. Ogni set è giocato scambio per scambio: battuta
  (ace `S#` con ricezione `R=`, errore `S=`, altrimenti in gioco), ricezione, alzata, attacco (vincente, errore, murato
  `A/` con muro punto `B#`, oppure difesa e contrattacco). Con i default chi riceve vince circa il 65% degli scambi
  (cambio palla), lo scarto medio di un set è circa 4,5 punti e circa un set su sette va ai vantaggi.
  - **Chi vince**: il numero di set giocati è scelto (`sets`); il vincitore della partita viene dalla forza delle squadre
    (alla pari: uno su due; a 75, la casa vince circa 5 partite su 6) e i set persi dal vincitore sono scelti a caso.
    Un set che va alla squadra sbagliata si rigioca con altri scambi finché lo vince quella giusta, senza aiuti (solo dopo
    40 tentativi la squadra giusta riceve +1% di attacco vincente per ogni tentativo in più), così il punteggio resta
    quello di un set vero. Prima la squadra scelta aveva sempre +6% di attacco vincente (+2% a ogni tentativo), e i set
    erano spesso a senso unico.
  - **Andamento della partita** (`profile`, tipo `MatchProfile`, `src/profile.ts`): obiettivi medi, non conteggi esatti.
    Campi (medie per squadra e per set, salvo i primi due), limiti `PROFILE_LIMITS` e default `DEFAULT_PROFILE`:

    | Campo | Significato | Limiti | Default |
    |---|---|---|---|
    | `homeStrength` | forza della squadra di casa: 50 alla pari, sopra 50 più forte (fino a +12% di attacco vincente, e altrettanto in meno all'altra) | 0-100 | 50 |
    | `variability` | quanto cambia il livello: in ogni set ±10% di attacco vincente al massimo, e ogni 6 punti ±5%, a 100 | 0-100 | 50 |
    | `acesPerSet` | ace | 0-8 | 1,5 |
    | `serveErrorsPerSet` | errori al servizio | 0-10 | 3,5 |
    | `blocksPerSet` | muri punto | 0-8 | 2 |
    | `substitutionsPerSet` | cambi (al massimo 6 per squadra e set) | 0-6 | 2 |
    | `timeoutsPerSet` | time-out (al massimo 2 per squadra e set) | 0-2 | 1,5 |

    Ace ed errori diventano probabilità per battuta (diviso 22,5 battute di una squadra in un set; insieme al massimo
    80%), i muri probabilità per attacco (diviso 28 attacchi). Cambi e time-out: numero del set estratto con media
    giusta (binomiale su 6 e su 2 tentativi), ciascuno chiamato a palla ferma dopo un punto estratto tra il 6° e il 40°
    del set (time-out tra il 5° e il 34°; nel quinto set in proporzione); il time-out lo chiama la squadra che ha appena
    perso il punto, durante una serie dell'altra o comunque entro 4 punti. Un set corto può finire prima, quindi la media
    reale è di poco sotto (time-out circa 1,45 con il default). Cambi secondo le regole: entra un giocatore della panchina
    con lo stesso ruolo (mai il libero); chi è entrato può uscire solo per far rientrare il giocatore che ha sostituito,
    e dopo quel rientro i due restano fermi per il set. `resolveProfile` completa i campi mancanti con i default e porta
    dentro i limiti un valore fuori. I test (`src/profile.test.ts`) controllano su molte partite punteggi, cambio palla,
    medie dei parametri entro un quinto, regole di cambi e time-out, righe tutte lette dal parser e il determinismo.
  - **Rosa vera** (`homeRoster` / `awayRoster`, tipo `RosterPlayer`: numero, cognome, nome, ruolo `S O H M L` o `null`;
    `rosterPlayers` in `src/roster.ts`): la squadra usa i giocatori della rosa con i loro numeri, nomi e ruoli (al massimo
    `ROSTER_MAX_PLAYERS` = 30, numeri 0-99; un numero ripetuto o fuori limite è scartato; `;` e caratteri di controllo dei
    nomi tolti con `dvwField`). Un giocatore senza ruolo prende il primo ruolo che manca: prima quelli per scendere in
    campo (1 palleggiatore, 1 opposto, 2 schiacciatori, 2 centrali, 1 libero), poi quelli di una squadra completa (2, 2,
    4, 4, 2), poi schiacciatore. Se mancano ancora ruoli o la squadra ha meno di `ROSTER_MIN_PLAYERS` (12) giocatori, si
    aggiungono giocatori generati su numeri non usati dalla rosa (prima 1-20 mescolati, poi 21-99) e con cognomi diversi
    da quelli della rosa: mai due giocatori con lo stesso numero. Titolari: il primo giocatore di ogni ruolo nell'ordine
    della rosa. Stesso seme e stessa rosa, stessa partita; senza rosa la partita è quella di prima (stesso seme, stessi
    giocatori generati). `homeCode` / `awayCode` sostituiscono il codice squadra di `[3TEAMS]` (default: le prime tre
    lettere del nome, `teamCode`).
- **Scrittura** (`renderDvw`): produce l'intero file con le sezioni `[3DATAVOLLEYSCOUT]`, `[3MATCH]`, `[3TEAMS]`,
  `[3MORE]`, `[3SET]`, `[3PLAYERS-H]`, `[3PLAYERS-V]`, `[3ATTACKCOMBINATION]`, `[3SETTERCALL]`, `[3SCOUT]`, fine riga CRLF,
  Windows-1252 per default. Con `upToLine` righe di scout visibili, parziali e set vinti sono ricavati solo da quelle righe.
  Le righe di scout seguono il layout DV4 (`docs/dvw-parser.md`).
- **Riproduzione** (`play`): a ogni nuova riga riscrive l'intero file (come DataVolley), aspettando il tempo simulato
  diviso `speed`. Due modalità:
  - `atomic`: scrive `<out>.tmp` e lo rinomina su `<out>`; chi legge vede sempre un file completo;
  - `direct`: scrive direttamente su `<out>` in due pezzi con una breve pausa in mezzo, quindi un lettore può trovare un
    file troncato (utile per provare la tolleranza dell'agente e del parser).
- **Correzioni** (`applyCorrection`, e `corrections` in `play`): con probabilità 5% a ogni riga (dopo la quinta) cambia
  la valutazione di una riga d'azione già scritta (ricezione, alzata o difesa), così si prova lo snapshot dell'agente.
  La riga corretta è sempre tra quelle già visibili. Il file finale converge alla partita corretta.
- **Tempi di una riproduzione** (`src/schedule.ts`, funzioni pure: niente I/O né ora corrente): `planPlayback(righe, ritmo)`
  dice a che millisecondo, dall'avvio, va inviata ogni riga di scout. Restituisce `{ offsetsMs, totalMs, sets }`: gli
  scarti non diminuiscono mai, il primo è 0, `totalMs` è lo scarto dell'ultima riga e `sets` elenca i set con almeno un
  punto (`startMs`, `endMs`). Le righe sono `PlaybackLine` (`kind`, `time?`: basta una `ScoutEntry` del parser). Due ritmi
  (`PlaybackPace`):
  - `{ kind: 'duration', setSeconds, breakSeconds }` («durata»): ogni set dura `setSeconds` e ogni pausa tra due set
    `breakSeconds`; le righe di un set si distribuiscono nel suo tempo seguendo il proprio ritmo. Le righe fuori da un
    set (dopo l'ultimo, o file senza punti) seguono subito quelle prima;
  - `{ kind: 'speed', speed }` («velocità»): il ritmo reale delle righe diviso `speed`. Fra l'ultima riga di un set e la
    prima del successivo passano almeno `MIN_SPEED_BREAK_SECONDS` (20 s): i `.dvw` veri non hanno pausa fra i set e a
    velocità alta quella dei file generati si ridurrebbe a pochi secondi, e il set dopo partiva durante la pausa a schermo.
    Il terzo parametro opzionale di `planPlayback` (`PlaybackOptions.minBreakSeconds(setFinito)`) sostituisce quei 20 s
    set per set: la simulazione del server passa la durata della pausa «Fine set» del cliente (vedi `docs/server.md`).
  Il «ritmo reale» (`matchSeconds`) usa gli orari `HH.MM.SS` scritti da DataVolley (`timeSeconds`: secondi dalla
  mezzanotte, `null` se manca o non è un orario valido): lo scarto dalla riga con orario precedente; oltre la mezzanotte
  continua (uno scarto negativo oltre mezza giornata aggiunge 24 h), una riga indietro nel tempo non fa tornare l'orologio,
  uno scarto sopra `MAX_REAL_GAP_SECONDS` (600 s) è tagliato a 600 s. Una riga senza orario valido, e tutte le righe di un
  file con orari su meno della metà delle righe, usano il **ritmo medio** (`AVERAGE_GAP_SECONDS`) dopo la riga
  precedente: 3 s dopo un tocco (`action`), 20 s dopo un punto (`point`), 60 s dopo un time-out (`timeout`), 300 s dopo la
  fine di un set (`setEnd`). Lo usa il server (`apps/server/src/simulation/`, `docs/server.md`) come dipendenza
  `@arenalive/dvw-simulator`: `planPlayback` per i tempi di ogni partita (anche di un `.dvw` caricato) e, per la sorgente
  «Casuale» della pagina «Simulazione», `generateMatch` (con l'«Andamento della partita» scelto nella pagina e la rosa
  del club per la nostra squadra), `renderDvw` e `DEFAULT_AWAY_NAME`. Non ci sono partite di
  esempio già pronte: le sorgenti sono solo «Casuale» e il file `.dvw` caricato.
- Il test di andata e ritorno (`src/roundtrip.test.ts`) genera partite con 3, 4 e 5 set, le scrive, le rilegge con
  `parseDvw` e verifica: nessun avviso né `unknown`, righe e codici identici, punteggi, set, squadre e giocatori.
- Il campione `samples/partita-sintetica.dvw` è stato scritto con `generateMatch({ seed: 1 })` (3 set, 982 righe di
  scout) dalla versione del simulatore precedente all'«Andamento della partita»: non è stato rigenerato perché i test di
  `packages/volley-stats` ne controllano i numeri. Rigenerato oggi con lo stesso comando darebbe un'altra partita.

## Arresto nella pagina «Simulazione»
Il pulsante «Arresta» (comando `stop` del server, `docs/server.md`) ferma la simulazione in corso o in pausa subito e per
sempre: niente altre righe, la partita simulata e il suo link restano con il punteggio raggiunto (stato `stopped`, nessun
vincitore inventato, mai «live») fino all'eliminazione automatica a 6 ore o a «Elimina». Poi si può «Ricomincia» o avviarne un'altra.

## API (`tools/dvw-simulator/src/index.ts`)
- `generateMatch({ seed, sets?, homeName?, awayName?, homeCode?, awayCode?, homeRoster?, awayRoster?, startTime?,
  profile? }): GeneratedMatch`. `sets` è 3, 4 o 5 (default 3); `startTime` è ISO UTC (default `2025-01-18T18:00:00Z`,
  `DEFAULT_START_TIME`); nomi di default `DEFAULT_HOME_NAME` e `DEFAULT_AWAY_NAME`; `profile` è un `Partial<MatchProfile>`
  (vedi «Andamento della partita»); `homeRoster` / `awayRoster` e i codici: vedi «Rosa vera».
- `rosterPlayers(rng, rosa, idBase)`, `dvwField(testo)`, `teamCode(nome)`, `ROSTER_MIN_PLAYERS`, `ROSTER_MAX_PLAYERS`
  (`src/roster.ts`, `src/generate.ts`).
- `DEFAULT_PROFILE`, `PROFILE_LIMITS`, `resolveProfile(parziale?): MatchProfile` (`src/profile.ts`).
- `renderDvw(match, upToLine, { encoding }): Uint8Array`. `encoding` è `'win1252'` (default) o `'utf8'`.
- `applyCorrection(match, lineIndex, seed, visible?): GeneratedMatch`: restituisce una nuova partita con una sola riga
  corretta, cercando da `lineIndex` e solo tra le prime `visible` righe (default tutte); l'originale non cambia.
- `play(match, { out, speed, mode, corrections, minBreakSeconds?, signal?, seed?, onWrite? }): Promise<void>`. `speed` accelera il tempo,
  `mode` è `'atomic'` o `'direct'`, `signal` (`AbortSignal`) interrompe, `seed` governa le correzioni (default 1),
  `onWrite(righeVisibili)` è chiamata dopo ogni riscrittura.
- `planPlayback(righe, ritmo, { minBreakSeconds? }): PlaybackPlan`, `matchSeconds`, `timeSeconds`, `AVERAGE_GAP_SECONDS`,
  `MAX_REAL_GAP_SECONDS`, `MIN_SPEED_BREAK_SECONDS` (`src/schedule.ts`, vedi sopra); `playGapMs` (attesa prima di una riga di `play`, con la pausa minima dopo `endset`; `minBreakSeconds` vale 0 se omesso).
- Anche `scoutLineText`, `Rng` e i tipi (`src/types.ts`).

## Configurazione
Nessun file né variabile d'ambiente. Opzioni della CLI (`src/cli.ts`, bin `dvw-simulator` in `dist/cli.js`):

| Comando | Opzioni |
|---|---|
| `dvw-simulator generate` | `--out <file>` (obbligatoria), `--seed N` (default 1), `--sets N` (3, 4 o 5; default 3), e l'andamento: `--home-strength N`, `--variability N`, `--aces N`, `--serve-errors N`, `--blocks N`, `--subs N`, `--timeouts N` (campi `homeStrength`, `variability`, `acesPerSet`, `serveErrorsPerSet`, `blocksPerSet`, `substitutionsPerSet`, `timeoutsPerSet`; limiti e default nella tabella sopra; un valore non numerico o fuori dai limiti è un errore) |
| `dvw-simulator play` | come `generate`, più `--speed N` (default 20), `--min-break N` (pausa minima in secondi reali dopo la fine di un set, default 20), `--mode atomic\|direct` (default `atomic`), `--corrections` |

`--help` mostra l'aiuto. La CLI non espone nomi squadra né `startTime`. Ctrl+C ferma `play`.

## Come si usa / si prova
La CLI gira da `dist/cli.js`: serve prima la build (`docs/infrastruttura.md`).

```bash
# --- variabili ---
RADICE="/percorso/del/repository"   # radice del repository o del worktree del job
FILE_OUT="/tmp/partita-live.dvw"    # file .dvw da scrivere (la cartella viene creata se manca)
SEED="1"                            # seme: stesso seme = stessa partita
SET="3"                             # set da giocare: 3, 4 o 5
VELOCITA="20"                       # accelerazione del tempo (20 = 20 volte più veloce del reale)
MODALITA="atomic"                   # atomic (file temporaneo + rinomina) oppure direct (scrittura diretta in due pezzi)
FORZA_CASA="50"                     # forza della squadra di casa, 0-100 (50 = alla pari)
VARIABILITA="50"                    # variabilità del livello delle squadre, 0-100
ACE="1.5"                           # ace medi per squadra e per set, 0-8
ERRORI_SERVIZIO="3.5"               # errori al servizio medi per squadra e per set, 0-10
MURI="2"                            # muri punto medi per squadra e per set, 0-8
CAMBI="2"                           # cambi medi per squadra e per set, 0-6
TIME_OUT="1.5"                      # time-out medi per squadra e per set, 0-2

# --- comandi ---
cd "$RADICE"
pnpm install
pnpm --filter @arenalive/dvw-simulator build
node tools/dvw-simulator/dist/cli.js play --out "$FILE_OUT" --seed "$SEED" --sets "$SET" \
  --home-strength "$FORZA_CASA" --variability "$VARIABILITA" --aces "$ACE" --serve-errors "$ERRORI_SERVIZIO" \
  --blocks "$MURI" --subs "$CAMBI" --timeouts "$TIME_OUT" \
  --speed "$VELOCITA" --mode "$MODALITA" --corrections
```

Per scrivere subito la partita completa: stesso script, ultima riga
`node tools/dvw-simulator/dist/cli.js generate --out "$FILE_OUT" --seed "$SEED" --sets "$SET"`.
Le opzioni dell'andamento sono tutte facoltative: senza, valgono i default.

Test: `pnpm --filter @arenalive/dvw-simulator test`.

## Riferimenti
- `tools/dvw-simulator/src/generate.ts` (`generateMatch`), `render.ts` (`renderDvw`, `scoutLineText`),
  `correction.ts` (`applyCorrection`), `play.ts` (`play`), `rng.ts` (`Rng`), `cli.ts`, `types.ts` (`MatchProfile`),
  `profile.ts` (`DEFAULT_PROFILE`, `PROFILE_LIMITS`, `resolveProfile`), `roster.ts` (`rosterPlayers`), `names.ts`,
  `schedule.ts` (`planPlayback`)
- Simulazione nel server: `docs/server.md` («Simulazione di una partita»), pagina `docs/portale.md` («Simulazione»)
- Test: `src/simulator.test.ts`, `src/roundtrip.test.ts`, `src/schedule.test.ts`, `src/profile.test.ts`,
  `src/roster.test.ts`; statistiche di `volley-stats` sulla partita della simulazione (anche ace e muri dei giocatori
  della rosa sul numero giusto): `apps/server/test/simulationSource.test.ts`
- Campione: `samples/partita-sintetica.dvw`
- Parser: `docs/dvw-parser.md`; regole del formato: `docs/regole/dvw.md`; strumenti: `docs/infrastruttura.md`
