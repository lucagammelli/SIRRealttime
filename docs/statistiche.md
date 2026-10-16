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
- `phase` (`MatchPhase`): fase della partita per le pause del portale, vedi «Fase della partita».
- `events` (`MatchEvent[]`): gli ultimi 20 eventi (`RECENT_EVENTS_LIMIT`) per gli avvisi del portale, vedi «Eventi della
  partita».

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
- **Migliori giocatori** (`topPlayers(state, { limit, team? })`, usata dal blocco «Migliori giocatori» del portale): funzione
  pura che parte da `stats` e `players` già calcolati. Entrano solo i giocatori con almeno un punto (punti come sopra);
  ordine: più punti, poi più attacchi vincenti, poi meno errori, poi la squadra di casa, poi il numero di maglia più basso
  (ordine sempre uguale). `team` è `home`, `away` o `both` (predefinito); `limit` taglia l'elenco. Ogni voce ha squadra,
  maglia, anagrafica (`null` se la maglia non è nell'elenco), punti, attacchi vincenti, muri vincenti, ace ed errori.

### Fase della partita (`phase`, `computePhase` in `phase.ts`)
Dice al portale se si sta giocando o se c'è una pausa (`docs/portale.md`, «Pause della partita»). Si ricava **solo dalle
righe del `.dvw`**: nessun orologio, quindi è deterministica e uguale per tutti gli spettatori. I tipi sono in
`types.ts`.

| `kind` | Quando | Dati |
|---|---|---|
| `preMatch` | nessuna azione né punto (`status` `notStarted`) | - |
| `rally` | l'ultima riga di gioco (azione o punto) è la più recente | `set` |
| `timeout` | dopo l'ultima azione o punto, e dopo l'ultimo `**Nset`, c'è una riga time-out (`*T`/`aT`) | `set`, `team` (chi l'ha chiamato; l'ultimo se l'hanno chiamato tutte e due), `teamTimeouts` (numero del time-out di quella squadra nel set, questo compreso), `homeScore`, `awayScore` |
| `setBreak` | un set è chiuso da `**Nset` e dopo non c'è alcuna azione o punto | `set` (appena chiuso), `nextSet`, `winner`, `homeScore`, `awayScore` |
| `matchEnd` | `status` `finished` | `winner`, `setsWon`, `lastSet` |

- **Chiusura della pausa**: la chiude la prima azione o il primo punto dopo. DataVolley scrive rally e punto insieme, quindi
  il ritorno al gioco è netto. Cambi, rotazioni, palleggiatori, codici verdi e righe illeggibili (`unknown`, anche l'ultima
  riga troncata di un file salvato a metà) **non** cambiano la fase.
- **Fine set**: vale solo con il set davvero chiuso (`tl.endedSets`). Un time-out dopo `**Nset` sostituisce la pausa di fine
  set fino alla prima azione.
- **Fine partita**: solo con `**Nset` e 3 set vinti (`status` `finished`), quindi vale anche per il 15-13 al quinto set e per
  i vantaggi.

### Eventi della partita (`events`, `detectEvents` in `events.ts`)
Alimentano gli avvisi del portale (`docs/portale.md`, «Avvisi sugli eventi»). Sono calcolati qui, dalle sole righe del
`.dvw`, perché il portale non ha le azioni del rally. `detectEvents(tl, players)` è pura e non lancia: riusa
`buildTimeline` e `describePoint` (esportata da `score.ts`) e i nomi dei giocatori di `playerRefs` (`players.ts`).
`computeMatchState` mette in `MatchState.events` solo gli ultimi 20. Ogni `MatchEvent` ha `id`, `kind`, `index` (riga
scout), `set`, `team`, `player`, `playerOut`, `homeScore`, `awayScore` (dopo l'evento), `count` e `priority` (1-10,
`MATCH_EVENT_PRIORITY`).

