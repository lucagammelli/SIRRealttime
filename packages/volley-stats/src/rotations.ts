import type { RotationStat, Side } from './types.js';
import type { PointEvent } from './timeline.js';
import { effectiveServer } from './momentum.js';
import { ratio, SIDES } from './util.js';

/** Punti vinti/persi e % side-out / break point per posizione del palleggiatore (1-6). */
export function computeRotations(points: PointEvent[]): Record<Side, RotationStat[]> {
  const make = (): RotationStat[] =>
    [1, 2, 3, 4, 5, 6].map((position) => ({
      position,
      pointsWon: 0,
      pointsLost: 0,
      receivedRallies: 0,
      servedRallies: 0,
      sideOuts: 0,
      breakPoints: 0,
      sideOutPct: null,
      breakPointPct: null,
    }));
  const out: Record<Side, RotationStat[]> = { home: make(), away: make() };
  const at = (s: Side, pos: number | null): RotationStat | undefined =>
    pos !== null && pos >= 1 && pos <= 6 ? out[s][pos - 1] : undefined;

  for (const p of points) {
    for (const s of SIDES) {
      const r = at(s, p.setter[s]);
      if (!r) continue;
      const won = p.scorer === s;
      if (won) r.pointsWon++;
      else r.pointsLost++;
      if (effectiveServer(p) === s) {
        r.servedRallies++;
        if (won) r.breakPoints++;
      } else {
        r.receivedRallies++;
        if (won) r.sideOuts++;
      }
    }
  }
  for (const s of SIDES) {
    for (const r of out[s]) {
      r.sideOutPct = ratio(r.sideOuts, r.receivedRallies);
      r.breakPointPct = ratio(r.breakPoints, r.servedRallies);
    }
  }
  return out;
}
