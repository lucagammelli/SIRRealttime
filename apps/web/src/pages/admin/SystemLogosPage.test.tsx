import type { SystemLogo, SystemLogos } from '@arenalive/shared';
import { NO_SYSTEM_LOGOS } from '@arenalive/shared';
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
const LEFT_DARK = { ...LEFT, url: '/api/public/system-logos/00000000-0000-4000-8000-000000000003', width: 140 };

type Pair = { positive: SystemLogo | null; negative: SystemLogo | null };
const pair = (positive: SystemLogo | null, negative: SystemLogo | null = null): Pair => ({ positive, negative });
const logos = (left: Pair, right: Pair = pair(null)): SystemLogos => ({ left, right });

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
  const current = useSystemLogos();
  const text = [current.left.positive, current.left.negative, current.right.positive, current.right.negative]
    .map((l) => l?.url ?? '-')
    .join(' ');
  return <output data-testid="testata">{text}</output>;
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
  act(() => setSystemLogos(NO_SYSTEM_LOGOS));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Loghi di sistema»', () => {
  it('four places: left and right, positive and negative, each previewed on its background', async () => {
    mockServer(logos(pair(LEFT, LEFT_DARK)));
    renderPage();
    const leftPositive = await screen.findByRole('group', { name: 'Logo a sinistra positivo' });
    expect(within(leftPositive).getByText('Positivo · per sfondi chiari')).toBeTruthy();
    const img = within(leftPositive).getByRole('img', { name: 'Logo a sinistra positivo' });
    expect(img.getAttribute('src')).toBe(LEFT.url);
    expect(img.closest('[data-sir-scope]')?.getAttribute('data-theme')).toBe('light');
    expect(within(leftPositive).getByText('150×50 px')).toBeTruthy();
    expect(within(leftPositive).getByLabelText('Sostituisci: logo a sinistra positivo')).toBeTruthy();
    const leftNegative = slot('Logo a sinistra negativo');
    expect(within(leftNegative).getByText('Negativo · per sfondi scuri')).toBeTruthy();
    const dark = within(leftNegative).getByRole('img', { name: 'Logo a sinistra negativo' });
    expect(dark.getAttribute('src')).toBe(LEFT_DARK.url);
    expect(dark.closest('[data-sir-scope]')?.getAttribute('data-theme')).toBe('dark');
    for (const name of ['Logo a destra positivo', 'Logo a destra negativo']) {
      const empty = slot(name);
      expect(within(empty).getByText('Nessun logo')).toBeTruthy();
      expect(within(empty).getByLabelText(`Carica: ${name.toLowerCase()}`)).toBeTruthy();
      expect(within(empty).queryByRole('button', { name: `Rimuovi ${name.toLowerCase()}` })).toBeNull();
    }
    expect(screen.getAllByRole('group')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Logo a sinistra' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Logo a destra' })).toBeTruthy();
    expect(screen.getAllByText(/al massimo 150×50 px/)).toHaveLength(2);
  });

  it('previews the header in the light and in the dark theme', async () => {
    mockServer(logos(pair(LEFT, LEFT_DARK), pair(RIGHT)));
    renderPage();
    const light = await screen.findByTestId('anteprima-testata-light');
    const dark = screen.getByTestId('anteprima-testata-dark');
    expect(light.querySelector('[data-sir-scope]')?.getAttribute('data-theme')).toBe('light');
    expect(dark.querySelector('[data-sir-scope]')?.getAttribute('data-theme')).toBe('dark');
    for (const preview of [light, dark]) {
      const row = within(preview).getByTestId('loghi-di-sistema');
      expect(row.querySelectorAll('img')).toHaveLength(2);
    }
  });

  it('without logos: no preview of the header', async () => {
    mockServer(NO_SYSTEM_LOGOS);
    renderPage();
    expect(await screen.findByText('Nessun logo: le testate restano come sono.')).toBeTruthy();
    expect(screen.queryByTestId('loghi-di-sistema')).toBeNull();
  });

  it('uploads a logo as base64 with PUT on its side and variant; the headers follow at once', async () => {
    const calls = mockServer(logos(pair(LEFT)), {
      'PUT /api/admin/system-logos/right/negative': json(logos(pair(LEFT), pair(null, RIGHT))),
    });
    renderPage();
    const input = await screen.findByLabelText('Carica: logo a destra negativo');
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"/>'], 'logo.svg', {
      type: 'image/svg+xml',
    });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(within(slot('Logo a destra negativo')).getByRole('img').getAttribute('src')).toBe(RIGHT.url),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/admin/system-logos/right/negative');
    expect(put?.body).toEqual({ data: btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"/>') });
    expect(screen.getByTestId('testata').textContent).toBe(`${LEFT.url} - - ${RIGHT.url}`);
    expect(within(slot('Logo a destra positivo')).getByText('Nessun logo')).toBeTruthy();
  });

  it('shows why the server refuses a logo too large, and keeps the old one', async () => {
    mockServer(logos(pair(LEFT)), {
      'PUT /api/admin/system-logos/left/positive': json(
        { error: 'Logo troppo grande: al massimo 150×50 px, questo è 300×100 px' },
        422,
      ),
    });
    renderPage();
    const input = await screen.findByLabelText('Sostituisci: logo a sinistra positivo');
    fireEvent.change(input, { target: { files: [new File(['x'], 'grande.png', { type: 'image/png' })] } });
    expect(await screen.findByText('Logo troppo grande: al massimo 150×50 px, questo è 300×100 px.')).toBeTruthy();
    expect(within(slot('Logo a sinistra positivo')).getByRole('img').getAttribute('src')).toBe(LEFT.url);
  });

  it('replaces and removes with a confirmation', async () => {
    const calls = mockServer(logos(pair(LEFT), pair(RIGHT)), {
      'PUT /api/admin/system-logos/left/positive': json(logos(pair(NEW_LEFT), pair(RIGHT))),
      'DELETE /api/admin/system-logos/right/positive': json(logos(pair(NEW_LEFT))),
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Sostituisci: logo a sinistra positivo'), {
      target: { files: [new File(['png'], 'nuovo.png', { type: 'image/png' })] },
    });
    await waitFor(() =>
      expect(within(slot('Logo a sinistra positivo')).getByRole('img').getAttribute('src')).toBe(NEW_LEFT.url),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi logo a destra positivo' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Conferma rimozione' }));
    await waitFor(() => expect(within(slot('Logo a destra positivo')).getByText('Nessun logo')).toBeTruthy());
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      '/api/admin/system-logos/right/positive',
    ]);
    expect(screen.getByTestId('testata').textContent).toBe(`${NEW_LEFT.url} - - -`);
  });
});
