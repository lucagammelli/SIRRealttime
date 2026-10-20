import type { FocusEvent, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { Button } from '../../../components/ui.tsx';
import { ConfirmButton } from '../forms.tsx';
import type { StudioModel, StudioScene, StudioTarget } from './model.ts';

/** What the settings of a section tell the Studio: hover (highlight in the preview) and «Compare: …» (scene). */
export interface StudioUiValue {
  /** Highlights the elements of a setting in the preview; null: none. `scene`: where they show (null: everywhere). */
  hover: (targets: readonly StudioTarget[] | null, scene: StudioScene | null) => void;
  /** Shows a scene in the preview. */
  showScene: (scene: StudioScene) => void;
  /** Setting just opened from the preview (its id): it is marked for a moment. */
  flash: string | null;
}

export const StudioUiContext = createContext<StudioUiValue>({
  hover: () => undefined,
  showScene: () => undefined,
  flash: null,
});

export const useStudioUi = (): StudioUiValue => useContext(StudioUiContext);

/** DOM id of a setting (target of «clicca un elemento dell’anteprima»). */
export const settingDomId = (id: string): string => `studio-${id}`;

/**
 * One setting of a section: its controls (`children`) and the line «Compare: …», a button that shows the scene where
 * it appears. Passing over it (mouse or keyboard focus) highlights its elements in the preview.
 */
export function Setting({
  id,
  where,
  scene,
  targets,
  children,
  className = '',
}: {
  id: string;
  /** Where and when it appears, after «Compare:». */
  where: string;
  /** Scene that shows it (null: every scene). */
  scene: StudioScene | null;
  targets: readonly StudioTarget[];
  children: ReactNode;
  className?: string;
}) {
  const ui = useStudioUi();
  const enter = (): void => ui.hover(targets, scene);
  const leave = (): void => ui.hover(null, null);
  const blur = (e: FocusEvent<HTMLDivElement>): void => {
    if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) leave();
  };
  const flashing = ui.flash === id;
  return (
    <div
      id={settingDomId(id)}
      data-studio-setting={id}
      tabIndex={-1}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={blur}
      className={`-mx-2 space-y-1.5 rounded-card border px-2 py-2 outline-none transition-colors motion-reduce:transition-none ${
        flashing
          ? 'border-focus bg-surface-2 ring-2 ring-focus'
          : 'border-transparent hover:border-border hover:bg-surface-2'
      } focus-within:border-border ${className}`}
    >
      {children}
      <button
        type="button"
        onClick={() => {
          if (scene) ui.showScene(scene);
        }}
        className="flex items-start gap-1.5 text-left text-xs text-muted hover:text-text hover:underline"
      >
        <span aria-hidden="true" className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-accent" />
        <span>Compare: {where}</span>
      </button>
    </div>
  );
}

/** Group of settings with a small title. */
export function SettingsCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-border bg-surface p-3" aria-label={title}>
      {title && <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>}
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/** The settings used less often: closed at first. */
export function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-panel border border-dashed border-border px-3" data-studio-advanced="">
      <summary className="cursor-pointer py-2 text-sm text-muted hover:text-text">Avanzate</summary>
      <div className="space-y-1 pb-3">{children}</div>
    </details>
  );
}

/** Tabs of a section (or of a part of it): roving buttons with `role="tab"`. */
export function TabList<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  panelId,
  problem,
}: {
  label: string;
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  idPrefix: string;
  panelId: string;
  problem?: (value: T) => boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          id={`${idPrefix}-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={panelId}
          onClick={() => onChange(t.value)}
          className={`rounded-card px-3 py-1.5 text-sm font-medium ${
            value === t.value ? 'bg-nav-active text-on-nav-active' : 'text-muted hover:bg-hover hover:text-text'
          } ${problem?.(t.value) ? 'underline decoration-danger' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Ready-made models of a section: one click applies one (the preview follows); after any change by hand the section
 * is «Personalizzato».
 */
export function ModelPicker({
  labels,
  active,
  onApply,
}: {
  labels: Record<StudioModel, { label: string; hint: string }>;
  active: StudioModel | null;
  onApply: (model: StudioModel) => void;
}) {
  const models = Object.keys(labels) as StudioModel[];
  return (
    <SettingsCard title="Modelli pronti">
      <div role="radiogroup" aria-label="Modelli pronti" className="grid grid-cols-3 gap-2">
        {models.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active === m}
            onClick={() => onApply(m)}
            className={`flex min-h-11 flex-col items-center justify-center rounded-card border px-2 py-2 text-center text-sm font-medium text-text ${
              active === m ? 'border-primary bg-surface-2 ring-1 ring-primary' : 'border-border bg-bg hover:bg-hover'
            }`}
          >
            {labels[m].label}
            <span className="text-xs font-normal text-muted">{labels[m].hint}</span>
          </button>
        ))}
      </div>
      <p className="pt-1 text-xs text-muted" role="status">
        {active
          ? `Modello in uso: ${labels[active].label}.`
          : 'Personalizzato: hai cambiato qualcosa rispetto ai modelli.'}{' '}
        Un clic cambia l’anteprima; potrai ritoccare tutto.
      </p>
    </SettingsCard>
  );
}

/**
 * On/off switch: a real checkbox with `role="switch"` (keyboard, screen readers) drawn as a track with a knob, in the
 * colours of the tokens.
 */
export function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name (when there is no visible label around it). */
  label?: string;
  title?: string;
}) {
  return (
    <span className="relative inline-flex h-6 w-10 shrink-0" title={title}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-axis transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2 motion-reduce:transition-none"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-on-primary shadow-card transition-transform peer-checked:translate-x-4 motion-reduce:transition-none"
      />
    </span>
  );
}

/** A switch with its label on the left (settings «attivo/spento»). */
export function SwitchRow({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="flex min-h-9 items-center justify-between gap-3 text-sm font-medium text-text">
      <span className="min-w-0">{label}</span>
      <Toggle checked={checked} onChange={onChange} {...(ariaLabel ? { label: ariaLabel } : {})} />
    </label>
  );
}

/**
 * «Rimuovi» of an element of a list (block of the page, slide of a pause), always visible in its row. With
 * `confirm` (the element has options of its own that would be lost) it asks «Conferma rimozione» first.
 */
export function RemoveButton({ name, confirm, onRemove }: { name: string; confirm: boolean; onRemove: () => void }) {
  return confirm ? (
    <ConfirmButton
      label="Rimuovi"
      confirmLabel="Conferma rimozione"
      ariaLabel={`Rimuovi ${name}`}
      busy={false}
      onConfirm={onRemove}
    />
  ) : (
    <Button variant="ghost" aria-label={`Rimuovi ${name}`} onClick={onRemove}>
      Rimuovi
    </Button>
  );
}
