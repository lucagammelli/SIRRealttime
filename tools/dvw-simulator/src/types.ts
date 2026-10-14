/** Player roles: S setter, O opposite, H outside hitter, M middle blocker, L libero. */
export type Role = 'S' | 'O' | 'H' | 'M' | 'L';

export interface SimPlayer {
  number: number;
  id: number;
  lastName: string;
  firstName: string;
  role: Role;
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

export interface GenerateOptions {
  seed: number;
  /** Total number of sets played (3, 4 or 5). Default 3. */
  sets?: 3 | 4 | 5;
  homeName?: string;
  awayName?: string;
  /** ISO UTC start, fixed default so that output is deterministic. */
  startTime?: string;
}
