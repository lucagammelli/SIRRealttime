import type { BrandingResponse, OverlaysResponse, TenantOverlays } from '@sir/shared';
import { defaultBranding, defaultOverlays, TenantOverlaysSchema } from '@sir/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const URL = '/api/admin/overlays';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

class SilentSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  close(): void {}
}

function mockServer(initial: TenantOverlays = defaultOverlays()): { calls: Call[] } {
  let overlays = initial;
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/auth/me')
        return json({
          id: USER_ID,
          email: 'a@sir.it',
          role: 'admin',
          tenant: { id: TENANT, slug: 'sir', name: 'Sir' },
        });
      if (url === URL && method === 'GET') return json({ tenantName: 'Sir', overlays } satisfies OverlaysResponse);
      if (url === URL && method === 'PUT') {
        overlays = TenantOverlaysSchema.parse(body);
        return json({ tenantName: 'Sir', overlays } satisfies OverlaysResponse);
      }
      if (url === '/api/admin/branding')
        return json({ tenantName: 'Sir', branding: defaultBranding() } satisfies BrandingResponse);
      if (url === '/api/public/tenant') return json({ error: 'Non trovato' }, 404);
      return json([]);
    }),
  );
  return { calls };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const row = async (kind: string): Promise<HTMLElement> => {
  await screen.findByRole('list', { name: 'Eventi' });
  const li = document.querySelector<HTMLElement>(`[data-overlay-kind="${kind}"]`);
  if (!li) throw new Error(`riga ${kind} mancante`);
  return li;
};
const lastPut = (calls: Call[]) => calls.filter((c) => c.url === URL && c.method === 'PUT').at(-1);

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('page «Avvisi»', () => {
  it('is in the menu of an admin, with every event, the placeholders and the text that results', async () => {
    mockServer();
    renderAt('/admin/avvisi');
    expect(await screen.findByRole('link', { name: 'Avvisi' })).toBeTruthy();
    const items = within(await screen.findByRole('list', { name: 'Eventi' })).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    for (const p of ['{giocatore}', '{numero}', '{squadra}', '{punteggio}', '{set}', '{serie}', '{attacchi}'])
      expect(screen.getByText(p)).toBeTruthy();
    const ace = await row('ace');
    expect(within(ace).getByRole('switch', { name: 'Ace' })).toHaveProperty('checked', true);
    // the text with the example match (home team, its first player)
    await waitFor(() => expect(within(ace).getByText(/^Risultato: ACE! /)).toBeTruthy());
    expect(within(await row('timeout')).getByRole('switch', { name: 'Time-out' })).toHaveProperty('checked', false);
  });

  it('refuses unknown placeholders and HTML before saving', async () => {
    mockServer();
    renderAt('/admin/avvisi');
    const ace = await row('ace');
    const text = within(ace).getByRole('textbox', { name: 'Testo' });
    fireEvent.change(text, { target: { value: 'ACE di {nome}' } });
    expect(within(ace).getByText(/segnaposto sconosciuto: \{nome\}/)).toBeTruthy();
    expect(text.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('non sono validi');
    expect(screen.getByRole('button', { name: 'Salva' })).toHaveProperty('disabled', true);
    expect(within(ace).getByRole('button', { name: 'Prova Ace' })).toHaveProperty('disabled', true);
    fireEvent.change(text, { target: { value: '<b>ACE</b>' } });
    expect(within(ace).getByText(/< e > non sono ammessi/)).toBeTruthy();
    fireEvent.change(text, { target: { value: 'Ace di {numero}!' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('changes text, seconds, priority and devices, and saves with PUT; restores the default', async () => {
    const { calls } = mockServer();
    renderAt('/admin/avvisi');
    const ace = await row('ace');
    fireEvent.change(within(ace).getByRole('textbox', { name: 'Testo' }), { target: { value: 'Ace di {numero}' } });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Secondi' }), { target: { value: '7' } });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Priorità' }), { target: { value: '10' } });
    fireEvent.click(within(ace).getByRole('checkbox', { name: 'Telefono' }));
    const tie = await row('tie');
    fireEvent.click(within(tie).getByRole('switch', { name: 'Pareggio' }));
    expect(screen.getByText('Modifiche non salvate.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText(/Avvisi salvati/)).toBeTruthy();
    const saved = lastPut(calls)?.body as TenantOverlays;
    expect(saved.ace).toEqual({
      enabled: true,
      text: 'Ace di {numero}',
      seconds: 7,
      priority: 10,
      devices: { tv: true, tablet: true, phone: false },
    });
    expect(saved.tie.enabled).toBe(false);
    expect(saved.block).toEqual(defaultOverlays().block);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/public/tenant')).toBe(true));
    fireEvent.click(within(await row('ace')).getByRole('button', { name: 'Ripristina predefinito Ace' }));
    expect(within(await row('ace')).getByRole('textbox', { name: 'Testo' })).toHaveProperty(
      'value',
      'ACE! {giocatore}',
    );
    expect(screen.getByText('Impostazioni predefinite per Ace.')).toBeTruthy();
  });

  it('«Prova» shows the overlay in the preview for its seconds, as plain text', async () => {
    mockServer();
    renderAt('/admin/avvisi');
    const mp = await row('matchPoint');
    const trial = await screen.findByTestId('prova-avviso');
    await waitFor(() =>
      expect(within(mp).getByRole('button', { name: 'Prova Match point' })).toHaveProperty('disabled', false),
    );
    vi.useFakeTimers();
    fireEvent.click(within(mp).getByRole('button', { name: 'Prova Match point' }));
    expect(trial.textContent).toMatch(/^MATCH POINT /);
    expect(trial.querySelector('[data-overlay="home"]')).toBeTruthy();
    expect(screen.getByText(/Prova di «Match point» nell’anteprima/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(trial.textContent).toBe('');
  });
});
