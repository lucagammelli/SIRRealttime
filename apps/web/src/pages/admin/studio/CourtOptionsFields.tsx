import type { CourtOptions, LayoutBlock } from '@sir/shared';
import { COURT_WIDTH_MAX, COURT_WIDTH_MIN } from '@sir/shared';
import { Button } from '../../../components/ui.tsx';
import { inputClass } from '../forms.tsx';

const selectClass = `${inputClass} w-auto`;

type CourtColorKey = 'fieldOurs' | 'fieldOpponent' | 'linesOurs' | 'linesOpponent' | 'arrowsOurs' | 'arrowsOpponent';

/** Colour shown by the picker while the colour is automatic (the picker needs a value). */
const AUTO_SWATCH = '#808080';

const THICKNESS = [
  { value: 0.5, label: 'Molto sottile' },
  { value: 0.75, label: 'Sottile' },
  { value: 1, label: 'Normale' },
  { value: 1.5, label: 'Spesso' },
  { value: 2, label: 'Molto spesso' },
  { value: 3, label: 'Massimo' },
].filter((t) => t.value >= COURT_WIDTH_MIN && t.value <= COURT_WIDTH_MAX);

function OptionalColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value ?? AUTO_SWATCH}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="h-9 w-12 cursor-pointer rounded-card border border-border bg-surface-2"
      />
      <span className="text-sm text-text">{label}</span>
      {value === undefined ? (
        <span className="text-xs text-muted">Automatico (segue il tema)</span>
      ) : (
        <>
          <span className="font-mono text-xs text-muted">{value}</span>
          <Button variant="ghost" aria-label={`${label}: torna automatico`} onClick={() => onChange(undefined)}>
            Automatico
          </Button>
        </>
      )}
    </div>
  );
}

/** Options of «Mappe di campo»: colours of field, lines and arrows (our team, opponent) and their thickness. */
export function CourtOptionsFields({
  block,
  onChange,
}: {
  block: Extract<LayoutBlock, { type: 'court' }>;
  onChange: (block: LayoutBlock) => void;
}) {
  const { options } = block;
  const setColor = (key: CourtColorKey, value: string | undefined): void => {
    const next: CourtOptions = { ...options };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange({ ...block, options: next });
  };
  const color = (key: CourtColorKey, label: string) => (
    <OptionalColor label={label} value={options[key]} onChange={(v) => setColor(key, v)} />
  );
  const width = (key: 'lineWidth' | 'arrowWidth', label: string) => (
    <label className="flex items-center gap-2 text-sm text-text">
      {label}
      <select
        className={selectClass}
        value={options[key]}
        onChange={(e) => onChange({ ...block, options: { ...options, [key]: Number(e.target.value) } })}
      >
        {THICKNESS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Fondo del campo</legend>
        {color('fieldOurs', 'Metà della nostra squadra')}
        {color('fieldOpponent', 'Metà dell’avversario')}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Linee del campo (perimetro, 3 metri, rete)</legend>
        {color('linesOurs', 'Linee della nostra metà (e rete)')}
        {color('linesOpponent', 'Linee della metà avversaria')}
        {width('lineWidth', 'Spessore delle linee')}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Traiettorie di attacco e battuta</legend>
        <p className="text-xs text-muted">
          Con un colore scelto, le traiettorie di quella squadra hanno quel colore per ogni valutazione: non si
          distinguono più le valutazioni dal colore.
        </p>
        {color('arrowsOurs', 'Traiettorie della nostra squadra')}
        {color('arrowsOpponent', 'Traiettorie dell’avversario')}
        {width('arrowWidth', 'Spessore delle traiettorie')}
      </fieldset>
    </div>
  );
}
