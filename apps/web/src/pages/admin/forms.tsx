import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '../../components/ui.tsx';

export const inputClass =
  'block w-full rounded-card border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-focus';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Two-step button for destructive actions (revocations): no browser dialogs. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  busy,
  ariaLabel,
  className,
}: {
  label: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy: boolean;
  /** Accessible name of the first button when `label` alone is ambiguous (one button for every row of a list). */
  ariaLabel?: string;
  /** Classes of the first button (e.g. narrow padding when `label` is an icon). */
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (busy) return <Button disabled>Attendere…</Button>;
  if (!armed)
    return (
      <Button
        variant="ghost"
        onClick={() => setArmed(true)}
        {...(ariaLabel ? { 'aria-label': ariaLabel, title: ariaLabel } : {})}
        {...(className ? { className } : {})}
      >
        {label}
      </Button>
    );
  return (
    <span className="inline-flex gap-1">
      <Button variant="danger" onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Annulla
      </Button>
    </span>
  );
}
