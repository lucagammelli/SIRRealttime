import { useState } from 'react';
import type { InstallApp } from '../lib/pwa.ts';

const BUTTON_CLASS =
  'inline-flex h-9 items-center gap-2 rounded-button border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:min-w-11 sm:px-3';

/** Short instructions for iPhone and iPad, which have no install prompt. */
export const IOS_INSTALL_TEXT = 'Per installare l’app tocca Condividi, poi «Aggiungi a Home».';

/**
 * «Installa come app» of the public page: where the browser offers the installation it opens the prompt; on iPhone and
 * iPad (no prompt) it shows the short instructions. Nothing where neither is possible (already installed, other
 * browsers). The instructions are a status message under the page controls, closable.
 */
export function InstallButton({ app }: { app: InstallApp }) {
  const [help, setHelp] = useState(false);
  if (!app.canInstall && !app.iosHelp) return null;
  return (
    <>
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-label="Installa come app"
        title="Installa come app"
        aria-expanded={app.canInstall ? undefined : help}
        onClick={() => (app.canInstall ? void app.install() : setHelp((h) => !h))}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
        </svg>
        {/* Phones: icon only (the name is in aria-label). */}
        <span className="hidden sm:inline">Installa come app</span>
      </button>
      {help && !app.canInstall && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-4 z-30 mx-auto flex max-w-md items-center gap-3 rounded-panel border border-border bg-surface px-4 py-3 text-sm text-text shadow-card"
        >
          <p className="min-w-0 flex-1">{IOS_INSTALL_TEXT}</p>
          <button type="button" className={BUTTON_CLASS} onClick={() => setHelp(false)}>
            Chiudi
          </button>
        </div>
      )}
    </>
  );
}

/** Discreet hint at the bottom of the page: the first touch asks for full screen (see `useFullscreenOnFirstTouch`). */
export function FullscreenHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p
      data-testid="suggerimento-schermo-intero"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-30 mx-auto w-fit max-w-[90%] rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-muted shadow-card"
    >
      Tocca per lo schermo intero
    </p>
  );
}
