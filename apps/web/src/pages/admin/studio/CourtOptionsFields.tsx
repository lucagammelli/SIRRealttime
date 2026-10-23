import type { CourtOptions, CourtSideMode, CourtSkillMode, LayoutBlock } from '@arenalive/shared';
import {
  COURT_CYCLE_SECONDS_MAX,
  COURT_CYCLE_SECONDS_MIN,
  COURT_SIDE_MODES,
  COURT_SKILL_MODES,
  COURT_TRICOLOR_DEFAULT,
  COURT_WIDTH_MAX,
  COURT_WIDTH_MIN,
} from '@arenalive/shared';
import { Button } from '../../../components/ui.tsx';
import { inputClass } from '../forms.tsx';

const selectClass = `${inputClass} w-auto`;

type CourtColorKey =
  'fieldOurs' | 'fieldOpponent' | 'fieldColor' | 'linesOurs' | 'linesOpponent' | 'arrowsOurs' | 'arrowsOpponent';

/** Labels of the view of the map without the touch filters. */
export const COURT_SIDE_LABELS: Record<CourtSideMode, string> = {
  cycle: 'A turno',
  ours: 'Solo la nostra squadra',
  home: 'Casa',
  away: 'Ospite',
};
export const COURT_SKILL_LABELS: Record<CourtSkillMode, string> = {
  attack: 'Attacco',
  serve: 'Battuta',
  cycle: 'A turno',
};
const CYCLE_SECONDS = [5, 10, 15, 20, 30, 45, 60].filter(
  (n) => n >= COURT_CYCLE_SECONDS_MIN && n <= COURT_CYCLE_SECONDS_MAX,
);
const isSideMode = (v: string): v is CourtSideMode => (COURT_SIDE_MODES as readonly string[]).includes(v);
const isSkillMode = (v: string): v is CourtSkillMode => (COURT_SKILL_MODES as readonly string[]).includes(v);

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
  const fieldMode = options.fieldMode ?? 'auto';
  const setFieldMode = (mode: string): void => {
    const next: CourtOptions = { ...options };
    delete next.fieldMode;
    if (mode === 'single' || mode === 'tricolor') next.fieldMode = mode;
    onChange({ ...block, options: next });
  };
  const bandColors = options.tricolor ?? COURT_TRICOLOR_DEFAULT;
  const setBand = (index: number, value: string): void => {
    const next: [string, string, string] = [bandColors[0], bandColors[1], bandColors[2]];
    next[index] = value;
    onChange({ ...block, options: { ...options, tricolor: next } });
  };
  const band = (index: number, label: string) => (
    <label className="flex flex-wrap items-center gap-2 text-sm text-text">
      <input
        type="color"
        aria-label={label}
        value={bandColors[index]}
        onChange={(e) => setBand(index, e.target.value.toLowerCase())}
        className="h-9 w-12 cursor-pointer rounded-card border border-border bg-surface-2"
      />
      {label}
      <span className="font-mono text-xs text-muted">{bandColors[index]}</span>
    </label>
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
  const inTurn = options.side === 'cycle' || options.skill === 'cycle';
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Cosa mostra senza tocco (TV)</legend>
        <p className="text-xs text-muted">
          Dove la pagina non si tocca la mappa mostra questa scelta; con il tocco (tablet, telefono) i filtri partono da
          qui.
        </p>
        <label className="flex flex-wrap items-center gap-2 text-sm text-text">
          Squadra
          <select
            className={selectClass}
            value={options.side}
            onChange={(e) => {
              if (isSideMode(e.target.value)) onChange({ ...block, options: { ...options, side: e.target.value } });
            }}
          >
            {COURT_SIDE_MODES.map((m) => (
              <option key={m} value={m}>
                {COURT_SIDE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-text">
          Fondamentale
          <select
            className={selectClass}
            value={options.skill}
            onChange={(e) => {
              if (isSkillMode(e.target.value)) onChange({ ...block, options: { ...options, skill: e.target.value } });
            }}
          >
            {COURT_SKILL_MODES.map((m) => (
              <option key={m} value={m}>
                {COURT_SKILL_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {inTurn && (
          <label className="flex flex-wrap items-center gap-2 text-sm text-text">
            Secondi per ogni vista
            <select
              className={selectClass}
              value={options.cycleSeconds}
              onChange={(e) => onChange({ ...block, options: { ...options, cycleSeconds: Number(e.target.value) } })}
            >
              {CYCLE_SECONDS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {options.side === 'ours' && (
          <p className="text-xs text-muted">
            La nostra squadra è quella scelta in «Colori e loghi» › «Squadra»; se nella partita non la si riconosce, si
            vede la squadra di casa.
          </p>
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Fondo del campo</legend>
        <label className="flex flex-wrap items-center gap-2 text-sm text-text">
          Colore del campo
          <select className={selectClass} value={fieldMode} onChange={(e) => setFieldMode(e.target.value)}>
            <option value="auto">Automatico</option>
            <option value="single">Colore singolo</option>
            <option value="tricolor">Tricolore</option>
          </select>
        </label>
        {fieldMode === 'auto' && (
          <>
            {color('fieldOurs', 'Metà della nostra squadra')}
            {color('fieldOpponent', 'Metà dell’avversario')}
          </>
        )}
        {fieldMode === 'single' && color('fieldColor', 'Colore del campo (le due metà)')}
        {fieldMode === 'tricolor' && (
          <>
            <p className="text-xs text-muted">
              Il campo è diviso in tre fasce di due colonne di zone; la fascia centrale sta a cavallo della rete.
            </p>
            {band(0, 'Fascia sinistra')}
            {band(1, 'Fascia centrale (sulla rete)')}
            {band(2, 'Fascia destra')}
          </>
        )}
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
