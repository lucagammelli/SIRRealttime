import type { MatchState } from '@arenalive/volley-stats';
import { useState } from 'react';
import type { ComparisonRow } from '../charts/compare.ts';
import { barShares, leader, teamComparison } from '../charts/compare.ts';
import { statSets } from '../charts/players.ts';
import { formatCount, formatPct, teamName, teamShort } from '../lib/format.ts';
import { Card, Segmented } from './ui.tsx';

const value = (row: ComparisonRow, v: number | null): string => (row.kind === 'ratio' ? formatPct(v) : formatCount(v));

/** Mirrored bars home | away for every fundamental. */
export function TeamComparison({
  state,
  className = '',
  compact = false,
}: {
  state: MatchState;
  className?: string;
  compact?: boolean;
}) {
  const sets = statSets(state);
  const [set, setSet] = useState<number>(0);
  const selected = set === 0 || !sets.includes(set) ? null : set;
  const rows = teamComparison(state, selected);
  const home = teamShort(state.teams, 'home');
  const away = teamShort(state.teams, 'away');
  let lastGroup = '';

  return (
    <Card
      title="Confronto squadre"
      className={className}
      actions={
        sets.length > 0 && !compact ? (
          <Segmented
            label="Periodo"
            size="xs"
            value={selected ?? 0}
            onChange={setSet}
            options={[{ value: 0, label: 'Partita' }, ...sets.map((n) => ({ value: n, label: `${n}° set` }))]}
          />
        ) : undefined
      }
    >
      <div className="mb-2 flex justify-between gap-4 text-xs font-bold uppercase tracking-wide">
        <span className="truncate text-home-ink" title={teamName(state.teams, 'home')}>
          {home}
        </span>
        <span className="truncate text-away-ink" title={teamName(state.teams, 'away')}>
          {away}
        </span>
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">
          Confronto tra {home} e {away}
          {selected ? ` nel ${selected}° set` : ' nella partita'}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{home}</th>
            <th scope="col">Statistica</th>
            <th scope="col">{away}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shares = barShares(row);
            const best = leader(row);
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            return (
              <tr key={row.key} className={showGroup && !compact ? 'border-t border-grid' : ''}>
                <td className="w-[38%] py-1 pr-2 align-middle">
                  <div className="flex items-center justify-end gap-2">
                    <span
                      data-value="home"
                      className={`tabular min-w-[6ch] shrink-0 whitespace-nowrap text-right ${best === 'home' ? 'font-bold text-home-ink' : 'text-text'}`}
                    >
                      {value(row, row.home)}
                    </span>
                    <span className="relative h-2.5 w-full min-w-4 max-w-36 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="sir-bar absolute inset-y-0 right-0 rounded-full bg-home"
                        style={{ width: `${shares.home * 100}%` }}
                      />
                    </span>
                  </div>
                </td>
                <th scope="row" className="px-1 py-1 text-center text-xs font-medium leading-tight text-muted">
                  {row.label}
                </th>
                <td className="w-[38%] py-1 pl-2 align-middle">
                  <div className="flex items-center gap-2">
                    <span className="relative h-2.5 w-full min-w-4 max-w-36 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="sir-bar absolute inset-y-0 left-0 rounded-full bg-away"
                        style={{ width: `${shares.away * 100}%` }}
                      />
                    </span>
                    <span
                      data-value="away"
                      className={`tabular min-w-[6ch] shrink-0 whitespace-nowrap text-left ${best === 'away' ? 'font-bold text-away-ink' : 'text-text'}`}
                    >
                      {value(row, row.away)}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selected !== null && (
        <p className="mt-2 text-xs text-muted">% cambio palla e break point: solo sull'intera partita.</p>
      )}
    </Card>
  );
}
