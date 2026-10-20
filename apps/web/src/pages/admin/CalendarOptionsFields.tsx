import type { BlockOptions, LayoutBlock, StandingsScope } from '@arenalive/shared';
import { STANDINGS_AROUND, STANDINGS_MAX_ROWS, STANDINGS_MIN_ROWS, STANDINGS_SCOPES } from '@arenalive/shared';
import { inputClass } from './forms.tsx';

const selectClass = `${inputClass} w-auto`;

const SCOPE_LABELS: Record<StandingsScope, string> = {
  top: 'Le prime righe',
  all: 'Tutta la classifica',
  around: `Intorno alla nostra squadra (±${STANDINGS_AROUND} posizioni)`,
};

const ROW_CHOICES = Array.from(
  { length: STANDINGS_MAX_ROWS - STANDINGS_MIN_ROWS + 1 },
  (_, i) => STANDINGS_MIN_ROWS + i,
);

type CalendarBlock = Extract<LayoutBlock, { type: 'nextMatch' | 'standings' }>;

/**
 * Options of «Prossima partita» (QR of the link of the match on or off) and «Classifica» (which rows), for a block of
 * the page and for the slide of the same type of a pause. The data come from the club of the client («Club»).
 */
export function CalendarOptionsFields({
  block,
  onChange,
  name,
}: {
  block: CalendarBlock;
  onChange: (block: LayoutBlock) => void;
  name: string;
}) {
  if (block.type === 'nextMatch') {
    return (
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={block.options.qr}
          aria-label={`Mostra il codice QR: ${name}`}
          onChange={(e) => onChange({ ...block, options: { ...block.options, qr: e.target.checked } })}
        />
        Mostra il codice QR del link della partita
      </label>
    );
  }
  const options: BlockOptions<'standings'> = block.options;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-text">
      <label className="flex items-center gap-2">
        Righe
        <select
          className={selectClass}
          aria-label={`Righe: ${name}`}
          value={options.scope}
          onChange={(e) => {
            const scope = STANDINGS_SCOPES.find((s) => s === e.target.value) ?? 'around';
            onChange({ ...block, options: { ...options, scope } });
          }}
        >
          {STANDINGS_SCOPES.map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {options.scope === 'top' && (
        <label className="flex items-center gap-2">
          Quante righe
          <select
            className={selectClass}
            aria-label={`Quante righe: ${name}`}
            value={options.count}
            onChange={(e) => onChange({ ...block, options: { ...options, count: Number(e.target.value) } })}
          >
            {ROW_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
