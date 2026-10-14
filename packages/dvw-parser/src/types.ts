export type Side = 'home' | 'away';

export type Skill = 'serve' | 'reception' | 'attack' | 'block' | 'dig' | 'set' | 'freeball';
export type HitType = 'H' | 'M' | 'Q' | 'T' | 'U' | 'N' | 'O';
export type Evaluation = '#' | '+' | '!' | '-' | '/' | '=';

/**
 * Campi dopo il codice di una riga scout (formato DataVolley 4, indice 0 = codice):
 * 1-3 flag, 4-6 coordinate, 7 ora, 8 set, 9-10 posizione palleggiatore, 11 file video, 12 tempo video,
 * 14-19 giocatori di casa in posizione 1-6, 20-25 giocatori ospiti in posizione 1-6. Tutti opzionali.
 */
export interface ScoutFields {
  /** Fase del punto (campo 1): `s` = side-out/battuta, `r` = ricezione. */
  pointPhase?: string | undefined;
  /** Fase dell'attacco (campo 2). */
  attackPhase?: string | undefined;
  /** Terzo flag (campo 3), non interpretato. */
  flag3?: string | undefined;
  /** Coordinate a 4 cifre (campi 4, 5, 6). */
  startCoordinate?: string | undefined;
  midCoordinate?: string | undefined;
  endCoordinate?: string | undefined;
  /** Ora `HH.MM.SS` come scritta nel file. */
  time?: string | undefined;
  set?: number | undefined;
  homeSetterPosition?: number | undefined;
  awaySetterPosition?: number | undefined;
  videoFile?: number | undefined;
  /** Tempo video in secondi. */
  videoTime?: number | undefined;
  /** Giocatori di casa in posizione 1-6 (sempre 6 elementi, `undefined` se vuoto). */
  homeLineup: (number | undefined)[];
  /** Giocatori ospiti in posizione 1-6 (sempre 6 elementi). */
  awayLineup: (number | undefined)[];
}

interface ScoutBase extends ScoutFields {
  /** Posizione della riga nella sezione [3SCOUT] (0-based, righe vuote escluse). */
  index: number;
  rawLine: string;
  /** Codice (primo campo) della riga, suffisso `>...` incluso. */
  code: string;
  /** Suffisso `>...` del codice (es. `>LUp`), se presente. */
  suffix?: string | undefined;
}

export interface ActionEntry extends ScoutBase {
  kind: 'action';
  team: Side;
  player: number;
  skill: Skill;
  hitType?: HitType | undefined;
  evaluation?: Evaluation | undefined;
  combination?: string | undefined;
  /** Target dell'alzata (es. F, C, B, P, S). */
  setTarget?: string | undefined;
  startZone?: string | undefined;
  endZone?: string | undefined;
  endSubZone?: string | undefined;
  skillType?: string | undefined;
  playersCount?: string | undefined;
  extra?: string | undefined;
}
export interface PointEntry extends ScoutBase {
  kind: 'point';
  team: Side;
  homeScore: number;
  awayScore: number;
}
export interface RotationEntry extends ScoutBase {
  kind: 'rotation';
  team: Side;
  number: number;
}
export interface SubstitutionEntry extends ScoutBase {
  kind: 'substitution';
  team: Side;
  out: number;
  in: number;
}
export interface TimeoutEntry extends ScoutBase {
  kind: 'timeout';
  team: Side;
}
export interface SetterEntry extends ScoutBase {
  kind: 'setter';
  team: Side;
  number: number;
}
export interface SetEndEntry extends ScoutBase {
  kind: 'setEnd';
  setNumber: number;
}
/** Codice "verde" (`*$$&H#`): punto concesso/assegnato senza azione di un giocatore. */
export interface GreenCodeEntry extends ScoutBase {
  kind: 'greenCode';
  team: Side;
  /** Carattere dopo `$$` (es. `&`). */
  symbol: string;
  /** Il resto del codice (es. `H#`). */
  detail: string;
}
export interface UnknownEntry extends ScoutBase {
  kind: 'unknown';
  team?: Side | undefined;
}

export type ScoutEntry =
  | ActionEntry
  | PointEntry
  | RotationEntry
  | SubstitutionEntry
  | TimeoutEntry
  | SetterEntry
  | SetEndEntry
  | GreenCodeEntry
  | UnknownEntry;

export interface MatchInfo {
  date?: string | undefined;
  time?: string | undefined;
  season?: string | undefined;
  league?: string | undefined;
  extra: string[];
}

export interface TeamInfo {
  code?: string | undefined;
  name?: string | undefined;
  setsWon?: number | undefined;
  coach?: string | undefined;
  extra: string[];
}

export type PlayerRole = 'libero' | 'outside' | 'opposite' | 'middle' | 'setter';

/** Riga di [3PLAYERS-*] (DV4): squadra;maglia;indice;posizioni set 1-5;id;cognome;nome;soprannome;ruolo speciale;ruolo. */
export interface PlayerInfo {
  /** 0 = casa, 1 = ospite (campo 0). */
  teamIndex?: number | undefined;
  number?: number | undefined;
  index?: number | undefined;
  /** Posizione di partenza nei set 1-5 (`undefined` se in panchina, `*`). */
  startPositions: (number | undefined)[];
  id?: string | undefined;
  lastName?: string | undefined;
  firstName?: string | undefined;
  nickname?: string | undefined;
  /** Ruolo speciale: `L` libero, `C` capitano. */
  specialRole?: string | undefined;
  /** Codice ruolo grezzo: 1 libero, 2 schiacciatore, 3 opposto, 4 centrale, 5 palleggiatore. */
  roleCode?: string | undefined;
  role?: PlayerRole | undefined;
  extra: string[];
}

export interface SetInfo {
  /** Numero del set (1-based, posizione della riga). */
  number: number;
  /** Parziali (es. "8-6") come scritti. */
  partials: string[];
  finalScore?: string | undefined;
  /** Durata in minuti, se presente. */
  minutes?: number | undefined;
  /** `True`/`False` (set concluso) se presente. */
  finished?: boolean | undefined;
  homeScore?: number | undefined;
  awayScore?: number | undefined;
  extra: string[];
}

export interface ParsedMatch {
  match: MatchInfo;
  home?: TeamInfo | undefined;
  away?: TeamInfo | undefined;
  homePlayers: PlayerInfo[];
  awayPlayers: PlayerInfo[];
  sets: SetInfo[];
  scout: ScoutEntry[];
  /** Testo grezzo (righe unite con \n) di ogni sezione, chiave = nome senza `[3` e `]`. */
  rawSections: Record<string, string>;
  warnings: string[];
}
