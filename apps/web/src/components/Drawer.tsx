import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { useModalDialog } from './useModalDialog.ts';

/**
 * Side panel from the right over the page, with a dimmed background (full width on a phone). A modal dialog: title,
 * the focus goes to the first field (or to the title) and comes back to the button that opened it, Esc and a click
 * outside close it (`onClose`, it must be stable: wrap it in `useCallback`), Tab stays inside.
 */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const { root, trap } = useModalDialog(onClose);
  // After the hook has focused the title: the first field of the form, when there is one.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('input:not([disabled]), select, textarea')?.focus();
  }, [root]);
  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-bg/70" onClick={onClose} role="presentation">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trap}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col border-l border-border bg-surface shadow-xl sm:max-w-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-text outline-none">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Chiudi"
            onClick={onClose}
            className="rounded px-2 py-1 text-xl leading-none text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
