import type { Evaluation, PlayerRole, Side, Skill } from '@arenalive/dvw-parser';

export type { Side };

/** Rapporto 0-1 arrotondato a 3 decimali, `null` se il denominatore è 0. */
export type Ratio = number | null;

export type MatchStatus = 'notStarted' | 'inProgress' | 'finished';

export interface TeamRef {
  name: string | null;
  code: string | null;
}

export interface PlayerRef {
  number: number;
  firstName: string | null;
  lastName: string | null;
  role: PlayerRole | null;
  /** `L` libero, `C` capitano (campo "ruolo speciale" del file). */
  specialRole: string | null;
}

export interface SetSummary {
  number: number;
  homeScore: number;
  awayScore: number;
  winner: Side | null;
  finished: boolean;
  /** Ora della prima e dell'ultima riga del set (`HH.MM.SS`), se presenti. */
  startTime: string | null;
  endTime: string | null;
  /** Durata in minuti: set chiuso dalla sezione [3SET], altrimenti dalle ore delle righe; `null` se non ricavabile. */
  durationMinutes: number | null;
  /** Time-out e cambi chiamati nel set (righe `T` e `c`). Mancano negli stati salvati prima che esistessero. */
  timeouts: Record<Side, number>;
  substitutions: Record<Side, number>;
}

export interface LastPoint {
  set: number;
  /** Squadra che ha segnato. */
  team: Side;
  homeScore: number;
  awayScore: number;
  /** `attack`/`block`/`serve`: punto diretto; `opponentError`: errore dell'avversario; `greenCode`; `unknown`. */
  kind: 'attack' | 'block' | 'serve' | 'opponentError' | 'greenCode' | 'unknown';
  skill: Skill | null;
  player: number | null;
  /** Squadra del giocatore dell'azione decisiva. */
  playerTeam: Side | null;
  evaluation: Evaluation | null;
  /** Testo breve, es. "attacco #12" oppure "su errore battuta #7" (numero di maglia). */
  label: string;
}

export interface LiveState {
  set: number;
  homeScore: number;
  awayScore: number;
  servingTeam: Side | null;
  /** Posizione (1-6) del palleggiatore. */
  setterPosition: Record<Side, number | null>;
  /** Maglie in posizione 1-6 (`null` = non nota). */
  lineups: Record<Side, (number | null)[]>;
  /** Timeout e cambi usati nel set corrente. */
  timeouts: Record<Side, number>;
  substitutions: Record<Side, number>;
  lastPoint: LastPoint | null;
  /**
   * Ultimi punti della partita descritti come `lastPoint` (al massimo RECENT_POINTS_LIMIT, dal più vecchio, anche dei
   * set precedenti): il portale li mostra uno alla volta quando un aggiornamento ne porta più d'uno. Manca negli
   * stati salvati prima che esistesse.
   */
  recentPoints: LastPoint[];
  /** Serie in corso nel set corrente. */
  run: { team: Side; length: number } | null;
}

export interface StatLine {
  serve: { total: number; aces: number; errors: number; efficiency: Ratio };
  reception: {
    total: number;
    perfect: number;
    positive: number;
    errors: number;
    positivePct: Ratio;
    perfectPct: Ratio;
  };
  attack: {
    total: number;
    kills: number;
    errors: number;
    blocked: number;
    killPct: Ratio;
    efficiency: Ratio;
  };
  block: { kills: number; touches: number };
  dig: { total: number; errors: number };
  /** Attacco # + muro # + battuta #. */
  points: number;
  /** Errori di battuta, ricezione, attacco (= e /), muro, difesa, alzata, free ball. */
  errors: number;
}

export interface PlayerStats {
  number: number;
  total: StatLine;
  /** Chiave = numero del set (stringa). */
  bySet: Record<string, StatLine>;
}

export interface TeamStats {
  total: StatLine;
  bySet: Record<string, StatLine>;
  /** Chiave = numero di maglia (stringa); solo i giocatori con almeno un'azione. */
  players: Record<string, PlayerStats>;
}

export interface MomentumPoint {
  /** Indice della riga `point` nella sezione scout. */
  index: number;
  homeScore: number;
  awayScore: number;
  scorer: Side;
  type: 'breakPoint' | 'sideOut';
  time?: string;
}

export interface MomentumTeam {
  breakPoints: number;
  sideOuts: number;
  /** Rally giocati in battuta / in ricezione (conclusi da un punto). */
  servedRallies: number;
  receivedRallies: number;
  sideOutPct: Ratio;
  breakPointPct: Ratio;
  /** Serie più lunga di punti consecutivi, per set (chiave = numero del set) e in assoluto. */
  longestRunBySet: Record<string, number>;
  longestRun: number;
}

export interface Momentum {
  sets: { set: number; points: MomentumPoint[] }[];
  home: MomentumTeam;
  away: MomentumTeam;
}

