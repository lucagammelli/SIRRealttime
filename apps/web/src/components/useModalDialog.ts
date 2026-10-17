import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Behaviour of a modal dialog: the focus goes to its first `h2` when it opens and back to the previous element when it
 * closes, Esc closes it (`onClose`), Tab stays inside it (`trap`, to put on the dialog as `onKeyDown`).
 */
export function useModalDialog(onClose: () => void): {
  root: RefObject<HTMLDivElement | null>;
  trap: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
} {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.querySelector<HTMLElement>('h2')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [onClose]);

  const trap = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const end = items[items.length - 1];
    if (!first || !end) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault();
      first.focus();
    }
  }, []);
  return { root, trap };
}
