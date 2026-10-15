# Parser DVW

## A cosa serve
`@sir/dvw-parser` (`packages/dvw-parser/`) trasforma un file di scout DataVolley (`.dvw`) in un oggetto `ParsedMatch`
con partita, squadre, giocatori, set e righe di scout interpretate. È una funzione pura: nessun I/O, nessuna
eccezione per righe malformate. Il formato è descritto in `docs/regole/dvw.md`; i file di prova li genera
`docs/simulatore.md`.

## Come funziona

### API (`packages/dvw-parser/src/index.ts`)
- `parseDvw(input: Uint8Array | string): ParsedMatch`: se riceve byte li decodifica con `decodeDvw`, divide in sezioni
  `[3NOME]`, interpreta MATCH, TEAMS, PLAYERS-H, PLAYERS-V, SET e SCOUT.
- `decodeDvw(bytes: Uint8Array): string`: con BOM UTF-8 decodifica in UTF-8 non-fatal (byte non validi o troncati
  diventano U+FFFD, utile con file ancora in scrittura); senza BOM usa UTF-8 se valido, altrimenti Windows-1252
  (`iconv-lite`).
- `extractScoutLines(text: string): string[]`: righe grezze non vuote della sezione `[3SCOUT]`.
- `parseScoutLine(rawLine, index, warnings): ScoutEntry`: interpreta una riga scout.
- Fine riga CRLF, LF e CR sono accettati; un BOM iniziale viene ignorato.

### `ParsedMatch` (`src/types.ts`)
| Campo | Contenuto |
|---|---|
| `match` | `MatchInfo`: `date`, `time`, `season`, `league`, `extra[]` (dalla prima riga di `[3MATCH]`) |
| `home`, `away` | `TeamInfo`: `code`, `name`, `setsWon`, `coach`, `extra[]` (prime due righe di `[3TEAMS]`) |
| `homePlayers`, `awayPlayers` | `PlayerInfo[]` da `[3PLAYERS-H]` / `[3PLAYERS-V]` |
| `sets` | `SetInfo[]`: `number`, `partials[]`, `finalScore`, `minutes`, `finished`, `homeScore`, `awayScore`, `extra[]` |
| `scout` | `ScoutEntry[]` |
| `rawSections` | testo grezzo di ogni sezione, chiave = nome senza `[3` e `]` (anche le sezioni sconosciute) |
| `warnings` | avvisi in italiano (sezione mancante, codice non riconosciuto, tipo o valutazione non validi) |

### `ScoutEntry`: varianti (campo `kind`)
Tutte hanno `index` (posizione nella sezione, righe vuote escluse), `rawLine`, `code` (suffisso incluso), `suffix?` e i
campi dopo il codice (sotto).

| `kind` | Campi specifici | Codice |
|---|---|---|
| `action` | `team`, `player`, `skill` (`serve reception attack block dig set freeball`), `hitType?`, `evaluation?`, `combination?`, `setTarget?`, `startZone?`, `endZone?`, `endSubZone?`, `skillType?`, `playersCount?`, `extra?` | `*05AH#...` |
| `point` | `team`, `homeScore`, `awayScore` | `*p12:10` |
| `rotation` | `team`, `number` | `*z3` |
| `substitution` | `team`, `out`, `in` | `*c05:09` |
| `timeout` | `team` | `*T` |
| `setter` | `team`, `number` | `*P05` |
| `setEnd` | `setNumber` | `**1set` |
| `greenCode` | `team`, `symbol`, `detail` | `*$$&H#` |
| `unknown` | `team?` | qualunque altro |

`team` è `home` (`*`) o `away` (`a`). Il punteggio ufficiale viene dalle righe `point`, non dal conteggio delle azioni.

### Layout DV4 della riga scout
Campi separati da `;`, indice 0 = codice. Gli altri sono tutti opzionali.

