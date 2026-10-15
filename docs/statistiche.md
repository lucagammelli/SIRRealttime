# Statistiche (`packages/volley-stats`)

## A cosa serve
Unica fonte dei calcoli di partita, usata sia dal server sia dal portale: i numeri mostrati sono sempre gli stessi.
`computeMatchState(parsed: ParsedMatch): MatchState` è una funzione pura e deterministica: prende l'output del parser
(`docs/dvw-parser.md`) e restituisce lo stato completo. Il risultato è JSON-serializzabile (`null` al posto di
`undefined`) e la funzione non lancia per input parziali o malformati. Fase 3 di `docs/piano.md`.

## Come funziona
Il calcolo riparte da zero a ogni aggiornamento (nessuno stato conservato tra due chiamate).

### Struttura di `MatchState`
- `teams`: `{ home, away }` con `name`, `code`.
- `players`: elenco per squadra (`number`, `firstName`, `lastName`, `role`, `specialRole`).
- `sets[]`: `number`, `homeScore`, `awayScore`, `winner`, `finished`, `startTime`, `endTime`, `durationMinutes`.
- `setsWon`: set vinti per squadra.
- `status`: `notStarted` | `inProgress` | `finished`.
- `live`: set corrente, punteggio, `servingTeam`, `setterPosition`, `lineups`, `timeouts`, `substitutions`,
  `lastPoint`, `run`.
- `stats`: per squadra `total`, `bySet`, `players` (righe `StatLine`).
- `momentum`: `sets[]` punto per punto, più `home` e `away` (break point, side-out, serie più lunghe).
- `rotations`: per squadra, 6 righe (posizione 1-6 del palleggiatore).
- `zones`: per squadra mappe `attack` e `serve` (celle partenza → arrivo), anche per giocatore in `players`.

### Regole di calcolo
- **Punteggio**: solo dalle righe `point`; mai dal conteggio delle azioni.
- **Set di una riga**: il campo `set` della riga; se manca, il set corrente, che avanza dopo `**Nset`. Valori fuori
  da 1..5 sono ignorati. La riga `**Nset` appartiene sempre al set N: nei file reali il suo campo `set` contiene già
  il set successivo, che quindi compare solo con la sua prima riga.
- **Set concluso**: se c'è `setEnd` oppure esiste un set successivo. Il vincitore è chi ha il punteggio più alto.
- **Durata**: set chiuso → minuti di `[3SET]` (durata ufficiale di DataVolley, senza le pause); set in corso o senza
  quel valore → dalle ore delle righe. Un passo indietro dell'ora oltre 12 ore è la mezzanotte; quelli brevi (la
  rotazione scritta qualche secondo prima del punto) si ignorano.
- **`status`**: `notStarted` senza azioni né punti; `inProgress` appena c'è una riga; `finished` con 3 set vinti.
- **Squadra al servizio** (`live.servingTeam`): chi ha vinto l'ultimo punto; una battuta scritta dopo prevale; dopo la
  fine di un set è `null` fino alla prima battuta del set seguente.
- **Break point / side-out**: server = squadra dell'ultima battuta del rally; se manca, la fase `s`/`r` delle azioni;
  se manca anche quella, il punto è un side-out. Break point se segna chi serve.
- **Formule** (simboli: valutazioni DataVolley):
  - battuta: efficienza = (`#` − `=`) / totale;
  - ricezione: positiva = (`#` + `+`) / totale; perfetta = `#` / totale;
  - attacco: % punti = `#` / totale; efficienza = (`#` − `=` − `/`) / totale;
  - % side-out = side-out / rally giocati in ricezione; % break point = break point / rally giocati in battuta.
- **Rapporti**: frazioni 0-1 a 3 decimali, `null` se il totale è 0.
- **Errori** = `=` di ogni fondamentale + attacco `/` (murato) + muro `/` (invasione, contata come errore).
  Ricezione `/` e battuta `/` non sono errori.
- **Punti** = attacco `#` + muro `#` + battuta `#`.
- **`stats.players`**: solo i giocatori con almeno un'azione.
- **Ultimo punto** (`live.lastPoint`): etichette in quest'ordine: azione `#` di chi segna (battuta, attacco, muro),
  errore dell'avversario (`=` o `/`), codice verde, altrimenti `punto`.
- **Posizione del palleggiatore**: dalla riga `point`, valida se 1..6, altrimenti `null`.
- **Zone**: solo attacco e battuta con zone di partenza e arrivo valide (1-9); la valutazione assente è contata come `~`.

## Configurazione
Nessuna: nessuna variabile né file di config.

## Come si usa / si prova
```bash
# Radice del repository (o del worktree del job)
cd /home/athena/SIRRealttime
pnpm --filter @sir/volley-stats typecheck
pnpm --filter @sir/volley-stats test
```
Uso: `import { computeMatchState } from '@sir/volley-stats'` e `computeMatchState(parsed)` con il risultato del parser.

Verifiche fatte:
- test sui seed del simulatore (`packages/volley-stats/src/index.test.ts`);
- fuzz del supervisore su 3000 file: nessuna eccezione;
- prestazioni: circa 2,5 ms su 1263 righe.

## Da confermare con Luca
- Significato di battuta `/` (oggi non è un errore).
- Conteggio degli errori di alzata e free ball (oggi: ogni `=` conta come errore).

## Riferimenti
- `packages/volley-stats/src/index.ts`: `computeMatchState`.
- `packages/volley-stats/src/types.ts`: tipi (`MatchState`, `StatLine`, `LiveState`, ...).
- `packages/volley-stats/src/timeline.ts`: `buildTimeline` (set di riga, servizio, punti, rally).
- `packages/volley-stats/src/score.ts`: `computeSets`, `computeSetsWon`, `computeStatus`, `computeLive`.
- `packages/volley-stats/src/stats.ts`: `computeStats`.
- `packages/volley-stats/src/momentum.ts`: `computeMomentum`, `pointType`, `effectiveServer`.
- `packages/volley-stats/src/rotations.ts`: `computeRotations`.
- `packages/volley-stats/src/zones.ts`: `computeZones`.
- `packages/volley-stats/src/util.ts`: `ratio`, `timeToSeconds`.
- Parser e tipi di ingresso: `docs/dvw-parser.md`; piano: `docs/piano.md` §2.
