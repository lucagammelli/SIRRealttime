import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buttonClass } from './ui.tsx';

/** Width from which a tablet starts with the preview open (a phone starts with it closed, to leave room). */
const TABLET_MIN = 768;

/**
 * Preview of an editor of the reserved area that stays in view while the page scrolls.
 * Desktop (from 1280 px, the form and the preview side by side): sticky column on the right, at most as high as the
 * screen, scrolling inside if it is taller. Tablet and phone (the page is one column): the preview comes first, as a
 * sticky bar under the top bar, with a button that closes it (a phone starts with it closed) and a height limit.
 * The button «Anteprima a tutto schermo» opens `fullscreen` (the real, big view) in a `PreviewFullscreen`.
 * The parent must be `flex flex-col xl:grid`: a sticky grid item would not leave its row.
 */
export function PreviewDock({
  title = 'Anteprima',
  subtitle,
  children,
  fullscreen,
  fullscreenLabel = 'Anteprima a tutto schermo',
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** The big view, drawn only while the full screen preview is open. */
  fullscreen: ReactNode;
  fullscreenLabel?: string;
}) {
  const [open, setOpen] = useState(() => window.innerWidth >= TABLET_MIN);
  const [full, setFull] = useState(false);
  const bodyId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const closeFull = useCallback(() => setFull(false), []);
  return (
    <aside
      aria-label={title}
      data-testid="anteprima-fissa"
      className="sticky top-[var(--sir-navbar-height,3.5rem)] z-20 order-first max-h-[60dvh] min-w-0 overflow-y-auto overscroll-contain rounded-panel md:top-0 xl:top-6 xl:order-none xl:max-h-[calc(100dvh-3rem)] xl:self-start"
    >
      <section className="sir-surface sir-card flex min-w-0 flex-col rounded-panel border border-border shadow-card">
        {/* One compact row: title on the left, the two buttons on the right (a phone has little room). */}
        <header className="flex items-center gap-2 px-3 py-2 sm:px-5 xl:pt-4">
          <h2 className="sir-card-title mr-auto min-w-0 font-display text-lg font-semibold uppercase tracking-wide text-text">
            {title}
          </h2>
          <button
            type="button"
            ref={opener}
            className={buttonClass()}
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            onClick={() => setFull(true)}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
            <span className="hidden sm:inline">{fullscreenLabel}</span>
            <span className="sm:hidden">Schermo intero</span>
          </button>
          <button
            type="button"
            className={`${buttonClass()} xl:hidden`}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? 'Chiudi anteprima' : 'Apri anteprima'}
            title={open ? 'Chiudi anteprima' : 'Apri anteprima'}
            onClick={() => setOpen((o) => !o)}
          >
            <svg
              viewBox="0 0 24 24"
              className={`size-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </header>
        <div id={bodyId} className={`px-3 pb-3 sm:px-5 sm:pb-4 ${open ? '' : 'max-xl:hidden'}`}>
          {subtitle && <p className="mb-2 text-sm text-muted">{subtitle}</p>}
          {children}
        </div>
      </section>
      {full && (
        <PreviewFullscreen label={fullscreenLabel} onClose={closeFull} returnFocus={opener}>
          {fullscreen}
        </PreviewFullscreen>
      )}
    </aside>
  );
}

/**
 * Preview over the whole window. Asks the browser for real full screen (Fullscreen API) and, where it is not
 * available or refused (iPhone), stays an overlay on the whole window. Esc, the «Chiudi» button or leaving full screen
 * with the browser's own gesture close it. It is a modal dialog: the focus goes to «Chiudi», stays inside and goes back
 * to the button that opened it. `children` fill the area under the bar (height and width of the window).
 */
export function PreviewFullscreen({
  label,
  onClose,
  returnFocus,
  children,
}: {
  label: string;
  onClose: () => void;
  /** Button that opened the preview: it gets the focus back (Safari does not focus a button on click). */
  returnFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = root.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    // The page under it does not scroll while the preview is open.
    const rootStyle = document.documentElement.style;
    const overflow = rootStyle.overflow;
    rootStyle.overflow = 'hidden';
    let entered = false;
    if (el && typeof el.requestFullscreen === 'function') {
      // Refused (no gesture, policy, iPhone): the overlay on the whole window is already a good view.
      el.requestFullscreen().then(
        () => {
          entered = true;
        },
        () => undefined,
      );
    }
    // Left full screen by the browser (Esc, F11): the preview closes too.
    const onChange = (): void => {
      if (entered && !document.fullscreenElement) onClose();
    };
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onEscape);
      rootStyle.overflow = overflow;
      if (document.fullscreenElement === el && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => undefined);
      }
      (returnFocus?.current ?? before)?.focus();
    };
  }, [onClose, returnFocus]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Tab') {
      // The only control is «Chiudi»: the focus cannot leave the dialog.
      e.preventDefault();
      closeButton.current?.focus();
    }
  };

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="anteprima-schermo-intero"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex flex-col bg-bg text-text"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2">
        <h2 id={titleId} className="text-sm font-semibold text-text">
          {label}
        </h2>
        <button type="button" ref={closeButton} className={buttonClass()} onClick={onClose}>
          Chiudi
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 p-2">{children}</div>
    </div>,
    document.body,
  );
}
