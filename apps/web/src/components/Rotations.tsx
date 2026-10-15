import type { MatchState, Side } from '@sir/volley-stats';
import { useMemo } from 'react';
import { EChart } from '../charts/EChart.tsx';
import { rotationOption } from '../charts/options.ts';
import { rotationExtremes, rotationSeries } from '../charts/rotations.ts';
import { usePalette } from '../charts/usePalette.ts';
import { teamName } from '../lib/format.ts';
import { useDeviceContext } from '../lib/useLayout.ts';
import { Card } from './ui.tsx';

const TEXT: Record<Side, string> = { home: 'text-home', away: 'text-away' };

/**
 * Points won/lost for each position of the setter, one chart per team (side by side when the card is wide enough).
 * On the phone the charts are lower, without value labels, and the legend goes under them.
 */
export function Rotations({
  state,
  className = '',
  chartClassName,
}: {
  state: MatchState;
  className?: string;
  chartClassName?: string;
}) {
  const compact = useDeviceContext() === 'phone';
  const chartClass = chartClassName ?? (compact ? 'h-36' : 'h-44');
  return (
    <Card title="Rotazioni" subtitle="Punti vinti e persi per posizione del palleggiatore" className={className}>
      <div className="@container">
        <div className="grid gap-4 @md:grid-cols-2">
          <TeamRotations state={state} side="home" chartClassName={chartClass} compact={compact} />
          <TeamRotations state={state} side="away" chartClassName={chartClass} compact={compact} />
        </div>
      </div>
      {compact && (
        <ul aria-label="Legenda" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-home" />
            <span aria-hidden="true" className="-ml-1 inline-block size-2.5 rounded-sm bg-away" />
            Punti vinti
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-axis" />
            Punti persi
          </li>
        </ul>
      )}
    </Card>
  );
}

function TeamRotations({
  state,
  side,
  chartClassName,
  compact,
}: {
  state: MatchState;
  side: Side;
  chartClassName: string;
  compact: boolean;
}) {
  const palette = usePalette();
  const data = useMemo(() => rotationSeries(state, side), [state, side]);
  const option = useMemo(() => rotationOption(data, side, palette, compact), [data, side, palette, compact]);
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
