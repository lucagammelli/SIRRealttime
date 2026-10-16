import type { MatchState, TeamDuelRow } from '@sir/volley-stats';
import { MATCH_PERIOD, setPeriod, teamDuel } from '@sir/volley-stats';

/** One row of the team comparison: `TeamDuelRow` of @sir/volley-stats (the only place of its numbers). */
export type ComparisonRow = TeamDuelRow;

/**
 * Rows of the team comparison for the whole match (`set` null) or one set: `teamDuel` of @sir/volley-stats. Side-out
 * and break point percentages exist only for the whole match, so they are listed only when `set` is null; a set
 * that does not exist gives null values.
 */
export function teamComparison(state: MatchState, set: number | null): ComparisonRow[] {
  return teamDuel(state, set === null ? MATCH_PERIOD : setPeriod(set));
}

/**
 * Length (0-1) of the two mirrored bars: counts relative to the larger of the two, ratios on the 0-100% scale
 * (negative efficiencies → empty bar). Null values → 0.
 */
export function barShares(row: Pick<ComparisonRow, 'kind' | 'home' | 'away'>): { home: number; away: number } {
  const h = row.home ?? 0;
  const a = row.away ?? 0;
  if (row.kind === 'ratio') return { home: clamp01(h), away: clamp01(a) };
  const max = Math.max(h, a);
  if (max <= 0) return { home: 0, away: 0 };
  return { home: clamp01(h / max), away: clamp01(a / max) };
}

/** Which team is better on the row (`null` on a tie or with a missing value). */
export function leader(row: Pick<ComparisonRow, 'better' | 'home' | 'away'>): 'home' | 'away' | null {
  if (row.home === null || row.away === null || row.home === row.away) return null;
  const homeHigher = row.home > row.away;
  return (row.better === 'high') === homeHigher ? 'home' : 'away';
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
