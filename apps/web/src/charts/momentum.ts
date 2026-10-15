import type { MatchState, Side } from '@sir/volley-stats';

export interface MomentumDatum {
  /** 1-based rally number in the set. */
  rally: number;
  homeScore: number;
  awayScore: number;
  /** Lead of the home team (negative: away ahead). */
  lead: number;
  scorer: Side;
  breakPoint: boolean;
}

/** Sets that have at least one point, in order. */
export function momentumSets(state: MatchState): number[] {
  return state.momentum.sets.filter((s) => s.points.length > 0).map((s) => s.set);
}

/** Set shown by default: the live one if it has points, otherwise the last one with points. */
export function defaultMomentumSet(state: MatchState): number | null {
  const sets = momentumSets(state);
  if (sets.includes(state.live.set)) return state.live.set;
  return sets.at(-1) ?? null;
}

/** Point-by-point lead of one set. */
export function momentumSeries(state: MatchState, set: number): MomentumDatum[] {
  const points = state.momentum.sets.find((s) => s.set === set)?.points ?? [];
  return points.map((p, i) => ({
    rally: i + 1,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    lead: p.homeScore - p.awayScore,
    scorer: p.scorer,
    breakPoint: p.type === 'breakPoint',
  }));
}

/** Symmetric bound of the lead axis: at least 3, so a tight set does not look like a blowout. */
export function leadBound(data: MomentumDatum[]): number {
  return Math.max(3, ...data.map((d) => Math.abs(d.lead)));
}

/** Break points scored by each team in the series. */
export function breakPointCount(data: MomentumDatum[]): Record<Side, number> {
  const out: Record<Side, number> = { home: 0, away: 0 };
  for (const d of data) if (d.breakPoint) out[d.scorer]++;
  return out;
}
