import type { MatchState } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { CourtMap } from './CourtMap.tsx';
import { MomentumChart } from './MomentumChart.tsx';
import { PlayerTable } from './PlayerTable.tsx';
import { Rotations } from './Rotations.tsx';
import { Scoreboard } from './Scoreboard.tsx';
import { TeamComparison } from './TeamComparison.tsx';

/**
 * Whole match page, shared by the public link and the reserved area: score first, then the charts.
 * `tv`: big-screen layout that fits the viewport without scrolling (score, set trend, comparison).
 */
export function MatchView({ state, status, tv = false }: { state: MatchState; status?: ReactNode; tv?: boolean }) {
  if (tv) {
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
        <Scoreboard state={state} status={status} tv />
        <div className="grid min-h-0 grid-cols-3 gap-4">
          <MomentumChart state={state} className="col-span-2 min-h-0" chartClassName="min-h-48 flex-1" />
          <TeamComparison state={state} compact className="min-h-0 overflow-hidden" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Scoreboard state={state} status={status} />
      <div className="grid gap-4 lg:grid-cols-5">
        <MomentumChart state={state} className="lg:col-span-3" />
        <TeamComparison state={state} className="lg:col-span-2" />
      </div>
      <PlayerTable state={state} />
      <div className="grid gap-4 lg:grid-cols-2">
        <CourtMap state={state} />
        <Rotations state={state} />
      </div>
    </div>
  );
}