export interface RotationStat {
  /** Posizione del palleggiatore (1-6). */
  position: number;
  pointsWon: number;
  pointsLost: number;
  receivedRallies: number;
  servedRallies: number;
  sideOuts: number;
  breakPoints: number;
  sideOutPct: Ratio;
  breakPointPct: Ratio;
}

export interface ZoneCell {
  from: string;
  to: string;
  total: number;
  /** Conteggi per valutazione (`#+!-/=`; `~` = senza valutazione). */
  byEvaluation: Record<string, number>;
}

export interface ZoneMaps {
  attack: ZoneCell[];
  serve: ZoneCell[];
}

export interface TeamZones extends ZoneMaps {
  /** Chiave = numero di maglia (stringa). */
  players: Record<string, ZoneMaps>;
}

/**
 * Fase della partita ricavata solo dalle righe scout (mai dall'orologio), per le pause del portale:
 * - `preMatch`: nessuna azione e nessun punto;
 * - `rally`: si gioca (l'ultima riga di gioco è un'azione o un punto);
 * - `timeout`: dopo l'ultima riga di gioco c'è un time-out (`*T`/`aT`); cambi, rotazioni e palleggiatori scritti dopo
 *   non lo chiudono, la prima azione o il primo punto sì;
 * - `setBreak`: un set è chiuso (`**Nset`) e il successivo non ha ancora azioni né punti (un time-out lo chiude);
 * - `matchEnd`: una squadra ha vinto 3 set.
 */
export type MatchPhase =
  | { kind: 'preMatch' }
  | { kind: 'rally'; set: number }
  | {
      kind: 'timeout';
      set: number;
      /** Squadra che ha chiamato il time-out (l'ultima, se l'hanno chiamato tutte e due). */
      team: Side;
      /** Time-out di quella squadra nel set, questo compreso. */
      teamTimeouts: number;
      homeScore: number;
      awayScore: number;
    }
  | {
      kind: 'setBreak';
      /** Set appena chiuso. */
      set: number;
      nextSet: number;
      winner: Side | null;
      homeScore: number;
      awayScore: number;
    }
  | { kind: 'matchEnd'; winner: Side | null; setsWon: Record<Side, number>; lastSet: number };

export type MatchPhaseKind = MatchPhase['kind'];

/**
 * Eventi della partita per gli avvisi del portale (vedi `detectEvents` in events.ts): punto diretto (`ace`, `block`),
 * punto in attacco (`attack`), serie (`run`), scambio lungo (`longRally`), `setPoint`, `matchPoint`, `tie` (pareggio), `lead` (sorpasso),
 * `timeout`, `substitution`, `setEnd`, `matchEnd`.
 */
export type MatchEventKind =
  | 'ace'
  | 'block'
  | 'attack'
  | 'run'
  | 'longRally'
  | 'setPoint'
  | 'matchPoint'
  | 'tie'
  | 'lead'
  | 'timeout'
  | 'substitution'
  | 'setEnd'
  | 'matchEnd';

/** Giocatore di un evento: numero di maglia e anagrafica, se la maglia è nell'elenco della squadra. */
export interface EventPlayer {
  number: number;
  firstName: string | null;
  lastName: string | null;
}

export interface MatchEvent {
  /** Stabile: lo stesso evento ha lo stesso id a ogni nuovo calcolo dello stato (tipo, set, punteggio o conteggio). */
  id: string;
  kind: MatchEventKind;
  /** Indice della riga scout che l'ha generato. */
  index: number;
  set: number;
  /** Squadra dell'evento (chi segna, chi chiama il time-out, chi vince il set); `null` se nessuna. */
  team: Side | null;
  /** Giocatore dell'ace o del muro, o che entra col cambio. */
  player: EventPlayer | null;
  /** Giocatore che esce col cambio. */
  playerOut: EventPlayer | null;
  /** Punteggio del set dopo l'evento. */
  homeScore: number;
  awayScore: number;
  /** `run`: punti consecutivi; `longRally`: attacchi del rally; altrimenti `null`. */
  count: number | null;
  /** Priorità predefinita 1-10 (più alta = più importante). */
  priority: number;
}

export interface MatchState {
  teams: Record<Side, TeamRef>;
  players: Record<Side, PlayerRef[]>;
  sets: SetSummary[];
  setsWon: Record<Side, number>;
  status: MatchStatus;
  live: LiveState;
  stats: Record<Side, TeamStats>;
  momentum: Momentum;
  rotations: Record<Side, RotationStat[]>;
  zones: Record<Side, TeamZones>;
  /** Fase della partita (pause del portale); manca negli stati salvati prima che esistesse. */
  phase: MatchPhase;
  /** Ultimi eventi (al massimo RECENT_EVENTS_LIMIT), dal più vecchio; manca negli stati salvati prima che esistesse. */
  events: MatchEvent[];
}
