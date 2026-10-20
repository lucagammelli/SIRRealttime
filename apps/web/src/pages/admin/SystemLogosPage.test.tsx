import type { SystemLogos } from '@sir/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSystemLogos, useSystemLogos } from '../../lib/systemLogos.ts';
import { AuthProvider } from './auth.tsx';
import { SystemLogosPage } from './SystemLogosPage.tsx';

const SUPERADMIN = {
  user: { id: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', email: 'super@sir.test', role: 'superadmin', tenant: null },
  isAdmin: true,
  isSuperadmin: true,
  updateUser: () => undefined,
  logout: () => Promise.resolve(),
  sessionExpired: () => undefined,
} as const;

const LEFT = {
  url: '/api/public/system-logos/00000000-0000-4000-8000-000000000001',
  mime: 'image/png',
  width: 150,
  height: 50,
} as const;
const NEW_LEFT = { ...LEFT, url: '/api/public/system-logos/00000000-0000-4000-8000-000000000009', width: 120 };
const RIGHT = {
  ...LEFT,
  url: '/api/public/system-logos/00000000-0000-4000-8000-000000000002',
  mime: 'image/svg+xml',
} as const;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockServer(initial: SystemLogos, answers: Partial<Record<string, Response>> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      const answer = answers[`${method} ${url}`];
      return Promise.resolve(answer ?? json(initial));
    }),
  );
  return calls;
}

/** What the headers of the portal read (the store of the system logos). */
function Headers() {
  const logos = useSystemLogos();
  return <output data-testid="testata">{[logos.left?.url ?? '-', logos.right?.url ?? '-'].join(' ')}</output>;
}

const renderPage = () =>
  render(
    <AuthProvider value={SUPERADMIN}>
      <SystemLogosPage />
      <Headers />
    </AuthProvider>,
  );

const slot = (name: string) => screen.getByRole('group', { name });

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  act(() => setSystemLogos({ left: null, right: null }));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Loghi di sistema»', () => {
  it('shows the two slots with their logos, the preview of the header and the limits', async () => {
    mockServer({ left: LEFT, right: null });
    renderPage();
    const left = await screen.findByRole('group', { name: 'Logo a sinistra' });
    expect(within(left).getByRole('img', { name: 'Logo a sinistra' }).getAttribute('src')).toBe(LEFT.url);
    expect(within(left).getByText('150×50 px')).toBeTruthy();
    expect(within(left).getByLabelText('Sostituisci: logo a sinistra')).toBeTruthy();
    const right = slot('Logo a destra');
    expect(within(right).getByText('Nessun logo')).toBeTruthy();
    expect(within(right).getByLabelText('Carica: logo a destra')).toBeTruthy();
    expect(within(right).queryByRole('button', { name: 'Rimuovi logo a destra' })).toBeNull();
    expect(screen.getAllByText(/al massimo 150×50 px/)).toHaveLength(2);
    expect(screen.getByTestId('loghi-di-sistema').querySelectorAll('img')).toHaveLength(1);
  });

  it('uploads a logo as base64 with PUT; the headers follow at once', async () => {
    const calls = mockServer(
      { left: LEFT, right: null },
      { 'PUT /api/admin/system-logos/right': json({ left: LEFT, right: RIGHT }) },
    );
    renderPage();
    const input = await screen.findByLabelText('Carica: logo a destra');
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"/>'], 'logo.svg', {
      type: 'image/svg+xml',
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(within(slot('Logo a destra')).getByRole('img').getAttribute('src')).toBe(RIGHT.url));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/admin/system-logos/right');
    expect(put?.body).toEqual({ data: btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"/>') });
    expect(screen.getByTestId('testata').textContent).toBe(`${LEFT.url} ${RIGHT.url}`);
  });

  it('shows why the server refuses a logo too large, and keeps the old one', async () => {
    mockServer(
      { left: LEFT, right: null },
      {
        'PUT /api/admin/system-logos/left': json(
          { error: 'Logo troppo grande: al massimo 150×50 px, questo è 300×100 px' },
          422,
        ),
      },
    );
    renderPage();
    const input = await screen.findByLabelText('Sostituisci: logo a sinistra');
    fireEvent.change(input, { target: { files: [new File(['x'], 'grande.png', { type: 'image/png' })] } });
    expect(await screen.findByText('Logo troppo grande: al massimo 150×50 px, questo è 300×100 px.')).toBeTruthy();
    expect(within(slot('Logo a sinistra')).getByRole('img').getAttribute('src')).toBe(LEFT.url);
  });

  it('replaces and removes with a confirmation', async () => {
    const calls = mockServer(
      { left: LEFT, right: RIGHT },
      {
        'PUT /api/admin/system-logos/left': json({ left: NEW_LEFT, right: RIGHT }),
        'DELETE /api/admin/system-logos/right': json({ left: NEW_LEFT, right: null }),
      },
    );
    renderPage();
    fireEvent.change(await screen.findByLabelText('Sostituisci: logo a sinistra'), {
      target: { files: [new File(['png'], 'nuovo.png', { type: 'image/png' })] },
    });
    await waitFor(() =>
      expect(within(slot('Logo a sinistra')).getByRole('img').getAttribute('src')).toBe(NEW_LEFT.url),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi logo a destra' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Conferma rimozione' }));
    await waitFor(() => expect(within(slot('Logo a destra')).getByText('Nessun logo')).toBeTruthy());
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/admin/system-logos/right']);
    expect(screen.getByTestId('testata').textContent).toBe(`${NEW_LEFT.url} -`);
  });
});
