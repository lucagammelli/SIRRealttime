import type { BlockOptions, DuelRoleChoice, StatPeriod } from '@sir/shared';
import type { TeamDuelKey } from '@sir/volley-stats';
import { TEAM_DUEL_KEYS } from '@sir/volley-stats';
import { ATTACKERS_MAX, ATTACKERS_MIN, DUEL_ROLE_CHOICES, SCORERS_MAX, SCORERS_MIN, STAT_PERIODS } from '@sir/shared';
import { useId } from 'react';
import { SHORT_ROW } from '../../blocks/StatSlides.tsx';
import { inputClass } from './forms.tsx';

const selectClass = `${inputClass} w-auto`;

/** Types of block and slide with the statistics of a period (same options for both). */
export const STAT_TYPES = ['setScorers', 'aces', 'blocks', 'attack', 'roleDuel', 'teamDuel'] as const;
export type StatType = (typeof STAT_TYPES)[number];

/** A block or a slide with the statistics of a period: its type and its options. */
export type StatItem = { [T in StatType]: { type: T; options: BlockOptions<T> } }[StatType];

export const isStatType = (type: string): type is StatType => (STAT_TYPES as readonly string[]).includes(type);

/**
 * The options edited back on the block or the slide they come from (same type: the options of a statistics block and
 * of the slide of the same type are the same schema of @sir/shared).
 */
export function withStatOptions<T extends { type: string; options: unknown }>(target: T, item: StatItem): T {
  return item.type === target.type ? { ...target, options: item.options } : target;
}

const ROLE_CHOICE_LABELS: Record<DuelRoleChoice, string> = {
  rotate: 'Tutti i ruoli, a rotazione',
  opposite: 'Opposti',
  outside: 'Schiacciatori',
  middle: 'Centrali',
  setter: 'Palleggiatori',
  libero: 'Liberi',
};

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Options of a statistics block or slide: the period (the set, or the whole match), how many players, the role of
 * the duel, the rows of the team comparison (none chosen: all of them). `setLabel`: what «set» means where it is used
 * (the set just closed, the set in progress).
 */
export function StatOptionsFields({
  item,
  onChange,
  setLabel,
  name,
}: {
  item: StatItem;
  onChange: (item: StatItem) => void;
  setLabel: string;
  /** Name of the block or slide, for the labels read by screen readers. */
  name: string;
}) {
  const rowsId = useId();
  const periodLabels: Record<StatPeriod, string> = { set: setLabel, match: 'Tutta la partita' };
  const period = (
    <label className="flex items-center gap-2">
      Periodo
      <select
        className={selectClass}
        aria-label={`Periodo: ${name}`}
        value={item.options.period}
        onChange={(e) => {
          const value: StatPeriod = e.target.value === 'match' ? 'match' : 'set';
          onChange({ ...item, options: { ...item.options, period: value } } as StatItem);
        }}
      >
        {STAT_PERIODS.map((p) => (
          <option key={p} value={p}>
            {periodLabels[p]}
          </option>
        ))}
      </select>
    </label>
  );

  let extra = null;
  if (item.type === 'setScorers' || item.type === 'attack') {
    const [min, max, label] =
      item.type === 'setScorers'
        ? [SCORERS_MIN, SCORERS_MAX, 'Marcatori per squadra']
        : [ATTACKERS_MIN, ATTACKERS_MAX, 'Attaccanti per squadra'];
    extra = (
      <label className="flex items-center gap-2">
        {label}
        <select
          className={selectClass}
          aria-label={`${label}: ${name}`}
          value={item.options.limit}
          onChange={(e) => onChange({ ...item, options: { ...item.options, limit: Number(e.target.value) } })}
        >
          {range(min, max).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    );
  } else if (item.type === 'roleDuel') {
    extra = (
      <label className="flex items-center gap-2">
        Ruolo
        <select
          className={selectClass}
          aria-label={`Ruolo: ${name}`}
          value={item.options.role}
          onChange={(e) => {
            const role = DUEL_ROLE_CHOICES.find((r) => r === e.target.value) ?? 'rotate';
            onChange({ ...item, options: { ...item.options, role } });
          }}
        >
          {DUEL_ROLE_CHOICES.map((r) => (
            <option key={r} value={r}>
              {ROLE_CHOICE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
    );
  } else if (item.type === 'teamDuel') {
    const all = item.options.rows.length === 0;
    const chosen = new Set<TeamDuelKey>(all ? TEAM_DUEL_KEYS : item.options.rows);
    const toggle = (key: TeamDuelKey, on: boolean): void => {
      const next = TEAM_DUEL_KEYS.filter((k) => (k === key ? on : chosen.has(k)));
      // Every row chosen is saved as «all» (also the rows added in the future).
      const rows = next.length === TEAM_DUEL_KEYS.length ? [] : next;
      onChange({ ...item, options: { ...item.options, rows } });
    };
    extra = (
      <fieldset className="w-full space-y-1" aria-describedby={rowsId}>
        <legend className="text-sm text-text">Righe del confronto</legend>
        <p id={rowsId} className="text-xs text-muted">
          {all ? 'Tutte le righe.' : `${chosen.size} righe scelte.`} Cambio palla e break point solo per tutta la
          partita.
        </p>
        <ul className="flex flex-wrap gap-2">
          {TEAM_DUEL_KEYS.map((key) => (
            <li key={key}>
              <label className="flex items-center gap-2 rounded-card border border-border bg-surface px-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(key)}
                  // At least one row: the last one cannot be taken away.
                  disabled={chosen.size === 1 && chosen.has(key)}
                  onChange={(e) => toggle(key, e.target.checked)}
                />
                {SHORT_ROW[key]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-text">
      {period}
      {extra}
    </div>
  );
}
