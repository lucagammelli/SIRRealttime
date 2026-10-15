import type { MatchState, Side } from '@sir/volley-stats';
import { useMemo, useState } from 'react';
import { EChart } from '../charts/EChart.tsx';
import { breakPointCount, defaultMomentumSet, momentumSeries, momentumSets } from '../charts/momentum.ts';
import { momentumOption } from '../charts/options.ts';
import { usePalette } from '../charts/usePalette.ts';
import { teamShort } from '../lib/format.ts';
import { Card, Empty, Segmented } from './ui.tsx';

/** Lead point by point in a set, with break points highlighted and the set selector. */
export function MomentumChart({
  state,
  className = '',
  chartClassName = 'min-h-56 flex-1 sm:min-h-64',
}: {
  state: MatchState;
  className?: string;
  chartClassName?: string;
}) {
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
  const option = useMemo(() => momentumOption(data, palette, short), [data, palette, short]);
  const bp = breakPointCount(data);

  return (
    <Card
      title="Andamento del set"
      className={className}
      subtitle={
        set === null ? undefined : (
          <>
            Break point:{' '}
            <span className="font-semibold text-home">
              {short.home} {bp.home}
            </span>{' '}
            ·{' '}
            <span className="font-semibold text-away">
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
            className={chartClassName}
            label={`Vantaggio punto per punto nel ${set}° set: ${data.length} punti giocati, break point ${short.home} ${bp.home}, ${short.away} ${bp.away}`}
          />
          <p className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full border border-surface bg-axis" />I
            pallini segnano i break point (punto di chi è al servizio).
          </p>
        </div>
      )}
    </Card>
  );
}
