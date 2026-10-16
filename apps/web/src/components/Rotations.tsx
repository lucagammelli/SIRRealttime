import type { MatchState, Side } from '@sir/volley-stats';
import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart.tsx';
import { rotationOption } from '../charts/options.ts';
import { rotationExtremes, rotationSeries } from '../charts/rotations.ts';
import { usePalette } from '../charts/usePalette.ts';
import { teamName, teamShort } from '../lib/format.ts';
import { useDeviceContext } from '../lib/useLayout.ts';
import { Card, Segmented } from './ui.tsx';

const TEXT: Record<Side, string> = { home: 'text-home-ink', away: 'text-away-ink' };

const BG: Record<Side, string> = { home: 'bg-home', away: 'bg-away' };

/**
 * Points won/lost for each position of the setter, one chart per team (side by side when the card is wide enough),
 * each with its legend «Vinti / Persi». On the phone one team at a time (selector of the team), lower charts without
 * value labels.
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
  const [chosen, setChosen] = useState<Side>('home');
  const chartClass = chartClassName ?? (compact ? 'sir-chart h-36' : 'h-44');
  const sides: Side[] = compact ? [chosen] : ['home', 'away'];
  return (
    <Card
      title="Rotazioni"
      subtitle="Punti vinti e persi per posizione del palleggiatore"
      className={className}
      actions={
        compact ? (
          <Segmented
            label="Squadra"
            size="xs"
            value={chosen}
            onChange={setChosen}
            options={[
              { value: 'home', label: teamShort(state.teams, 'home') },
              { value: 'away', label: teamShort(state.teams, 'away') },
            ]}
          />
        ) : undefined
      }
    >
      <div className="@container">
        <div className="grid gap-4 @md:grid-cols-2">
          {sides.map((side) => (
            <TeamRotations key={side} state={state} side={side} chartClassName={chartClass} compact={compact} />
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Legend of the chart of one team: points won in its colour, lost in the colour of the secondary data. */
function Legend({ side }: { side: Side }) {
  return (
    <ul aria-label="Legenda" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`inline-block size-2.5 rounded-sm ${BG[side]}`} />
        Vinti
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-chart-secondary" />
        Persi
      </li>
    </ul>
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
        <h3 className={`text-sm font-bold uppercase ${TEXT[side]}`}>{name}</h3>
        <Legend side={side} />
      </div>
      {now !== null && <p className="text-xs text-muted">Ora: palleggiatore in P{now}</p>}
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
