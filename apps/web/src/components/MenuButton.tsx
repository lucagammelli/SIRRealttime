import type { Ref } from 'react';

/** Button of the compact menu (phone): 44 × 44 px, says whether the menu is open (`aria-expanded`). */
export function MenuButton({
  open,
  controls,
  onToggle,
  className = '',
  ref,
}: {
  open: boolean;
  /** Id of the menu it opens. */
  controls: string;
  onToggle: () => void;
  className?: string;
  /** The button itself: the menu gives the focus back to it when it closes. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? 'Chiudi il menu' : 'Apri il menu'}
      onClick={onToggle}
      className={`inline-flex size-11 items-center justify-center rounded-button border border-border bg-surface text-text hover:bg-hover ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
      </svg>
    </button>
  );
}
