import type { MatchState, Side } from '@arenalive/volley-stats';
import { useMemo, useState } from 'react';
import type { PlayerRow, PlayerSortKey, SortDirection } from '../charts/players.ts';
import { playerRows, sortPlayerRows, statSets } from '../charts/players.ts';
import { formatCount, formatPct, teamName } from '../lib/format.ts';
import { useDeviceContext, useTouch } from '../lib/useLayout.ts';
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

/**
 * Compact table of the phone (graphic specifications): only the essential columns, full names in the headers; the
 * whole table is one button away («Tutte le colonne»), scrolling sideways inside its card.
 */
const ESSENTIAL: Column[] = [
  { key: 'points', label: 'Punti', title: 'Punti (attacco, muro, ace)', group: '' },
  { key: 'killPct', label: 'Att. %', title: 'Attacco: % punti', group: '', ratio: true },
  { key: 'aces', label: 'Ace', title: 'Ace', group: '' },
  { key: 'blocks', label: 'Muro', title: 'Punti a muro', group: '' },
  { key: 'errors', label: 'Errori', title: 'Errori totali', group: '' },
];

const groupsOf = (columns: Column[]) =>
  columns.reduce<{ name: string; span: number }[]>((acc, c) => {
    const last = acc.at(-1);
    if (last && last.name === c.group) last.span++;
    else acc.push({ name: c.group, span: 1 });
    return acc;
  }, []);
const GROUPS = groupsOf(COLUMNS);

/** First column of each group: header, sub-header and cells share the same left border, so groups line up. */
const GROUP_START = new Set(COLUMNS.filter((c, i) => i === 0 || COLUMNS[i - 1]?.group !== c.group).map((c) => c.key));
const groupBorder = (key: PlayerSortKey, grouped: boolean): string =>
  grouped && GROUP_START.has(key) ? 'border-l border-table-border' : '';

const TEXT: Record<Side, string> = { home: 'text-home-ink', away: 'text-away-ink' };

/**
 * Sortable table of the players of one team, with team and set filters. The points column is highlighted; a player
 * can be selected (row highlighted, indicator on the left: colours of the tokens `--sir-table-*`). On the phone the
 * compact table with the essential columns, the header fixed while the table scrolls inside the card.
 */
