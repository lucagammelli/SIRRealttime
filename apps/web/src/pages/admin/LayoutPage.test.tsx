import type { AssetListResponse, AssetSummary, BrandingResponse, LayoutResponse, TenantLayout } from '@sir/shared';
import { defaultBranding, defaultLayout, TenantLayoutSchema } from '@sir/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.tsx';
import { addBlock, freeId, layoutProblems, moveBlock, removeBlock, resetDevice } from './layoutEditor.ts';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const SPONSOR = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';

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

const sponsorAsset: AssetSummary = {
  id: SPONSOR,
  kind: 'sponsor',
  mime: 'image/png',
  width: 300,
  height: 100,
  bytes: 1234,
  sha256: 'b'.repeat(64),
  createdAt: '2026-10-15T10:00:00.000Z',
  url: `/api/public/assets/${SPONSOR}`,
};

function mockServer(initial: TenantLayout = defaultLayout()): { calls: Call[] } {
  let layout = initial;
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
      if (url === '/api/admin/layout' && method === 'GET')
        return json({ tenantName: 'Sir', layout } satisfies LayoutResponse);
      if (url === '/api/admin/layout' && method === 'PUT') {
        layout = TenantLayoutSchema.parse(body);
        return json({ tenantName: 'Sir', layout } satisfies LayoutResponse);
      }
      if (url === '/api/admin/branding')
        return json({ tenantName: 'Sir', branding: defaultBranding() } satisfies BrandingResponse);
      if (url === '/api/admin/assets')
        return json({
          assets: [sponsorAsset],
          usedBytes: 1234,
          quotaBytes: 50 * 1024 * 1024,
        } satisfies AssetListResponse);
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

const blockList = () => screen.getByRole('list', { name: /^Blocchi/ });
const order = (): string[] =>
  Array.from(blockList().querySelectorAll<HTMLElement>(':scope > li')).map((li) => li.dataset.blockId ?? '');
const preview = (device: string) => screen.getByTestId(`anteprima-${device}`);
const lastPut = (calls: Call[]) => calls.filter((c) => c.url === '/api/admin/layout' && c.method === 'PUT').at(-1);

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editing helpers', () => {
  it('move, add, remove and reset the blocks of one device only', () => {
    const base = defaultLayout();
    expect(moveBlock(base, 'tv', 0, 2).tv.map((b) => b.id)).toEqual([
      'momentum',
      'comparison',
      'scoreboard',
      'players',
      'court',
      'rotations',
    ]);
    expect(moveBlock(base, 'tv', 5, 99).tv.at(-1)?.id).toBe('rotations');
    const added = addBlock(addBlock(base, 'tablet', 'message'), 'tablet', 'message');
    expect(added.tablet.slice(-2).map((b) => [b.id, b.width])).toEqual([
      ['message', 6],
      ['message-2', 6],
    ]);
    expect(added.tv).toBe(base.tv);
    expect(addBlock(base, 'tv', 'scoreboard')).toBe(base);
    expect(addBlock(base, 'phone', 'players').phone.at(-1)?.width).toBe(12);
    expect(removeBlock(base, 'phone', 'court').phone.map((b) => b.id)).not.toContain('court');
    expect(resetDevice(removeBlock(base, 'tv', 'court'), 'tv')).toEqual(base);
    expect(freeId(base.tv, 'court')).toBe('court-2');
  });

  it('finds the blocks with invalid options', () => {
    const layout = addBlock(defaultLayout(), 'phone', 'message');
    const broken = {
      ...layout,
      phone: layout.phone.map((b) => (b.type === 'message' ? { ...b, options: { ...b.options, text: ' ' } } : b)),
    };
    expect(layoutProblems(layout)).toEqual({});
    expect(layoutProblems(broken).phone).toEqual(new Set(['message']));
  });
});

