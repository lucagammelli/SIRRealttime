import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

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
  return (
    <section className={`flex min-w-0 flex-col rounded-panel border border-border bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-text">{title}</h2>}
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 px-4 pb-4 pt-3 sm:px-5 ${bodyClassName}`}>{children}</div>
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

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-card px-3 py-1.5 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

/** Group of mutually exclusive buttons (set, team, skill filters). */
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
  const pad = size === 'xs' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap rounded-card border border-border bg-surface-2 p-0.5"
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
            className={`rounded-[calc(var(--sir-radius)-2px)] font-medium transition-colors ${pad} ${
              active ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text'
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
