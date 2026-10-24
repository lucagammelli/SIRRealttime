import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createContext, Fragment, useContext, useEffect, useId, useRef, useState } from 'react';
import { useTouch } from '../lib/useLayout.ts';
import { FitCellContext, FitToBox } from './FitToBox.tsx';

/**
 * A name of the scout file (team, player) that may wrap also after `_`, `/`, `-` and `.` («PERUGIA_AMICHEVOLI»):
 * a line break opportunity (`<wbr>`) after each of them, so a long name wraps between its parts instead of in the
 * middle of a word. Only React text.
 */
export function BreakableName({ text }: { text: string }) {
  const parts = text.split(/(?<=[_/.-])/u);
  let offset = 0;
  return (
    <>
      {parts.map((part, i) => {
        // Key: where the part starts in the string (parts of one string never move).
        const key = offset;
        offset += part.length;
        return (
          <Fragment key={key}>
            {part}
            {i < parts.length - 1 && <wbr />}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Cards inside this context become collapsible sections (phone layout of the match page): the title is a button with
 * `aria-expanded`, the body is shown only while open.
 */
export interface CardCollapse {
  collapsible: boolean;
  defaultOpen: boolean;
}
export const CardCollapseContext = createContext<CardCollapse>({ collapsible: false, defaultOpen: true });

/** Panel with a title: every block of the match page and of the admin area. */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const collapse = useContext(CardCollapseContext);
  const touch = useTouch();
  // Without touch the sections of the phone cannot be opened or closed: all open.
  const collapsible = collapse.collapsible && title !== undefined && touch;
  const [open, setOpen] = useState(collapse.defaultOpen);
  const bodyId = useId();
  const shown = !collapsible || open;
  const fit = useContext(FitCellContext) && !touch;
  return (
    <section
      className={`sir-surface sir-card flex min-w-0 flex-col rounded-panel border border-border shadow-card ${className}`}
    >
      {(title || actions) && (
        <header
          data-open={shown}
          className={`sir-card-head flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 ${shown ? 'pt-4' : 'py-1'}`}
        >
          {/* At least 12 rem for the title: narrower, the actions go to the next line (never a word per line). */}
          <div className="min-w-0 flex-[1_1_12rem]">
            {title &&
              (collapsible ? (
                <h2 className="sir-card-title font-display text-lg font-semibold uppercase tracking-wide text-text">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => setOpen((o) => !o)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 text-left uppercase"
                  >
                    {title}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className={`size-5 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </h2>
              ) : (
                <h2 className="sir-card-title font-display text-lg font-semibold uppercase tracking-wide text-text">
                  {title}
                </h2>
              ))}
            {subtitle && shown && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && shown && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {/* Closed: the body stays as the target of aria-controls, empty (charts are built when it opens). */}
      {/* In a cell of a screen without touch the body never scrolls: its content fits it (scaled, «+N»). */}
      <div
        id={bodyId}
        hidden={!shown}
        data-fit={fit ? '' : undefined}
        className={`sir-card-body min-h-0 flex-1 px-4 pb-4 pt-3 sm:px-5 ${fit ? '' : bodyClassName}`}
      >
        {shown && (fit ? <FitToBox className={bodyClassName}>{children}</FitToBox> : children)}
      </div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  secondary: 'border border-border bg-surface-2 text-text hover:bg-surface',
  danger: 'border border-danger bg-danger-soft text-danger hover:opacity-90',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
};

/** Classes of a button, also for a link that looks like one (e.g. a download). */
export const buttonClass = (variant: ButtonVariant = 'secondary'): string =>
  `inline-flex min-h-9 items-center justify-center gap-2 rounded-button px-3 py-1.5 pointer-coarse:min-h-11 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]}`;

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`${buttonClass(variant)} ${className}`} {...rest} />;
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

/**
 * Group of mutually exclusive buttons (set, team, skill filters): colours of the tokens (`--sir-seg-*`: the active
 * one in red and the others grey in the template «SIR VOLLEY»); 44 px high on touch screens.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'xs';
}) {
  // Without touch the view stays the default one: no selector.
  if (!useTouch()) return null;
  const pad = size === 'xs' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap rounded-button border border-border bg-seg p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-[calc(var(--sir-radius-button)-2px)] font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${pad} ${
              active ? 'bg-seg-active text-on-seg-active shadow-card' : 'text-seg-text hover:bg-hover hover:text-text'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted">
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      <span>{children}</span>
      {onRetry && (
        <Button variant="danger" onClick={onRetry}>
          Riprova
        </Button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

/** Copies `text` to the clipboard; the label confirms for two seconds. */
export function CopyButton({ text, label = 'Copia' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = (): void => {
    const done = (s: 'done' | 'failed'): void => {
      setState(s);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    };
    if (!navigator.clipboard) return done('failed');
    navigator.clipboard.writeText(text).then(
      () => done('done'),
      () => done('failed'),
    );
  };
  return (
    <Button variant="primary" onClick={copy} aria-live="polite">
      {state === 'done' ? 'Copiato' : state === 'failed' ? 'Copia non riuscita: seleziona il testo' : label}
    </Button>
  );
}

/** Text shown once (tokens, links), selectable. */
export function SecretBox({ title, value, children }: { title: string; value: string; children?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-card border border-live bg-success-soft p-4">
      <p className="text-sm font-semibold text-text">{title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-card bg-surface px-3 py-2 font-mono text-sm text-text select-all">
          {value}
        </code>
        <CopyButton text={value} />
      </div>
      {children}
    </div>
  );
}
