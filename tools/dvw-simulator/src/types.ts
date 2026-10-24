/** Player roles: S setter, O opposite, H outside hitter, M middle blocker, L libero. */
export type Role = 'S' | 'O' | 'H' | 'M' | 'L';

export interface SimPlayer {
  number: number;
  id: number;
  lastName: string;
  firstName: string;
  role: Role;
}

/**
 * A player of a real roster given to the generator (the club of the client): shirt number 0-99, names, role (null:
 * not known, the generator gives it the role the team needs).
 */
export interface RosterPlayer {
  number: number;
  lastName: string;
  firstName: string;
  role: Role | null;
}

export interface SimTeam {
  name: string;
  code: string;
  coach: string;
  players: SimPlayer[];
}

export type LineKind = 'action' | 'point' | 'rotation' | 'substitution' | 'timeout' | 'setter' | 'endset';

/** One row of the [3SCOUT] section, with the simulated time at which DataVolley would have written it. */
export interface ScoutLine {
  kind: LineKind;
  /** Code, first field of the row (e.g. `*14SH+`). */
  code: string;
  set: number;
  /** Seconds since the start of the match (simulated time). */
  second: number;
  /** Setter position (1-6) of home and away. */
  rotHome: number;
  rotAway: number;
  /** Home P1..P6 then away P1..P6 jersey numbers. */
  positions: number[];
  /** Point phase flag: `s` when the acting team serves in this rally, `r` when it receives (actions only). */
  phase?: 's' | 'r';
  /** Score after the point (only for kind `point`). */
  score?: [number, number];
}

export interface SimSet {
  number: number;
  home: number;
  away: number;
  /** Starting lineups, P1..P6 jersey numbers. */
  startHome: number[];
  startAway: number[];
}

export interface GeneratedMatch {
  seed: number;
  /** Start of the match, ISO UTC string. */
  startTime: string;
  home: SimTeam;
  away: SimTeam;
  sets: SimSet[];
  lines: ScoutLine[];
}

/**
 * How the match goes. Targets on average, not exact counts: every set is played rally by rally.
 * The counts are per team and per set.
 */
export interface MatchProfile {
  /** Strength of the home team against the away team, 0-100: 50 on a par, 100 home far stronger. */
  homeStrength: number;
  /** How much the level of the teams changes from set to set and within a set, 0-100 (0: always the same). */
  variability: number;
  acesPerSet: number;
  serveErrorsPerSet: number;
  /** Block points. */
  blocksPerSet: number;
  /** Substitutions (at most 6 per team and set, as in the rules). */
  substitutionsPerSet: number;
  /** Time-outs (at most 2 per team and set). */
  timeoutsPerSet: number;
}

export interface GenerateOptions {
  seed: number;
  /** Total number of sets played (3, 4 or 5). Default 3. */
  sets?: 3 | 4 | 5;
  homeName?: string;
  awayName?: string;
  /** Team codes of `[3TEAMS]`; missing: the first three letters of the name. */
  homeCode?: string;
  awayCode?: string;
  /**
   * Real roster of the home or away team (`rosterPlayers`): its players with their numbers, completed by generated
   * players (numbers not used) when roles or players are missing. Missing: every player generated.
   */
  homeRoster?: readonly RosterPlayer[];
  awayRoster?: readonly RosterPlayer[];
  /** ISO UTC start, fixed default so that output is deterministic. */
  startTime?: string;
  /** How the match goes; missing fields take `DEFAULT_PROFILE`. */
  profile?: Partial<MatchProfile>;
}
