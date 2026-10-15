import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AdminApp } from './AdminApp.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';

/** Socket that never opens: the live page stays on «Connessione…». */
class SilentSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  close(): void {}
}

function mockServer(role: 'admin' | 'viewer'): void {
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = input;
      const body = url === '/api/auth/me' ? { id: USER_ID, email: 'a@b.it', role, tenant: null } : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = (): string => screen.getByTestId('where').textContent ?? '';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin navigation', () => {
  it('goes to the right page from every menu item, always with absolute paths', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    const pages: [string, string, string][] = [
      ['Partite', '/admin/partite', 'Partite'],
      ['Link pubblici', '/admin/link', 'Nuovo link pubblico'],
      ['Agenti', '/admin/agenti', 'Nuovo agente'],
      ['Utenti', '/admin/utenti', 'Nuovo utente'],
      ['Partita live', '/admin/live', 'Connessione alla partita'],
      ['Partite', '/admin/partite', 'Partite'],
    ];
    for (const [label, path, heading] of pages) {
      fireEvent.click(within(nav).getByRole('link', { name: label }));
      expect(where()).toBe(path);
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('keeps «Partite» active on the detail of a match', async () => {
    mockServer('admin');
    renderAt(`/admin/partite/${USER_ID}`);
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    expect(within(nav).getByRole('link', { name: 'Partite' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Partita live' }).getAttribute('aria-current')).toBeNull();
  });

  it('sends an unknown address to /admin/live without loops', async () => {
    mockServer('admin');
    renderAt('/admin/xyz/abc');
    await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(where()).toBe('/admin/live'));
    expect(await screen.findByRole('heading', { name: 'Connessione alla partita' })).toBeTruthy();
  });

  it('sends a viewer away from the admin-only pages', async () => {
    mockServer('viewer');
    renderAt('/admin/agenti');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(where()).toBe('/admin/live'));
    expect(within(nav).queryByRole('link', { name: 'Agenti' })).toBeNull();
  });
});
