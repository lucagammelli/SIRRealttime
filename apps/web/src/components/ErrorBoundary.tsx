import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { ErrorBox } from './ui.tsx';

/** Key of sessionStorage: the page was already reloaded once after a file of the portal could not be loaded. */
export const RELOAD_KEY = 'sir-ricaricata-per-file';

/**
 * Pure-ish: the reload after a lazy file that does not exist any more (a new version of the portal was published while
 * the tab was open). Once per session, so a real fault never loops. Returns true when it reloads.
 */
export function reloadOnceForMissingFile(reload: () => void = () => window.location.reload()): boolean {
  try {
    if (window.sessionStorage.getItem(RELOAD_KEY) === '1') return false;
    window.sessionStorage.setItem(RELOAD_KEY, '1');
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Without it any error while drawing a page (or a file of the portal that cannot be loaded) removes the whole page
 * from the screen: a blank page. Shows a message in Italian and a button to reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(prev: { resetKey?: string }): void {
    // Another page: the error of the previous one is forgotten.
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The portal has no logger of its own; the console is where a person looks first.
    console.error('Errore nella pagina', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="p-4">
        <ErrorBox onRetry={() => window.location.reload()}>
          La pagina non si è caricata. Se hai lasciato il portale aperto a lungo, è stato aggiornato: ricarica la
          pagina.
        </ErrorBox>
      </div>
    );
  }
}
