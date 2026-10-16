import type { MatchState, Side } from '@sir/volley-stats';
import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart.tsx';
import { breakPointCount, defaultMomentumSet, momentumSeries, momentumSets } from '../charts/momentum.ts';
import { momentumOption } from '../charts/options.ts';
import { usePalette } from '../charts/usePalette.ts';
import { teamShort } from '../lib/format.ts';
import { useDeviceContext } from '../lib/useLayout.ts';
import { Card, Empty, Segmented } from './ui.tsx';

/**
 * Lead point by point in a set, with break points highlighted and the set selector. On the phone the chart is simpler
 * (lower, fewer labels) and the legend of the two teams goes under it.
 */
export function MomentumChart({
  state,
  className = '',
  chartClassName,
}: {
  state: MatchState;
  className?: string;
  chartClassName?: string;
}) {
  const compact = useDeviceContext() === 'phone';
  const chartClass = chartClassName ?? (compact ? 'sir-chart h-44' : 'min-h-56 flex-1 sm:min-h-64');
  const sets = momentumSets(state);
  const [chosen, setChosen] = useState<number | null>(null);
  // Follows the live set until the user picks one.
  const set = chosen !== null && sets.includes(chosen) ? chosen : defaultMomentumSet(state);
  const palette = usePalette();
  const short = useMemo<Record<Side, string>>(
    () => ({ home: teamShort(state.teams, 'home'), away: teamShort(state.teams, 'away') }),
    [state.teams],
  );
  const data = useMemo(() => (set === null ? [] : momentumSeries(state, set)), [state, set]);
  const option = useMemo(() => momentumOption(data, palette, short, compact), [data, palette, short, compact]);
  const bp = breakPointCount(data);

  return (
    <Card
      title="Andamento del set"
      className={className}
      subtitle={
        set === null ? undefined : (
          <>
            Break point:{' '}
            <span className="font-semibold text-home-ink">
              {short.home} {bp.home}
            </span>{' '}
            ·{' '}
            <span className="font-semibold text-away-ink">
              {short.away} {bp.away}
            </span>
          </>
        )
      }
      actions={
        sets.length > 1 && set !== null ? (
          <Segmented
            label="Set"
            size="xs"
            value={set}
            onChange={setChosen}
            options={sets.map((n) => ({ value: n, label: `${n}° set` }))}
          />
        ) : undefined
      }
      bodyClassName="flex flex-col"
    >
      {set === null ? (
        <Empty>Il grafico compare dal primo punto.</Empty>
      ) : (
        // The chart grows with the card (same height as the comparison next to it on desktop).
        <div className="flex min-h-0 flex-1 flex-col">
          <EChart
            option={option}
            className={chartClass}
            label={`Vantaggio punto per punto nel ${set}° set: ${data.length} punti giocati, break point ${short.home} ${bp.home}, ${short.away} ${bp.away}`}
          />
          {compact && (
            <ul aria-label="Legenda" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
              <li className="flex items-center gap-1.5 text-home-ink">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-home" />
                {short.home} avanti (sopra)
              </li>
              <li className="flex items-center gap-1.5 text-away-ink">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-away" />
                {short.away} avanti (sotto)
              </li>
            </ul>
          )}
          <p className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full border border-surface bg-axis" />I
            pallini segnano i break point (punto di chi è al servizio).
          </p>
        </div>
      )}
    </Card>
  );
}
