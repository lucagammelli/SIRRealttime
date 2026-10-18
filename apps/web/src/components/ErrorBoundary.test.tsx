import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazy, Suspense, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, RELOAD_KEY, reloadOnceForMissingFile } from './ErrorBoundary.tsx';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Broken(): never {
  throw new Error('rotto');
}

describe('ErrorBoundary', () => {
  it('shows a message and a reload button instead of a blank page when a page fails to draw', () => {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/ricarica la pagina/);
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it('catches a file of the portal that cannot be loaded (lazy page of an older version)', async () => {
    const Gone = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    render(
      <ErrorBoundary>
        <Suspense fallback="carico">
          <Gone />
        </Suspense>
      </ErrorBoundary>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('forgets the error when the page changes', () => {
    function Host() {
      const [key, setKey] = useState('a');
      return (
        <>
          <button onClick={() => setKey('b')}>vai</button>
          <ErrorBoundary resetKey={key}>{key === 'a' ? <Broken /> : <p>pagina buona</p>}</ErrorBoundary>
        </>
      );
    }
    render(<Host />);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'vai' }));
    expect(screen.getByText('pagina buona')).toBeTruthy();
  });

  it('reloads once for a missing file, never twice in the same session', () => {
    const reload = vi.fn();
    expect(reloadOnceForMissingFile(reload)).toBe(true);
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe('1');
    expect(reloadOnceForMissingFile(reload)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