| Indice | Campo in `ScoutEntry` |
|---|---|
| 0 | `code` |
| 1 | `pointPhase` (fase del punto: `s` battuta/side-out, `r` ricezione) |
| 2 | `attackPhase` (fase dell'attacco) |
| 3 | `flag3` (non interpretato) |
| 4, 5, 6 | `startCoordinate`, `midCoordinate`, `endCoordinate` (4 cifre) |
| 7 | `time` (`HH.MM.SS`) |
| 8 | `set` |
| 9, 10 | `homeSetterPosition`, `awaySetterPosition` (posizione dei palleggiatori) |
| 11 | `videoFile` |
| 12 | `videoTime` (secondi) |
| 13 | vuoto |
| 14-19 | `homeLineup`: giocatori di casa in posizione 1-6 (sempre 6 elementi) |
| 20-25 | `awayLineup`: giocatori ospiti in posizione 1-6 (sempre 6 elementi) |

Riga d'esempio (coperta da un test):
`a05SM-~~~16A;s;;;0328;;8275;15.08.45;1;1;6;1;180;;7;14;18;2;17;12;6;8;5;3;9;11;`
dà squadra ospite, giocatore 5, battuta, tipo `M`, valutazione `-`, zona di partenza 1, arrivo 6, sottozona `A`,
fase `s`, coordinate `0328` e `8275`, ora `15.08.45`, set 1, palleggiatori in posizione 1 (casa) e 6 (ospiti), video 1
a 180 s, casa `[7,14,18,2,17,12]`, ospiti `[6,8,5,3,9,11]`.

### Caratteri del codice d'azione
Posizioni 1-based; `~` o carattere mancante = campo assente.

| Car. | Campo |
|---|---|
| 1 | squadra (`*` casa, `a` ospiti) |
| 2-3 | numero di maglia |
| 4 | fondamentale (`S R A B D E F`) |
| 5 | tipo (`H M Q T U N O`) → `hitType` |
| 6 | valutazione (`# + ! - / =`) → `evaluation` |
| 7-8 | combinazione / chiamata → `combination` |
| 9 | target dell'alzata → `setTarget` |
| 10 | zona di partenza → `startZone` |
| 11 | zona di arrivo → `endZone` |
| 12 | sottozona → `endSubZone` |
| 13 | tipo di fondamentale → `skillType` |
| 14 | numero di giocatori → `playersCount` |
| 15 in poi | `extra` |

- Suffisso `>...` (es. `*P05>LUp`, `*z3>LUp`): salvato in `suffix`, il resto del codice si interpreta normalmente.
- Codici verdi `*$$&H#` → `greenCode` (`symbol` = carattere dopo `$$`, `detail` = il resto).
- Altri codici: `*p`/`ap` punto, `*z`/`az` rotazione, `*c`/`ac` cambio, `*T`/`aT` timeout, `*P`/`aP` palleggiatore in
  campo, `**Nset` fine set.

### Giocatori `[3PLAYERS-H]` / `[3PLAYERS-V]` (DV4)
| Indice | Campo `PlayerInfo` |
|---|---|
| 0 | `teamIndex` (0 casa, 1 ospiti) |
| 1 | `number` (maglia) |
| 2 | `index` |
| 3-7 | `startPositions`: posizione di partenza nei set 1-5 (`*` = panchina → `undefined`) |
| 8 | `id` |
| 9, 10, 11 | `lastName`, `firstName`, `nickname` |
| 12 | `specialRole` (`L` libero, `C` capitano) |
| 13 | `roleCode` → `role`: 1 `libero`, 2 `outside`, 3 `opposite`, 4 `middle`, 5 `setter` |
| 14 in poi | `extra` (solo celle non vuote) |

### `[3SET]`
Una riga per set: `True|False;parziali;finale;minuti` (flag di set concluso, parziali tipo `8-6`, risultato finale,
durata in minuti; celle vuote = non giocato). Verificato su file reali: gli spazi nelle celle si tolgono (`8 -3` →
`8-3`) e `True` su una riga senza punteggi (set non giocato) dà `finished: false`.

### Robustezza
- Nessuna eccezione: una riga non riconosciuta diventa `{ kind: 'unknown', rawLine, ... }` più un avviso in `warnings`.
- Sezioni mancanti (`MATCH`, `TEAMS`, `SCOUT`) → avviso; sezioni sconosciute ignorate ma conservate in `rawSections`.
- Valori non numerici nei campi numerici → `undefined`.
- Lo sviluppatore ha verificato la robustezza con un fuzz di 15.000 input casuali (nessuna eccezione); il fuzz non è
  nei test del repository, che coprono invece byte troncati, BOM non validi e righe malformate.

## Configurazione
Nessuna. Dipendenza: `iconv-lite`.

## Come si usa / si prova
```bash
# --- variabili ---
RADICE="/percorso/del/repository"   # radice del repository o del worktree del job
FILE_DVW="samples/partita-sintetica.dvw"   # file .dvw da leggere (relativo alla radice)

# --- comandi ---
cd "$RADICE"
pnpm --filter @sir/dvw-parser test
pnpm --filter @sir/dvw-parser build
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { parseDvw } from './packages/dvw-parser/dist/index.js';
const m = parseDvw(readFileSync(process.argv[1]));
console.log(m.home?.name, m.away?.name, m.scout.length, 'righe,', m.warnings.length, 'avvisi');
" "$FILE_DVW"
```

## Verifica con file DataVolley reali
Il 2026-10-15 sono stati letti due file veri di DataVolley 4.03 (amichevoli della Sir Susa Scai Perugia, uno completo
3-0 e un backup a set 1 chiuso; non sono nel repository). Risultato: nessuna riga `unknown`, nessun avviso; squadre,
giocatori, ruoli, `[3SET]`, codici verdi `$$&`, suffissi `>LUp`, campi di fase `s`/`r`/`p` e zone 1-9 letti come
previsto. Differenze trovate e gestite: parziali con spazi in `[3SET]`, `True` sui set non giocati, campo `set` della
riga `**Nset` già sul set successivo (`docs/statistiche.md`), ore non sempre crescenti. Restano da capire i campi dopo
il quarto di `[3MATCH]` e le celle esadecimali (`2416D69...`, i testi ricodificati) di `[3TEAMS]` e dei giocatori,
che finiscono in `extra`.

## Riferimenti
- `packages/dvw-parser/src/index.ts` (`parseDvw`, `extractScoutLines`), `src/decode.ts` (`decodeDvw`),
  `src/scout.ts` (`parseScoutLine`), `src/sections.ts` (sezioni), `src/types.ts` (tipi)
- Test: `packages/dvw-parser/test/parser.test.ts`, fixture `packages/dvw-parser/test/fixtures/partita.dvw`
- Regole del formato: `docs/regole/dvw.md`; generatore di file: `docs/simulatore.md`; strumenti: `docs/infrastruttura.md`