describe('«Pagina pubblica» page', () => {
  it('is in the menu of an admin, with three device tabs and the preview of an example match', async () => {
    mockServer();
    renderAt('/admin/pagina');
    expect(await screen.findByRole('link', { name: 'Pagina pubblica' })).toBeTruthy();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['TV', 'Tablet', 'Telefono']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(order()).toEqual(['scoreboard', 'momentum', 'comparison', 'players', 'court', 'rotations']);
    // The example match is loaded on demand: the scoreboard of the preview shows its teams.
    const tv = await screen.findByTestId('anteprima-tv');
    expect(within(tv).getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    expect(preview('tv').style.aspectRatio).toBe('1920 / 1080');
    expect(screen.getByText(/Partita d’esempio/)).toBeTruthy();

    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 0, height: 120 } as DOMRect);
    fireEvent.click(screen.getByRole('tab', { name: 'Telefono' }));
    expect(preview('phone').style.aspectRatio).toBe('390 / 845');
    // The sticky scoreboard of the phone preview never changes the scroll of the reserved area.
    expect(within(preview('phone')).getByRole('region', { name: 'Tabellone' }).className).toContain('sticky');
    expect(document.documentElement.style.getPropertyValue('--sir-sticky-offset')).toBe('');
    rect.mockRestore();
    expect(screen.queryByLabelText(/^Larghezza:/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Tablet' }));
    expect(preview('tablet').style.aspectRatio).toBe('1024 / 768');
  });

  it('reorders with the keyboard buttons, keeping the focus on the moved block', async () => {
    mockServer();
    renderAt('/admin/pagina');
    const down = await screen.findByRole('button', { name: 'Sposta giù Tabellone' });
    expect(screen.getByRole('button', { name: 'Sposta su Tabellone' })).toHaveProperty('disabled', true);
    down.focus();
    fireEvent.click(down);
    expect(order().slice(0, 2)).toEqual(['momentum', 'scoreboard']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sposta giù Tabellone' }));
    expect(screen.getByText('Tabellone in posizione 2 di 6.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sposta su Tabellone' }));
    expect(order()[0]).toBe('scoreboard');
    // At the top the «su» button is disabled: the focus goes to «giù» of the same block.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sposta giù Tabellone' }));
    expect(screen.queryByText('Modifiche non salvate.')).toBeNull();
  });

  it('reorders by dragging a block onto another', async () => {
    mockServer();
    renderAt('/admin/pagina');
    await screen.findByRole('list', { name: /^Blocchi/ });
    const item = (id: string) => blockList().querySelector<HTMLElement>(`li[data-block-id="${id}"]`) as HTMLElement;
    const handle = item('rotations').querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(handle);
    fireEvent.dragOver(item('momentum'));
    expect(item('momentum').className).toContain('border-focus');
    fireEvent.drop(item('momentum'));
    fireEvent.dragEnd(handle);
    expect(order()).toEqual(['scoreboard', 'rotations', 'momentum', 'comparison', 'players', 'court']);
    expect(screen.getByText('Modifiche non salvate.')).toBeTruthy();
  });

  it('hides a block and changes its width, in the preview too', async () => {
    mockServer();
    renderAt('/admin/pagina');
    fireEvent.click(await screen.findByRole('tab', { name: 'Tablet' }));
    const shown = within(await screen.findByTestId('anteprima-tablet'));
    expect(await shown.findByRole('heading', { name: 'Rotazioni' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Visibile: Rotazioni' }));
    expect(shown.queryByRole('heading', { name: 'Rotazioni' })).toBeNull();

    const width = screen.getByRole('combobox', { name: 'Larghezza: Andamento del set' });
    expect(
      within(width)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['4', '6', '8', '12']);
    fireEvent.change(width, { target: { value: '12' } });
    // Width chosen for the desktop (container query of the grid, see tabletSpan).
    const cell = shown
      .getByRole('heading', { name: 'Andamento del set' })
      .closest('[class*="@min-[1150px]:col-span-12"]');
    expect(cell).toBeTruthy();
  });

  it('adds a message, saves the draft with PUT and restores the default page', async () => {
    const { calls } = mockServer();
    renderAt('/admin/pagina');
    fireEvent.click(await screen.findByRole('tab', { name: 'Tablet' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Tipo di blocco' }), { target: { value: 'message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
    expect(order().at(-1)).toBe('message');
    const text = screen.getByRole('textbox', { name: 'Testo del messaggio' });
    fireEvent.change(text, { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toContain('Tablet');
    expect(screen.getByRole('button', { name: 'Salva' })).toHaveProperty('disabled', true);
    fireEvent.change(text, { target: { value: 'Forza <b>Sir</b>!' } });
    expect(within(await screen.findByTestId('anteprima-tablet')).getByText('Forza <b>Sir</b>!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText(/Pagina pubblica salvata/)).toBeTruthy();
    expect(screen.queryByText('Modifiche non salvate.')).toBeNull();
    const saved = lastPut(calls)?.body as TenantLayout;
    expect(saved.tablet.at(-1)).toMatchObject({
      id: 'message',
      type: 'message',
      width: 6,
      options: { text: 'Forza <b>Sir</b>!' },
    });
    expect(saved.tv).toEqual(defaultLayout().tv);
    // After the save the portal reads its graphics (and layout) again.
    await waitFor(() => expect(calls.some((c) => c.url === '/api/public/tenant')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Ripristina predefinito' }));
    expect(order()).toEqual(['scoreboard', 'momentum', 'comparison', 'players', 'court', 'rotations']);
    expect(screen.getByText('Modifiche non salvate.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect((lastPut(calls)?.body as TenantLayout).tablet).toEqual(defaultLayout().tablet));
  });

  it('chooses the sponsor images among the images of the client', async () => {
    const { calls } = mockServer();
    renderAt('/admin/pagina');
    fireEvent.change(await screen.findByRole('combobox', { name: 'Tipo di blocco' }), { target: { value: 'sponsor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Immagine 1 · 300×100 px/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Secondi per immagine' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await screen.findByText(/Pagina pubblica salvata/);
    expect((lastPut(calls)?.body as TenantLayout).tv.at(-1)).toMatchObject({
      type: 'sponsor',
      options: { images: [SPONSOR], seconds: 12 },
    });
  });
  it('adds a player duel block for the TV, with the options of the statistics slides', async () => {
    const { calls } = mockServer();
    renderAt('/admin/pagina');
    fireEvent.change(await screen.findByRole('combobox', { name: 'Tipo di blocco' }), {
      target: { value: 'roleDuel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
    const period = screen.getByRole('combobox', { name: 'Periodo: Sfida per ruolo' });
    expect(within(period).getByRole('option', { name: 'Il set in corso' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Ruolo: Sfida per ruolo' }), { target: { value: 'libero' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await screen.findByText(/Pagina pubblica salvata/);
    expect((lastPut(calls)?.body as TenantLayout).tv.at(-1)).toMatchObject({
      type: 'roleDuel',
      options: { period: 'set', role: 'libero' },
    });
  });
  it('adds «Prossima partita» and «Classifica» with their options', async () => {
    const { calls } = mockServer();
    renderAt('/admin/pagina');
    const type = await screen.findByRole('combobox', { name: 'Tipo di blocco' });
    fireEvent.change(type, { target: { value: 'nextMatch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostra il codice QR: Prossima partita' }));
    fireEvent.change(type, { target: { value: 'standings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Righe: Classifica' }), { target: { value: 'top' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Quante righe: Classifica' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await screen.findByText(/Pagina pubblica salvata/);
    const tv = (lastPut(calls)?.body as TenantLayout).tv;
    expect(tv.at(-2)).toMatchObject({ type: 'nextMatch', options: { qr: false } });
    expect(tv.at(-1)).toMatchObject({ type: 'standings', options: { scope: 'top', count: 8 } });
  });
});
