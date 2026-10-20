import type { MatchState, PlayerRef, Ratio, Side, StatLine } from '@arenalive/volley-stats';
import { playerName } from '../lib/format.ts';

export interface PlayerRow {
  number: number;
  name: string;
  libero: boolean;
  points: number;
  attackTotal: number;
  kills: number;
  attackErrors: number;
  killPct: Ratio;
  attackEff: Ratio;
  receptionTotal: number;
  receptionPositive: Ratio;
  receptionPerfect: Ratio;
  serveTotal: number;
  aces: number;
  serveErrors: number;
  blocks: number;
  digs: number;
  errors: number;
}

export type PlayerSortKey = Exclude<keyof PlayerRow, 'name' | 'libero'>;
export type SortDirection = 'asc' | 'desc';

function row(number: number, ref: PlayerRef | undefined, s: StatLine): PlayerRow {
  return {
    number,
    name: playerName(ref, number),
    libero: ref?.specialRole === 'L' || ref?.role === 'libero',
    points: s.points,
    attackTotal: s.attack.total,
    kills: s.attack.kills,
    attackErrors: s.attack.errors + s.attack.blocked,
    killPct: s.attack.killPct,
    attackEff: s.attack.efficiency,
    receptionTotal: s.reception.total,
    receptionPositive: s.reception.positivePct,
    receptionPerfect: s.reception.perfectPct,
    serveTotal: s.serve.total,
    aces: s.serve.aces,
    serveErrors: s.serve.errors,
    blocks: s.block.kills,
    digs: s.dig.total,
    errors: s.errors,
  };
}

/** Players of one team with at least one action (in `set`, or in the match when `set` is null). */
export function playerRows(state: MatchState, side: Side, set: number | null): PlayerRow[] {
  const roster = new Map(state.players[side].map((p) => [p.number, p]));
  const out: PlayerRow[] = [];
  for (const p of Object.values(state.stats[side].players)) {
    const line = set === null ? p.total : p.bySet[String(set)];
    if (!line) continue;
    out.push(row(p.number, roster.get(p.number), line));
  }
  return sortPlayerRows(out, 'number', 'asc');
}

/** Sorted copy; `null` ratios always at the end, ties by jersey number. */
export function sortPlayerRows(rows: PlayerRow[], key: PlayerSortKey, direction: SortDirection): PlayerRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null && y === null) return a.number - b.number;
    if (x === null) return 1;
    if (y === null) return -1;
    return x === y ? a.number - b.number : (x - y) * sign;
  });
}

/** Set numbers that have statistics, for the set filter. */
export function statSets(state: MatchState): number[] {
  const keys = new Set([...Object.keys(state.stats.home.bySet), ...Object.keys(state.stats.away.bySet)]);
  return [...keys]
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}
