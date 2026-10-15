import { useTheme } from '../lib/theme.ts';

/** Light/dark switch (the default follows the system). */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === 'dark' ? 'chiaro' : 'scuro';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Passa al tema ${next}`}
      title={`Tema ${next}`}
      className="inline-flex size-9 items-center justify-center rounded-card border border-border bg-surface text-text hover:bg-surface-2"
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        {resolved === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}
