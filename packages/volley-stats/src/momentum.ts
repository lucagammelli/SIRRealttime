import type { Momentum, MomentumPoint, MomentumTeam, Side } from './types.js';
import type { PointEvent } from './timeline.js';
import { other, ratio, SIDES } from './util.js';

/** Tipo di punto: break point se lo vince chi serve, side-out se lo vince chi riceve (server ignoto → side-out). */
export const pointType = (p: PointEvent): 'breakPoint' | 'sideOut' =>
  p.server !== null && p.server === p.scorer ? 'breakPoint' : 'sideOut';

/** Squadra al servizio; se non ricavabile si assume che il punto sia un side-out. */
export const effectiveServer = (p: PointEvent): Side => p.server ?? other(p.scorer);

/** Andamento punto per punto e riepilogo per squadra. */
export function computeMomentum(points: PointEvent[]): Momentum {
  const sets = new Map<number, MomentumPoint[]>();
  const acc: Record<Side, MomentumTeam> = {
    home: emptyTeam(),
    away: emptyTeam(),
  };
  let run: { set: number; team: Side; length: number } | null = null;
  for (const p of points) {
    const type = pointType(p);
    const list = sets.get(p.set) ?? [];
    sets.set(p.set, list);
    list.push({
      index: p.index,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      scorer: p.scorer,
      type,
      ...(p.time ? { time: p.time } : {}),
    });
    const team = acc[p.scorer];
    if (type === 'breakPoint') team.breakPoints++;
    else team.sideOuts++;
    const server = effectiveServer(p);
    acc[server].servedRallies++;
    acc[other(server)].receivedRallies++;
    if (run !== null && run.set === p.set && run.team === p.scorer) run.length++;
    else run = { set: p.set, team: p.scorer, length: 1 };
    const key = String(p.set);
    if (run.length > (team.longestRunBySet[key] ?? 0)) team.longestRunBySet[key] = run.length;
    if (run.length > team.longestRun) team.longestRun = run.length;
  }
  for (const s of SIDES) {
    const t = acc[s];
    t.sideOutPct = ratio(t.sideOuts, t.receivedRallies);
    t.breakPointPct = ratio(t.breakPoints, t.servedRallies);
  }
  return {
    sets: [...sets.entries()].sort((a, b) => a[0] - b[0]).map(([set, pts]) => ({ set, points: pts })),
    home: acc.home,
    away: acc.away,
  };
}

function emptyTeam(): MomentumTeam {
  return {
    breakPoints: 0,
    sideOuts: 0,
    servedRallies: 0,
    receivedRallies: 0,
    sideOutPct: null,
    breakPointPct: null,
    longestRunBySet: {},
    longestRun: 0,
  };
}
