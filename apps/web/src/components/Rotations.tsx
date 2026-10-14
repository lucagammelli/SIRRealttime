import type { MatchState, Side } from '@sir/volley-stats';
import { useMemo } from 'react';
import { EChart } from '../charts/EChart.tsx';
import { rotationOption } from '../charts/options.ts';
import { rotationExtremes, rotationSeries } from '../charts/rotations.ts';
import { usePalette } from '../charts/usePalette.ts';
import { teamName } from '../lib/format.ts';
import { Card } from './ui.tsx';

const TEXT: Record<Side, string> = { home: 'text-home', away: 'text-away' };

/** Points won/lost for each position of the setter, one chart per team. */
export function Rotations({
  state,
  className = '',
  chartClassName = 'h-44',
}: {
  state: MatchState;
  className?: string;
  chartClassName?: string;
}) {
  return (
    <Card title="Rotazioni" subtitle="Punti vinti e persi per posizione del palleggiatore" className={className}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamRotations state={state} side="home" chartClassName={chartClassName} />
        <TeamRotations state={state} side="away" chartClassName={chartClassName} />
      </div>
    </Card>
  );
}

function TeamRotations({ state, side, chartClassName }: { state: MatchState; side: Side; chartClassName: string }) {
  const palette = usePalette();
  const data = useMemo(() => rotationSeries(state, side), [state, side]);
  const option = useMemo(() => rotationOption(data, side, palette), [data, side, palette]);
  const extremes = rotationExtremes(data);
  const now = state.status === 'finished' ? null : state.live.setterPosition[side];
  const name = teamName(state.teams, side);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={`text-sm font-bold ${TEXT[side]}`}>{name}</h3>
        {now !== null && <span className="text-xs text-muted">Ora: palleggiatore in P{now}</span>}
      </div>
      <EChart
        option={option}
        className={chartClassName}
        label={`Rotazioni di ${name}: ${data.map((d) => `P${d.position} ${d.won} vinti e ${d.lost} persi`).join('; ')}`}
      />
      {extremes && extremes.best.position !== extremes.worst.position && (
        <p className="text-xs text-muted">
          Migliore <span className="font-semibold text-text">{extremes.best.label}</span> (
          {signed(extremes.best.balance)}) · peggiore{' '}
          <span className="font-semibold text-text">{extremes.worst.label}</span> ({signed(extremes.worst.balance)})
        </p>
      )}
    </div>
  );
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
