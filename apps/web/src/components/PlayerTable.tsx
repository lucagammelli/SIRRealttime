import type { MatchState, Side } from '@sir/volley-stats';
import { useMemo, useState } from 'react';
import type { PlayerRow, PlayerSortKey, SortDirection } from '../charts/players.ts';
import { playerRows, sortPlayerRows, statSets } from '../charts/players.ts';
import { formatCount, formatPct, teamName } from '../lib/format.ts';
import { Card, Empty, Segmented } from './ui.tsx';

interface Column {
  key: PlayerSortKey;
  label: string;
  title: string;
  group: string;
  ratio?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'points', label: 'Pt', title: 'Punti (attacco, muro, ace)', group: '' },
  { key: 'attackTotal', label: 'Tot', title: 'Attacchi', group: 'Attacco' },
  { key: 'kills', label: '#', title: 'Punti in attacco', group: 'Attacco' },
  { key: 'killPct', label: '%', title: 'Attacco: % punti', group: 'Attacco', ratio: true },
  { key: 'attackEff', label: 'Eff', title: 'Efficienza attacco', group: 'Attacco', ratio: true },
  { key: 'receptionTotal', label: 'Tot', title: 'Ricezioni', group: 'Ricezione' },
  { key: 'receptionPositive', label: 'Pos', title: 'Ricezione positiva', group: 'Ricezione', ratio: true },
  { key: 'receptionPerfect', label: 'Prf', title: 'Ricezione perfetta', group: 'Ricezione', ratio: true },
  { key: 'serveTotal', label: 'Tot', title: 'Battute', group: 'Battuta' },
  { key: 'aces', label: 'Ace', title: 'Ace', group: 'Battuta' },
  { key: 'serveErrors', label: 'Err', title: 'Errori in battuta', group: 'Battuta' },
  { key: 'blocks', label: '#', title: 'Punti a muro', group: 'Muro' },
  { key: 'digs', label: 'Dif', title: 'Difese', group: 'Difesa' },
  { key: 'errors', label: 'Err', title: 'Errori totali', group: 'Errori' },
];

const GROUPS = COLUMNS.reduce<{ name: string; span: number }[]>((acc, c) => {
  const last = acc.at(-1);
  if (last && last.name === c.group) last.span++;
  else acc.push({ name: c.group, span: 1 });
  return acc;
}, []);

/** First column of each group: header, sub-header and cells share the same left border, so groups line up. */
const GROUP_START = new Set(COLUMNS.filter((c, i) => i === 0 || COLUMNS[i - 1]?.group !== c.group).map((c) => c.key));
const groupBorder = (key: PlayerSortKey): string => (GROUP_START.has(key) ? 'border-l border-grid' : '');

const TEXT: Record<Side, string> = { home: 'text-home', away: 'text-away' };

/** Sortable table of the players of one team, with team and set filters. */
export function PlayerTable({ state, className = '' }: { state: MatchState; className?: string }) {
  const [side, setSide] = useState<Side>('home');
  const [set, setSet] = useState<number>(0);
  const [sort, setSort] = useState<{ key: PlayerSortKey; dir: SortDirection }>({ key: 'points', dir: 'desc' });
  const sets = statSets(state);
  const selected = set === 0 || !sets.includes(set) ? null : set;
  const rows = useMemo(
    () => sortPlayerRows(playerRows(state, side, selected), sort.key, sort.dir),
    [state, side, selected, sort],
  );

  const toggleSort = (key: PlayerSortKey): void =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'number' ? 'asc' : 'desc' },
    );

  const ariaSort = (key: PlayerSortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <Card
      title="Statistiche giocatori"
      className={className}
      actions={
        <>
          <Segmented
            label="Squadra"
            size="xs"
            value={side}
            onChange={setSide}
            options={[
              { value: 'home', label: teamName(state.teams, 'home') },
              { value: 'away', label: teamName(state.teams, 'away') },
            ]}
          />
          {sets.length > 0 && (
            <Segmented
              label="Set"
              size="xs"
              value={selected ?? 0}
              onChange={setSet}
              options={[{ value: 0, label: 'Tutti' }, ...sets.map((n) => ({ value: n, label: `${n}°` }))]}
            />
          )}
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>Nessuna azione registrata.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[46rem] border-collapse text-sm tabular">
            <caption className="sr-only">
              Statistiche dei giocatori di {teamName(state.teams, side)}
              {selected ? ` nel ${selected}° set` : ' nella partita'}. Le intestazioni ordinano la tabella.
            </caption>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th colSpan={2} scope="colgroup" />
                {GROUPS.map((g, i) => (
                  <th
                    key={`${g.name}-${i}`}
                    colSpan={g.span}
                    scope="colgroup"
                    className="border-l border-grid px-1 pt-1.5 text-center font-semibold"
                  >
                    {g.name}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border text-xs text-muted">
                <SortHeader
                  label="N."
                  title="Numero di maglia"
                  active={sort.key === 'number'}
                  ariaSort={ariaSort('number')}
                  onClick={() => toggleSort('number')}
                  className="pl-4 text-left sm:pl-5"
                />
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Giocatore
                </th>
                {COLUMNS.map((c) => (
                  <SortHeader
                    key={c.key}
                    label={c.label}
                    title={c.title}
                    active={sort.key === c.key}
                    ariaSort={ariaSort(c.key)}
                    onClick={() => toggleSort(c.key)}
                    className={`text-center ${groupBorder(c.key)}`}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.number} className="border-b border-grid last:border-0 hover:bg-surface-2">
                  <td className={`py-1.5 pl-4 font-bold sm:pl-5 ${TEXT[side]}`}>{r.number}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text">
                    {r.name}
                    {r.libero && (
                      <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] font-semibold uppercase text-muted">
                        Libero
                      </span>
                    )}
                  </td>
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`px-1.5 py-1.5 text-center ${groupBorder(c.key)} ${c.key === 'points' ? 'font-bold text-text' : 'text-text'}`}
                    >
                      {cell(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function cell(r: PlayerRow, c: Column): string {
  const v = r[c.key];
  return c.ratio ? formatPct(v) : formatCount(v);
}

function SortHeader({
  label,
  title,
  active,
  ariaSort,
  onClick,
  className = 'text-center',
}: {
  label: string;
  title: string;
  active: boolean;
  ariaSort: 'ascending' | 'descending' | 'none';
  onClick: () => void;
  className?: string;
}) {
  return (
    <th scope="col" aria-sort={ariaSort} className={`px-1.5 py-1.5 font-medium ${className}`}>
      <button
        type="button"
        onClick={onClick}
        title={`Ordina per: ${title}`}
        className={`inline-flex items-center gap-0.5 hover:text-text ${active ? 'text-text' : ''}`}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {active ? (ariaSort === 'ascending' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}