| `kind` | Quando | `team` / dati |
|---|---|---|
| `ace` | punto diretto in battuta (`#`) | squadra che segna, `player` |
| `block` | punto diretto a muro (`#`) | squadra che segna, `player` |
| `run` | dal 3° punto di fila (`RUN_MIN_POINTS`) e poi a ogni punto in più | squadra che segna, `count` = punti di fila |
| `longRally` | rally con almeno 4 attacchi (`LONG_RALLY_MIN_ATTACKS`; le alzate non sono sempre registrate, quindi si contano gli attacchi) | squadra che segna, `count` = attacchi |
| `setPoint` / `matchPoint` | una squadra arriva a un punto dal set; `matchPoint` se ha già 2 set vinti | la squadra col set point |
| `tie` | pareggio dal 15-15 (9-9 al tie-break) o dopo una rimonta di 3 punti (`COMEBACK_MIN_POINTS`) | squadra che pareggia |
| `lead` | sorpasso, con la stessa soglia del pareggio | squadra che passa avanti |
| `timeout` | riga time-out | squadra che lo chiama |
| `substitution` | riga cambio | `player` entra, `playerOut` esce |
| `setEnd` | riga `**Nset` | squadra che vince il set |
| `matchEnd` | `**Nset` che dà il 3° set vinto (al posto di `setEnd`, come la fase `matchEnd`) | squadra che vince |

- **Set point / match point** (`setPointTeam(set, home, away)`): solo quando la situazione nasce. 24-20 sì; 24-21 no (era già
  set point); 25-24 dopo il 24-24 sì di nuovo. Valgono anche ai vantaggi e al tie-break (set a 15). Con due set pari il
  match point può nascere per entrambe.
- **Sorpasso**: vale solo se passa avanti chi era dietro prima del pareggio; il pareggio e il sorpasso a punteggi bassi si
  segnalano solo dopo una rimonta di 3 punti.
- **Id stabili**: tipo + set + punteggio (`ace-2-14-9`), il time-out col conteggio della squadra nel set, `matchEnd` senza
  altro. Rileggendo lo stesso file, o con righe in più, gli stessi eventi hanno lo stesso id: il portale li riconosce.
- **Priorità predefinita** (la più alta si mostra prima): `matchEnd` 10, `matchPoint` 9, `setEnd` 8, `setPoint` 7, `ace` e
  `block` 6, `lead` 5, `tie`, `run` e `timeout` 4, `longRally` 3, `substitution` 2.
- Un set nuovo senza `**Nset` per il precedente conta come chiuso per i set vinti, senza evento.

### Riepilogo del set e MVP (`recap.ts`)
- `setRecap(state, set)`: funzione pura sul solo set `set` (null se il set non c'è). Dà punteggio ufficiale (righe `point`),
  `winner`, `finished`, `durationMinutes`, le statistiche di squadra **del solo set** (`teams`, righe `StatLine`) e il
  migliore del set (`best`, il primo di `topPlayers` sulle statistiche del solo set; null senza punti).
  `emptyStatLine()` (`stats.ts`) dà la riga a zero per un set senza azioni di una squadra.
- `matchMvp(state)`: funzione pura, deterministica. Candidati: i giocatori della squadra vincitrice a partita finita;
  altrimenti, o se nessuno dei vincitori ha punti, quelli di tutte e due le squadre; solo chi ha almeno un punto. Ordine: più
  punti, poi migliore efficienza d'attacco (chi non ha attacchi conta meno di tutti), poi meno errori, poi la squadra di
  casa, poi il numero di maglia più basso. Ogni `Mvp` estende la voce di `topPlayers` con `attackTotal` e
  `attackEfficiency`. Null se nessuno ha punti.

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
- `packages/volley-stats/src/leaders.ts`: `topPlayers` (test in `leaders.test.ts`); blocco del portale in `docs/portale.md`.
- `packages/volley-stats/src/phase.ts`: `computePhase` (test in `phase.test.ts`); tipi `MatchPhase`, `MatchPhaseKind` in `types.ts`.
- `packages/volley-stats/src/recap.ts`: `setRecap`, `matchMvp`, tipi `SetRecap`, `Mvp` (test in `recap.test.ts`); schermate in
  `docs/portale.md`, configurazione in `docs/architettura.md`.
- `packages/volley-stats/src/events.ts`: `detectEvents`, `recentEvents`, `matchEvents`, `setPointTeam`, `MATCH_EVENT_KINDS`,
  `MATCH_EVENT_PRIORITY` (test in `events.test.ts`); tipi `MatchEvent`, `MatchEventKind`, `EventPlayer` in `types.ts`,
  `playerRefs` in `players.ts`; avvisi in `docs/portale.md`, configurazione in `docs/architettura.md`.
- `packages/volley-stats/src/util.ts`: `ratio`, `timeToSeconds`.
- Parser e tipi di ingresso: `docs/dvw-parser.md`; piano: `docs/piano.md` §2.
