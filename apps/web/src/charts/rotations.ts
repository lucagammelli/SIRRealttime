import type { MatchState, Ratio, Side } from '@arenalive/volley-stats';

export interface RotationDatum {
  position: number;
  label: string;
  won: number;
  lost: number;
  /** won − lost. */
  balance: number;
  sideOutPct: Ratio;
  breakPointPct: Ratio;
}

/** Points won and lost by setter position P1-P6 (always six rows, in order). */
export function rotationSeries(state: MatchState, side: Side): RotationDatum[] {
  const byPos = new Map(state.rotations[side].map((r) => [r.position, r]));
  return [1, 2, 3, 4, 5, 6].map((position) => {
    const r = byPos.get(position);
    const won = r?.pointsWon ?? 0;
    const lost = r?.pointsLost ?? 0;
    return {
      position,
      label: `P${position}`,
      won,
      lost,
      balance: won - lost,
      sideOutPct: r?.sideOutPct ?? null,
      breakPointPct: r?.breakPointPct ?? null,
    };
  });
}

/** Best and worst rotation by balance (`null` if no point was played). */
export function rotationExtremes(data: RotationDatum[]): { best: RotationDatum; worst: RotationDatum } | null {
  const played = data.filter((d) => d.won + d.lost > 0);
  if (played.length === 0) return null;
  const sorted = [...played].sort((a, b) => b.balance - a.balance || a.position - b.position);
  const best = sorted[0];
  const worst = sorted.at(-1);
  return best && worst ? { best, worst } : null;
}
