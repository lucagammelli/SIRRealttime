import type { CourtSideMode, CourtSkillMode } from '@arenalive/shared';
import type { Side } from '@arenalive/volley-stats';
import { useEffect, useState } from 'react';
import type { ZoneSkill } from '../charts/zones.ts';

/** One view of the court map: a team and a skill. */
export interface CourtStep {
  side: Side;
  skill: ZoneSkill;
}

/**
 * Pure: the views of the map without the touch filters, in order: for each skill every team (with both «a turno»:
 * home attacks → away attacks → home serves → away serves). `ours`: the team of the client, home when not known.
 */
export function courtSteps(side: CourtSideMode, skill: CourtSkillMode, ours: Side | null): CourtStep[] {
  const sides: Side[] = side === 'cycle' ? ['home', 'away'] : side === 'ours' ? [ours ?? 'home'] : [side];
  const skills: ZoneSkill[] = skill === 'cycle' ? ['attack', 'serve'] : [skill];
  return skills.flatMap((k) => sides.map((s) => ({ side: s, skill: k })));
}

/**
 * The view shown now among `steps`, the next one every `seconds` (only with more than one view and while `running`);
 * it starts again from the first when the views change. Only the data change: no animation.
 */
export function useCourtStep(steps: readonly CourtStep[], seconds: number, running: boolean): CourtStep {
  const key = steps.map((s) => `${s.side}-${s.skill}`).join(',');
  const [state, setState] = useState({ key, index: 0 });
  const index = state.key === key ? state.index : 0;
  const cycling = running && steps.length > 1;
  useEffect(() => {
    if (!cycling) return;
    const id = setInterval(
      () =>
        setState((prev) => ({
          key,
          index: ((prev.key === key ? prev.index : 0) + 1) % Math.max(1, key.split(',').length),
        })),
      seconds * 1000,
    );
    return () => clearInterval(id);
  }, [cycling, key, seconds]);
  return steps[index] ?? steps[0] ?? { side: 'home', skill: 'attack' };
}
