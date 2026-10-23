# Simulatore DataVolley

## A cosa serve
`@arenalive/dvw-simulator` (`tools/dvw-simulator/`) genera partite sintetiche coerenti e le "suona" nel tempo scrivendo un file
`.dvw` come farebbe DataVolley, così agente, server e portale si provano senza un file vero né un computer di
scout. Il formato scritto è quello letto da `docs/dvw-parser.md`.

## Come funziona
- **Generazione** (`generateMatch`): partita deterministica; stesso seme e stesse opzioni, stesso risultato. Usa il
  PRNG mulberry32 (`src/rng.ts`, classe `Rng`), mai `Math.random`. Squadre da 12-14 giocatori, set a 25 (il quinto a 15)
  con scarto di 2, rotazioni, cambi, timeout, alternanza della battuta; l'esito dei set è deciso dal seme.
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
  «Casuale» della pagina «Simulazione», `generateMatch`, `renderDvw` e `DEFAULT_AWAY_NAME`. Non ci sono partite di
  esempio già pronte: le sorgenti sono solo «Casuale» e il file `.dvw` caricato.
- Il test di andata e ritorno (`src/roundtrip.test.ts`) genera partite con 3, 4 e 5 set, le scrive, le rilegge con
  `parseDvw` e verifica: nessun avviso né `unknown`, righe e codici identici, punteggi, set, squadre e giocatori.
- Il campione `samples/partita-sintetica.dvw` è `generateMatch({ seed: 1 })` con 3 set: 982 righe di scout.

## API (`tools/dvw-simulator/src/index.ts`)
- `generateMatch({ seed, sets?, homeName?, awayName?, startTime? }): GeneratedMatch`. `sets` è 3, 4 o 5 (default 3);
  `startTime` è ISO UTC (default `2025-01-18T18:00:00Z`, `DEFAULT_START_TIME`); nomi di default
  `DEFAULT_HOME_NAME` e `DEFAULT_AWAY_NAME`.
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
| `dvw-simulator generate` | `--out <file>` (obbligatoria), `--seed N` (default 1), `--sets N` (3, 4 o 5; default 3) |
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

# --- comandi ---
cd "$RADICE"
pnpm install
pnpm --filter @arenalive/dvw-simulator build
node tools/dvw-simulator/dist/cli.js play --out "$FILE_OUT" --seed "$SEED" --sets "$SET" \
  --speed "$VELOCITA" --mode "$MODALITA" --corrections
```

Per scrivere subito la partita completa: stesso script, ultima riga
`node tools/dvw-simulator/dist/cli.js generate --out "$FILE_OUT" --seed "$SEED" --sets "$SET"`.
Per rigenerare il campione: `--out samples/partita-sintetica.dvw --seed 1 --sets 3`.

Test: `pnpm --filter @arenalive/dvw-simulator test`.

## Riferimenti
- `tools/dvw-simulator/src/generate.ts` (`generateMatch`), `render.ts` (`renderDvw`, `scoutLineText`),
  `correction.ts` (`applyCorrection`), `play.ts` (`play`), `rng.ts` (`Rng`), `cli.ts`, `types.ts`, `names.ts`,
  `schedule.ts` (`planPlayback`)
- Simulazione nel server: `docs/server.md` («Simulazione di una partita»), pagina `docs/portale.md` («Simulazione»)
- Test: `src/simulator.test.ts`, `src/roundtrip.test.ts`, `src/schedule.test.ts`
- Campione: `samples/partita-sintetica.dvw`
- Parser: `docs/dvw-parser.md`; regole del formato: `docs/regole/dvw.md`; strumenti: `docs/infrastruttura.md`