export function PlayerTable({ state, className = '' }: { state: MatchState; className?: string }) {
  const compact = useDeviceContext() === 'phone';
  const touch = useTouch();
  const [allColumns, setAllColumns] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const essential = compact && !allColumns;
  const columns = essential ? ESSENTIAL : COLUMNS;
  const [side, setSide] = useState<Side>('home');
  const [set, setSet] = useState<number>(0);
  const [sort, setSort] = useState<{ key: PlayerSortKey; dir: SortDirection }>({ key: 'points', dir: 'desc' });
  const sets = statSets(state);
  const setShown = set === 0 || !sets.includes(set) ? null : set;
  const rows = useMemo(
    () => sortPlayerRows(playerRows(state, side, setShown), sort.key, sort.dir),
    [state, side, setShown, sort],
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
            onChange={(v) => {
              setSide(v);
              setSelected(null);
            }}
            options={[
              { value: 'home', label: teamName(state.teams, 'home') },
              { value: 'away', label: teamName(state.teams, 'away') },
            ]}
          />
          {sets.length > 0 && (
            <Segmented
              label="Set"
              size="xs"
              value={setShown ?? 0}
              onChange={setSet}
              options={[{ value: 0, label: 'Tutti' }, ...sets.map((n) => ({ value: n, label: `${n}°` }))]}
            />
          )}
          {compact && touch && (
            <button
              type="button"
              aria-pressed={allColumns}
              onClick={() => setAllColumns((a) => !a)}
              className="inline-flex min-h-11 items-center rounded-button border border-border bg-seg px-3 text-xs font-medium text-seg-text hover:text-text"
            >
              Tutte le colonne
            </button>
          )}
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>Nessuna azione registrata.</Empty>
      ) : (
        // Wide table: it scrolls sideways inside the card (focusable, so also with the keyboard), never the page.
        // Phone: also vertically inside the card, so that the header stays visible (sticky) while scrolling.
        // Without touch nothing scrolls: what does not fit the card is cut by its body (overflow hidden).
        <div
          {...(touch
            ? { role: 'region', 'aria-label': 'Tabella giocatori, scorrevole in orizzontale', tabIndex: 0 }
            : {})}
          className={`sir-card-bleed -mx-4 max-w-[calc(100%+2rem)] sm:-mx-5 sm:max-w-[calc(100%+2.5rem)] ${
            touch ? `sir-scroll-x ${compact ? 'max-h-[70dvh] overflow-y-auto' : ''}` : ''
          }`}
        >
          <table className={`w-full border-collapse text-sm tabular ${essential ? '' : 'min-w-[46rem]'}`}>
            <caption className="sr-only">
              Statistiche dei giocatori di {teamName(state.teams, side)}
              {setShown ? ` nel ${setShown}° set` : ' nella partita'}. Le intestazioni ordinano la tabella.
            </caption>
            <thead className={compact && touch ? 'sticky top-0 z-10 bg-surface' : ''}>
              {!essential && (
                <tr className="bg-table-head text-xs uppercase tracking-wide text-muted">
                  <th colSpan={2} scope="colgroup" />
                  {GROUPS.map((g, i) => (
                    <th
                      key={`${g.name}-${i}`}
                      colSpan={g.span}
                      scope="colgroup"
                      className={`px-1 pt-1.5 text-center font-semibold ${i === 0 ? '' : 'border-l border-table-border'}`}
                    >
                      {g.name}
                    </th>
                  ))}
                </tr>
              )}
              <tr className="border-b border-border bg-table-head text-xs text-muted">
                <SortHeader
                  label="N."
                  title="Numero di maglia"
                  active={sort.key === 'number'}
                  ariaSort={ariaSort('number')}
                  onClick={() => toggleSort('number')}
                  interactive={touch}
                  className="pl-4 text-left sm:pl-5"
                />
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Giocatore
                </th>
                {columns.map((c) => (
                  <SortHeader
                    key={c.key}
                    label={c.label}
                    title={c.title}
                    active={sort.key === c.key}
                    ariaSort={ariaSort(c.key)}
                    onClick={() => toggleSort(c.key)}
                    interactive={touch}
                    className={`text-center ${groupBorder(c.key, !essential)} ${c.key === 'points' ? 'bg-table-key' : ''}`}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelected = selected === r.number;
                return (
                  <tr
                    key={r.number}
                    data-selected={isSelected}
                    className={`border-b border-table-border last:border-0 hover:bg-hover ${
                      isSelected ? 'bg-table-selected' : 'even:bg-table-alt'
                    }`}
                  >
                    <td
                      className={`py-1.5 pl-4 font-bold sm:pl-5 ${TEXT[side]} ${
                        isSelected ? 'shadow-[inset_3px_0_0_var(--sir-table-indicator)]' : ''
                      }`}
                    >
                      {r.number}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-text">
                      {touch ? (
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          title={isSelected ? 'Togli la selezione' : 'Evidenzia il giocatore'}
                          onClick={() => setSelected(isSelected ? null : r.number)}
                          className="text-left hover:underline pointer-coarse:min-h-11"
                        >
                          {r.name}
                        </button>
                      ) : (
                        <span>{r.name}</span>
                      )}
                      {r.libero && (
                        <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] font-semibold uppercase text-muted">
                          Libero
                        </span>
                      )}
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-1.5 py-1.5 text-center text-text ${groupBorder(c.key, !essential)} ${
                          c.key === 'points' ? 'bg-table-key font-bold' : ''
                        }`}
                      >
                        {cell(r, c)}
                      </td>
                    ))}
                  </tr>
                );
              })}
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
  interactive,
  className = 'text-center',
}: {
  label: string;
  title: string;
  active: boolean;
  ariaSort: 'ascending' | 'descending' | 'none';
  onClick: () => void;
  /** Without touch the header is plain text. */
  interactive: boolean;
  className?: string;
}) {
  return (
    <th scope="col" aria-sort={ariaSort} className={`px-1.5 py-1.5 font-medium ${className}`}>
      {interactive ? (
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
      ) : (
        <span title={title}>
          {label}
          <span aria-hidden="true" className="text-[10px]">
            {active ? (ariaSort === 'ascending' ? '▲' : '▼') : ''}
          </span>
        </span>
      )}
    </th>
  );
}
