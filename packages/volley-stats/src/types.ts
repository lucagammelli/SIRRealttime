import type { Evaluation, PlayerRole, Side, Skill } from '@sir/dvw-parser';

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
  /** Durata in minuti: dalle ore delle righe, altrimenti dalla sezione [3SET]; `null` se non ricavabile. */
  durationMinutes: number | null;
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
  /** Testo breve, es. "attacco #12" oppure "errore battuta #7" (numero di maglia). */
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
}
