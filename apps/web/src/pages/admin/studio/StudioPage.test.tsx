import type {
  AssetListResponse,
  AssetSummary,
  MeResponse,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@sir/shared';
import {
  DEFAULT_BRAND_COLORS,
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  SLIDE_TYPES,
  TenantIntermissionsSchema,
  TenantLayoutSchema,
  TenantOverlaysSchema,
} from '@sir/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLIDE_LABELS } from '../../../blocks/IntermissionSlides.tsx';
import { BLOCKS, REGISTRY_TYPES } from '../../../blocks/registry.tsx';
import { setTenantLook } from '../../../lib/branding.ts';
import { AdminApp } from '../AdminApp.tsx';
import { contrastText, withOurTeamField } from './ColorsSection.tsx';
import { PREVIEW_WIDE_KEY } from './StudioPage.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../../../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const LOGO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const SPONSOR = '1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
const UPLOADED = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

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

const asset = (id: string, kind: 'logo' | 'sponsor', width = 300, height = 100): AssetSummary => ({
  id,
  kind,
  mime: 'image/png',
  width,
  height,
  bytes: 1234,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-15T10:00:00.000Z',
  url: `/api/public/assets/${id}`,
});

interface Saved {
  branding: TenantBranding;
  layout: TenantLayout;
  intermissions: TenantIntermissions;
  overlays: TenantOverlays;
}

/** Branding saved by default in these tests: something chosen (the guided setup does not open by itself). */
const SAVED_BRANDING: TenantBranding = { ...defaultBranding(), colors: { home: '#e30613' }, logoMain: LOGO };

function mockServer(
  initial: Partial<Saved> = {},
  role: MeResponse['role'] = 'admin',
): { calls: Call[]; puts: (url: string) => Call[] } {
  const saved: Saved = {
    branding: SAVED_BRANDING,
    layout: defaultLayout(),
    intermissions: defaultIntermissions(),
    overlays: defaultOverlays(),
    ...initial,
  };
  let assets = [asset(LOGO, 'logo', 240, 60), asset(SPONSOR, 'sponsor')];
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
        return json({ id: USER_ID, email: 'a@sir.it', role, tenant: { id: TENANT, slug: 'sir', name: 'Sir' } });
      if (url === '/api/admin/branding') {
        if (method === 'PUT') saved.branding = { ...defaultBranding(), ...(body as Partial<TenantBranding>) };
        return json({ tenantName: 'Sir', branding: saved.branding });
      }
      if (url === '/api/admin/layout') {
        if (method === 'PUT') saved.layout = TenantLayoutSchema.parse(body);
        return json({ tenantName: 'Sir', layout: saved.layout });
      }
      if (url === '/api/admin/intermissions') {
        if (method === 'PUT') saved.intermissions = TenantIntermissionsSchema.parse(body);
        return json({ tenantName: 'Sir', intermissions: saved.intermissions });
      }
      if (url === '/api/admin/overlays') {
        if (method === 'PUT') saved.overlays = TenantOverlaysSchema.parse(body);
        return json({ tenantName: 'Sir', overlays: saved.overlays });
      }
      if (url === '/api/admin/assets' && method === 'GET')
        return json({ assets, usedBytes: 2468, quotaBytes: 50 * 1024 * 1024 } satisfies AssetListResponse);
      if (url === '/api/admin/assets' && method === 'POST') {
        const created = asset(UPLOADED, 'logo', 64, 64);
        assets = [created, ...assets];
        return json(created, 201);
      }
      if (url.startsWith('/api/admin/assets/') && method === 'DELETE')
        return json({ error: 'Immagine in uso nella grafica: toglila prima di eliminarla' }, 409);
      if (url === '/api/public/tenant') return json({ error: 'Non trovato' }, 404);
      return json([]);
    }),
  );
  return { calls, puts: (u) => calls.filter((c) => c.url === u && c.method === 'PUT') };
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const studio = async () => {
  const el = await screen.findByTestId('studio');
  // the example match of the preview is loaded on demand
  await screen.findByTestId('anteprima-studio');
  return el;
};
const scope = () => screen.getByTestId('anteprima-studio');
const scopeVar = (name: string) => scope().style.getPropertyValue(name);
const sectionButton = (name: RegExp) =>
  within(screen.getByRole('navigation', { name: 'Sezioni dello Studio' })).getByRole('button', { name });
const scene = (name: string | RegExp) =>
  within(screen.getByRole('radiogroup', { name: 'Scena dell’anteprima' })).getByRole('radio', { name });
const checkedScene = () =>
  within(screen.getByRole('radiogroup', { name: 'Scena dell’anteprima' }))
    .getAllByRole('radio')
    .find((r) => r.getAttribute('aria-checked') === 'true')?.textContent;
const saveBar = () => screen.getByRole('region', { name: 'Modifiche non salvate' });
const save = () => fireEvent.click(within(saveBar()).getByRole('button', { name: 'Salva' }));
const blockOrder = (): string[] =>
  Array.from(screen.getByRole('list', { name: /^Blocchi/ }).querySelectorAll<HTMLElement>(':scope > li')).map(
    (li) => li.dataset.blockId ?? '',
  );
const slideOrder = (): string[] =>
  Array.from(screen.getByRole('list', { name: /^Diapositive/ }).querySelectorAll<HTMLElement>(':scope > li')).map(
    (li) => li.dataset.slideId ?? '',
  );
const overlayRow = async (kind: string): Promise<HTMLElement> => {
  await screen.findByRole('list', { name: 'Eventi' });
  const li = document.querySelector<HTMLElement>(`[data-overlay-kind="${kind}"]`);
  if (!li) throw new Error(`riga ${kind} mancante`);
  return li;
};
const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.localStorage.clear();
  setWidth(1440);
});
afterEach(() => {
  cleanup();
  act(() => setTenantLook(null));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('menu, routes and old pages', () => {
  it('one item «Studio grafico» for an admin, none for a viewer', async () => {
    mockServer();
    renderAt('/admin/live');
    const link = await screen.findByRole('link', { name: 'Studio grafico' });
    expect(link.getAttribute('href')).toBe('/admin/studio');
    for (const old of ['Grafica', 'Pause', 'Avvisi']) expect(screen.queryByRole('link', { name: old })).toBeNull();
    cleanup();
    mockServer({}, 'viewer');
    renderAt('/admin/studio/colori');
    await screen.findByRole('link', { name: 'Partite' });
    expect(screen.queryByRole('link', { name: 'Studio grafico' })).toBeNull();
    expect(screen.queryByTestId('studio')).toBeNull();
  });

  it.each([
    ['/admin/grafica', '/admin/studio/colori', /^Colori e loghi/],
    ['/admin/pagina', '/admin/studio/pagina', /^Pagina live/],
    ['/admin/pause', '/admin/studio/pause', /^Pause/],
    ['/admin/avvisi', '/admin/studio/avvisi', /^Avvisi/],
  ])('%s leads to the section of the Studio', async (from, to, name) => {
    mockServer();
    renderAt(from);
    await studio();
    expect(where()).toBe(to);
    expect(sectionButton(name).getAttribute('aria-current')).toBe('page');
  });

  it('/admin/studio opens «Colori e loghi»', async () => {
    mockServer();
    renderAt('/admin/studio');
    await studio();
    expect(sectionButton(/^Colori e loghi/).getAttribute('aria-current')).toBe('page');
    expect(document.title).toBe('Studio grafico · Area riservata');
  });
});

describe('inventory: every option of the old pages is in the Studio', () => {
  it('«Grafica» → Colori e loghi (colori, loghi e nome, squadra, immagini; modello in «Avanzate»)', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    for (const name of [
      'Colore principale',
      'Colore di risalto',
      'Squadra di casa',
      'Squadra ospite',
      'Sfondo della pagina',
    ]) {
      expect(screen.getByRole('textbox', { name })).toBeTruthy();
      expect(screen.getByLabelText(`${name}: selettore`)).toBeTruthy();
    }
    expect(screen.getByRole('radiogroup', { name: 'Modello grafico' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ripristina predefiniti' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Loghi e nome' }));
    expect(screen.getByLabelText('Nome visualizzato', { exact: false })).toBeTruthy();
    for (const name of ['Carica logo orizzontale', 'Carica logo quadrato', 'Carica logo dello sponsor'])
      expect(screen.getByLabelText(name)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Squadra' }));
    expect(screen.getByRole('textbox', { name: /Codice squadra/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Testo nel nome/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Immagini' }));
    expect(screen.getByRole('heading', { name: 'Immagini caricate' })).toBeTruthy();
    expect(screen.getByText(/Spazio usato: .* MB di 50/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Elimina' })).toHaveLength(2);
  });

  it('«Pagina pubblica» → Pagina live: every block of the registry with its options, widths and order', async () => {
    // a light page (the scoreboard only): every block is added, checked and taken away again
    const base = defaultLayout();
    mockServer({ layout: { ...base, tv: base.tv.slice(0, 1) } });
    renderAt('/admin/studio/pagina');
    await studio();
    const tabs = within(screen.getByRole('tablist', { name: 'Dispositivo' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['TV', 'Tablet', 'Telefono']);
    const type = screen.getByRole('combobox', { name: 'Tipo di blocco' });
    const offered = within(type)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'));
    expect(offered).toEqual([...REGISTRY_TYPES]);
    // every block that can be added shows its options
    const optionOf: Partial<Record<string, string>> = {
      logo: 'Logo',
      message: 'Testo del messaggio',
      qr: 'Testo sopra il codice QR',
      nextMatch: 'Mostra il codice QR: Prossima partita',
      standings: 'Righe: Classifica',
      topPlayers: 'Quanti',
      sponsor: 'Secondi per immagine',
      setScorers: 'Periodo: Parziale e marcatori',
      aces: 'Periodo: Ace',
      blocks: 'Periodo: Muri',
      attack: 'Periodo: Attacco',
      roleDuel: 'Ruolo: Sfida per ruolo',
      teamDuel: 'Periodo: Squadre a confronto',
    };
    for (const t of REGISTRY_TYPES) {
      if (t === 'scoreboard') continue;
      fireEvent.change(type, { target: { value: t } });
      fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
      const name = BLOCKS[t].label;
      expect(screen.getAllByRole('switch', { name: `Visibile: ${name}` }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('combobox', { name: `Larghezza: ${name}` }).length).toBeGreaterThan(0);
      const option = optionOf[t];
      if (option) expect(screen.getAllByLabelText(option).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${name}` }));
    }
    expect(blockOrder()).toEqual(['scoreboard']);
    expect(screen.getByRole('button', { name: 'Sposta su Tabellone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rimuovi Tabellone' })).toBeTruthy();
    expect(document.querySelectorAll('[draggable="true"]').length).toBe(blockOrder().length);
    expect(screen.getByRole('button', { name: 'Ripristina predefinito' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Telefono' }));
    expect(screen.getAllByRole('checkbox', { name: 'Chiuso all’apertura' }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/^Larghezza:/)).toBeNull();
  });

  it('«Pause» → Pause: every pause, set by set, mode for every device, delay, every slide type, the rule', async () => {
    mockServer();
    renderAt('/admin/studio/pause');
    await studio();
    const kinds = within(screen.getByRole('tablist', { name: 'Pausa' })).getAllByRole('tab');
    expect(kinds.map((t) => t.textContent)).toEqual(['Time-out', 'Fine set', 'Fine partita', 'Ogni N punti']);
    expect(kinds[1]?.getAttribute('aria-selected')).toBe('true');
    const sets = within(screen.getByRole('tablist', { name: 'Set' })).getAllByRole('tab');
    expect(sets.map((t) => t.textContent)).toEqual(['Tutti i set', '1° set', '2° set', '3° set', '4° set']);
    expect(screen.getByRole('switch', { name: 'Pausa attiva' })).toBeTruthy();
    for (const d of ['TV', 'Tablet', 'Telefono'])
      expect(screen.getByRole('combobox', { name: `Modo su ${d}` })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /Ritardo prima della pausa/ })).toBeTruthy();
    expect(screen.getAllByRole('combobox', { name: /^Secondi sullo schermo: / }).length).toBe(slideOrder().length);
    const types = within(screen.getByRole('combobox', { name: 'Tipo di diapositiva' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(types).toEqual(SLIDE_TYPES.map((t) => SLIDE_LABELS[t].label));
    expect(screen.getByRole('button', { name: 'Ripristina predefinito' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '2° set' }));
    expect(screen.getByRole('checkbox', { name: 'Pausa propria per la fine del 2° set' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Ogni N punti' }));
    expect(screen.getByRole('spinbutton', { name: 'Ogni quanti punti' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Non negli ultimi punti del set' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Modelli pronti' })).toBeTruthy();
  });

  it('«Avvisi» → Avvisi: every event with text, placeholders, duration, devices, position, size, priority, «Prova»', async () => {
    mockServer();
    renderAt('/admin/studio/avvisi');
    const items = within(await screen.findByRole('list', { name: 'Eventi' })).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    const ace = await overlayRow('ace');
    expect(within(ace).getByRole('switch', { name: 'Ace' })).toHaveProperty('checked', true);
    for (const p of ['{giocatore}', '{numero}', '{squadra}', '{punteggio}', '{set}', '{serie}', '{attacchi}'])
      expect(within(ace).getByText(p)).toBeTruthy();
    expect(within(ace).getByRole('textbox', { name: 'Testo' })).toBeTruthy();
    expect(within(ace).getByRole('combobox', { name: 'Secondi' })).toBeTruthy();
    expect(within(ace).getByRole('combobox', { name: 'Priorità' })).toBeTruthy();
    expect(within(ace).getByRole('combobox', { name: 'Posizione: Ace' })).toBeTruthy();
    expect(within(ace).getByRole('combobox', { name: 'Dimensione: Ace' })).toBeTruthy();
    for (const d of ['TV', 'Tablet', 'Telefono']) expect(within(ace).getByRole('checkbox', { name: d })).toBeTruthy();
    expect(within(ace).getByRole('button', { name: 'Prova Ace' })).toBeTruthy();
    expect(within(ace).getByRole('button', { name: 'Ripristina predefinito Ace' })).toBeTruthy();
    // every other event opens the same settings
    for (const li of items) expect(within(li).getByRole('switch')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Posizione e dimensione' }));
    expect(screen.getByRole('combobox', { name: 'Posizione' })).toHaveProperty('value', 'top');
    expect(screen.getByRole('combobox', { name: 'Dimensione' })).toHaveProperty('value', 'medium');
  });
});

describe('Colori e loghi', () => {
  it('the preview uses the real page with the colours of the draft', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    const tv = await screen.findByTestId('anteprima-tv');
    expect(within(tv).getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    expect(scopeVar('--sir-home')).toBe('#e30613');
    expect(scopeVar('--sir-away')).toBe(DEFAULT_BRAND_COLORS.away);
    fireEvent.change(screen.getByRole('textbox', { name: 'Squadra ospite' }), { target: { value: '#003399' } });
    expect(scopeVar('--sir-away')).toBe('#003399');
    fireEvent.change(screen.getByLabelText('Colore principale: selettore'), { target: { value: '#ffcc00' } });
    expect(scopeVar('--sir-primary')).toBe('#ffcc00');
    expect(within(saveBar()).getByText('2 modifiche non salvate')).toBeTruthy();
  });

  it('warns about little contrast, ignores a half typed colour', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    const field = await screen.findByRole('textbox', { name: 'Squadra di casa' });
    fireEvent.change(field, { target: { value: '#ff' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Scrivi il colore come #rrggbb/)).toBeTruthy();
    fireEvent.change(field, { target: { value: '#ffee00' } });
    expect(await screen.findByText(/«Squadra di casa» ha contrasto/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Sfondo della pagina' }), { target: { value: '#111111' } });
    expect(await screen.findByText(/Lo sfondo è troppo scuro/)).toBeTruthy();
  });

  it('lists the custom theme only to the superadmin and to the client that already has it', async () => {
    const models = (): string[] =>
      within(screen.getByRole('radiogroup', { name: 'Modello grafico' }))
        .getAllByRole('radio')
        .map((r) => r.textContent ?? '');
    mockServer({}, 'admin');
    const first = renderAt('/admin/studio/colori');
    await studio();
    expect(models().some((m) => /SIR VOLLEY/.test(m))).toBe(false);
    expect(models()).toHaveLength(4);
    first.unmount();
    mockServer({ branding: { ...SAVED_BRANDING, template: 'sir-volley' } }, 'admin');
    const second = renderAt('/admin/studio/colori');
    await studio();
    expect(models().some((m) => /SIR VOLLEY/.test(m))).toBe(true);
    expect(models()).toHaveLength(5);
    second.unmount();
    mockServer({}, 'superadmin');
    renderAt('/admin/studio/colori');
    await studio();
    expect(models().some((m) => /SIR VOLLEY/.test(m))).toBe(true);
  });

  it('template and team of the client: the preview follows, «nostra squadra» takes its colour, saved with PUT', async () => {
    const { puts } = mockServer({}, 'superadmin');
    renderAt('/admin/studio/colori');
    await studio();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Modello grafico' })).getByRole('radio', { name: /SIR VOLLEY/ }),
    );
    expect(scope().getAttribute('data-template')).toBe('sir-volley');
    expect(scope().getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('tab', { name: 'Squadra' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Codice squadra/ }), { target: { value: 'PER' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Testo nel nome/ }), { target: { value: 'Perugia' } });
    // the example match plays with our team at home: its colours are the ones of «nostra squadra»
    await waitFor(() => expect(scopeVar('--sir-home')).toBe('var(--sir-our)'));
    expect(within(screen.getByTestId('anteprima-tv')).getAllByText(/Perugia/).length).toBeGreaterThan(0);
    save();
    expect(await screen.findByText(/Grafica salvata/)).toBeTruthy();
    expect(puts('/api/admin/branding').at(-1)?.body).toMatchObject({
      template: 'sir-volley',
      ourTeam: { code: 'PER', name: 'Perugia' },
    });
    expect(puts('/api/admin/layout')).toHaveLength(0);
  });

  it('uploads a logo, refuses a file over 2 MB, shows why the server refuses a deletion', async () => {
    const { calls } = mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Loghi e nome' }));
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    fireEvent.change(screen.getByLabelText('Carica logo quadrato'), {
      target: { files: [new File([bytes], 'logo.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/assets' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      kind: 'logo',
      data: Buffer.from(bytes).toString('base64'),
    });
    expect(await screen.findByRole('img', { name: 'Logo quadrato' })).toBeTruthy();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Carica logo orizzontale'), { target: { files: [big] } });
    expect(await screen.findByText('Immagine troppo grande: al massimo 2 MB.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Immagini' }));
    const list = screen.getByRole('heading', { name: 'Immagini caricate' }).closest('section');
    if (!list) throw new Error('no list');
    fireEvent.click(within(list).getAllByRole('button', { name: 'Elimina' })[0] as HTMLElement);
    fireEvent.click(within(list).getByRole('button', { name: 'Conferma eliminazione' }));
    expect(await screen.findByText(/Immagine in uso nella grafica/)).toBeTruthy();
  });

  it('pure helpers of the colours', () => {
    expect(withOurTeamField({ code: 'PER', name: null }, 'code', '  ')).toEqual({ code: null, name: null });
    expect(contrastText({ color: 'home', against: 'background', ratio: 2.04 })).toBe(
      '«Squadra di casa» ha contrasto 2:1 sullo sfondo (minimo 4,5:1): i testi in questo colore si leggono male.',
    );
  });
});

describe('one save for each section', () => {
  it('the bar lists the changes, undoes them, saves only its section with its route', async () => {
    const { puts, calls } = mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    expect(screen.queryByRole('region', { name: 'Modifiche non salvate' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Squadra ospite' }), { target: { value: '#003399' } });
    expect(within(saveBar()).getByText('1 modifica non salvata')).toBeTruthy();
    fireEvent.click(within(saveBar()).getByRole('button', { name: 'Vedi modifiche' }));
    expect(within(saveBar()).getByText(/modello → #003399/)).toBeTruthy();
    fireEvent.click(within(saveBar()).getByRole('button', { name: 'Annulla modifiche' }));
    expect(screen.queryByRole('region', { name: 'Modifiche non salvate' })).toBeNull();
    expect(scopeVar('--sir-away')).toBe(DEFAULT_BRAND_COLORS.away);
    fireEvent.change(screen.getByRole('textbox', { name: 'Squadra ospite' }), { target: { value: '#003399' } });
    save();
    expect(await screen.findByText(/Grafica salvata/)).toBeTruthy();
    expect(puts('/api/admin/branding')).toHaveLength(1);
    expect(puts('/api/admin/branding')[0]?.body).toMatchObject({
      colors: { home: '#e30613', away: '#003399' },
      logoMain: LOGO,
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/public/tenant')).toBe(true));
    expect(screen.queryByRole('region', { name: 'Modifiche non salvate' })).toBeNull();
  });

  it('asks before changing section with changes not saved: stay, go on keeping them, or save and go on', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    fireEvent.change(screen.getByRole('textbox', { name: 'Squadra ospite' }), { target: { value: '#003399' } });
    fireEvent.click(sectionButton(/^Pause/));
    const ask = screen.getByRole('alertdialog', { name: 'Modifiche non salvate' });
    expect(ask.textContent).toContain('«Colori e loghi»');
    fireEvent.click(within(ask).getByRole('button', { name: 'Resta qui' }));
    expect(where()).toBe('/admin/studio/colori');
    fireEvent.click(sectionButton(/^Pause/));
    fireEvent.click(screen.getByRole('button', { name: 'Continua senza salvare' }));
    expect(where()).toBe('/admin/studio/pause');
    // the draft stays, marked in the list of the sections; the preview still shows it
    expect(sectionButton(/^Colori e loghi/).textContent).toContain('modifiche non salvate');
    expect(scopeVar('--sir-away')).toBe('#003399');
    fireEvent.click(sectionButton(/^Colori e loghi/));
    expect(where()).toBe('/admin/studio/colori');
    fireEvent.click(sectionButton(/^Avvisi/));
    fireEvent.click(screen.getByRole('button', { name: 'Salva e continua' }));
    await waitFor(() => expect(where()).toBe('/admin/studio/avvisi'));
    expect(puts('/api/admin/branding')).toHaveLength(1);
  });

  it('asks before leaving the Studio with changes not saved', async () => {
    mockServer();
    renderAt('/admin/studio/avvisi');
    const ace = await overlayRow('ace');
    fireEvent.click(within(ace).getByRole('switch', { name: 'Ace' }));
    fireEvent.click(screen.getByRole('link', { name: 'Partite' }));
    const ask = screen.getByRole('alertdialog', { name: 'Modifiche non salvate' });
    expect(ask.textContent).toContain('Avvisi');
    expect(where()).toBe('/admin/studio/avvisi');
    fireEvent.click(within(ask).getByRole('button', { name: 'Esci senza salvare' }));
    expect(where()).toBe('/admin/partite');
  });
});

describe('Pagina live', () => {
  it('reorders with the keyboard (focus stays) and by dragging, hides a block, changes its width, saves with PUT', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/pagina');
    await studio();
    expect(blockOrder()).toEqual(['scoreboard', 'momentum', 'comparison', 'players', 'court', 'rotations']);
    const down = screen.getByRole('button', { name: 'Sposta giù Tabellone' });
    down.focus();
    fireEvent.click(down);
    expect(blockOrder().slice(0, 2)).toEqual(['momentum', 'scoreboard']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sposta giù Tabellone' }));
    expect(screen.getByText('Tabellone in posizione 2 di 6.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sposta su Tabellone' }));
    expect(screen.queryByRole('region', { name: 'Modifiche non salvate' })).toBeNull();
    const item = (id: string) => document.querySelector<HTMLElement>(`li[data-block-id="${id}"]`) as HTMLElement;
    const handle = item('rotations').querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(handle);
    fireEvent.dragOver(item('momentum'));
    fireEvent.drop(item('momentum'));
    fireEvent.dragEnd(handle);
    expect(blockOrder()).toEqual(['scoreboard', 'rotations', 'momentum', 'comparison', 'players', 'court']);
    fireEvent.click(screen.getByRole('tab', { name: 'Tablet' }));
    const shown = within(await screen.findByTestId('anteprima-tablet'));
    expect(await shown.findByRole('heading', { name: 'Rotazioni' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Visibile: Rotazioni' }));
    expect(shown.queryByRole('heading', { name: 'Rotazioni' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Larghezza: Andamento del set' }), {
      target: { value: '12' },
    });
    save();
    expect(await screen.findByText(/Pagina pubblica salvata/)).toBeTruthy();
    const body = puts('/api/admin/layout').at(-1)?.body as TenantLayout;
    expect(body.tv.map((b) => b.id)).toEqual(['scoreboard', 'rotations', 'momentum', 'comparison', 'players', 'court']);
    expect(body.tablet.find((b) => b.id === 'rotations')?.visible).toBe(false);
    expect(body.tablet.find((b) => b.id === 'momentum')?.width).toBe(12);
  });

  it('an empty message cannot be saved; the default page of the device comes back', async () => {
    mockServer();
    renderAt('/admin/studio/pagina');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Tablet' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo di blocco' }), { target: { value: 'message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi blocco' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Testo del messaggio' }), { target: { value: '' } });
    expect(within(saveBar()).getByRole('alert').textContent).toContain('Tablet');
    expect(within(saveBar()).getByRole('button', { name: 'Salva' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Testo del messaggio' }), {
      target: { value: 'Forza <b>Sir</b>!' },
    });
    expect(within(screen.getByTestId('anteprima-tablet')).getByText('Forza <b>Sir</b>!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina predefinito' }));
    expect(blockOrder()).toEqual(['scoreboard', 'momentum', 'comparison', 'players', 'court', 'rotations']);
  });

  it('the device of the list follows the device of the preview and back', async () => {
    mockServer();
    renderAt('/admin/studio/pagina');
    await studio();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Dispositivo dell’anteprima' })).getByRole('radio', {
        name: 'Telefono',
      }),
    );
    expect(screen.getByRole('tab', { name: 'Telefono' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('anteprima-phone')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'TV' }));
    expect(screen.getByTestId('anteprima-tv')).toBeTruthy();
  });
});

describe('Pause', () => {
  it('end of set in the preview (TV full screen, telefono a banda come oggi), the models, the settings, PUT', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/pause');
    await studio();
    const tv = await screen.findByTestId('anteprima-tv');
    const dialog = await within(tv).findByRole('dialog', { name: 'Fine 1° set' });
    expect(within(dialog).getByText('Riepilogo del 1° set')).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Dispositivo dell’anteprima' })).getByRole('radio', {
        name: 'Telefono',
      }),
    );
    const phone = await screen.findByTestId('anteprima-phone');
    await waitFor(() => expect(phone.querySelector('[data-intermission="banner"]')).toBeTruthy());
    const models = screen.getByRole('radiogroup', { name: 'Modelli pronti' });
    expect(
      within(models)
        .getByRole('radio', { name: /Completo/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(models).getByRole('radio', { name: /Essenziale/ }));
    expect(slideOrder()).toEqual(['setSummary', 'sponsor']);
    expect(phone.querySelector('[data-intermission="banner"]')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Secondi sullo schermo: Sponsor' }), {
      target: { value: '12' },
    });
    expect(screen.getByText(/Personalizzato: hai cambiato qualcosa/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Time-out' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Modo su TV' }), { target: { value: 'fullscreen' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Ritardo prima della pausa/ }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo di diapositiva' }), { target: { value: 'message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi diapositiva' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sposta su Messaggio' }));
    expect(slideOrder()).toEqual(['message', 'sponsor']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sposta giù Messaggio' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Immagine 2 · 300×100 px/ }));
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.setBreak.slides.map((s) => s.id)).toEqual(['setSummary', 'sponsor']);
    expect(body.setBreak.modes.phone).toBe('banner');
    expect(body.timeout).toMatchObject({
      modes: { tv: 'fullscreen', tablet: 'banner', phone: 'banner' },
      delaySeconds: 3,
      slides: [
        { id: 'message', type: 'message' },
        { id: 'sponsor', options: { images: [SPONSOR] } },
      ],
    });
  });

  it('own end of set of the 3rd set, a pause turned off, the rule of the «ogni N punti»', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: '3° set' }));
    expect(screen.getByText(/si usa la pausa di «Tutti i set»/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pausa propria per la fine del 3° set' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi Sponsor' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Fine partita' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pausa attiva' }));
    expect(await screen.findByText('Pausa disattivata: gli spettatori non la vedono.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Ogni N punti' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ogni quanti punti' }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Non negli ultimi punti del set' }), {
      target: { value: '99' },
    });
    expect(screen.getByText(/arriva a 10 punti \(mai al tie-break\)/)).toBeTruthy();
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.setBreakBySet['3']?.slides.map((s) => s.type)).not.toContain('sponsor');
    expect(body.matchEnd.enabled).toBe(false);
    expect(body.milestone).toMatchObject({ every: 10, stopBeforeEnd: 15 });
  });
});

describe('Avvisi', () => {
  it('refuses unknown placeholders and HTML; changes and saves; restores the default', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/avvisi');
    const ace = await overlayRow('ace');
    const text = within(ace).getByRole('textbox', { name: 'Testo' });
    await waitFor(() => expect(within(ace).getByText(/^Risultato: ACE! /)).toBeTruthy());
    fireEvent.change(text, { target: { value: 'ACE di {nome}' } });
    expect(within(ace).getByText(/segnaposto sconosciuto: \{nome\}/)).toBeTruthy();
    expect(within(saveBar()).getByRole('alert').textContent).toContain('non sono validi');
    expect(within(saveBar()).getByRole('button', { name: 'Salva' })).toHaveProperty('disabled', true);
    expect(within(ace).getByRole('button', { name: 'Prova Ace' })).toHaveProperty('disabled', true);
    fireEvent.change(text, { target: { value: '<b>ACE</b>' } });
    expect(within(ace).getByText(/< e > non sono ammessi/)).toBeTruthy();
    fireEvent.change(text, { target: { value: 'Ace di {numero}' } });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Secondi' }), { target: { value: '7' } });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Priorità' }), { target: { value: '10' } });
    fireEvent.click(within(ace).getByRole('checkbox', { name: 'Telefono' }));
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Posizione: Ace' }), { target: { value: 'bottom' } });
    fireEvent.click(within(await overlayRow('tie')).getByRole('switch', { name: 'Pareggio' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Posizione e dimensione' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Dimensione' }), { target: { value: 'large' } });
    save();
    expect(await screen.findByText(/Avvisi salvati/)).toBeTruthy();
    const body = puts('/api/admin/overlays').at(-1)?.body as TenantOverlays;
    expect(body.ace).toEqual({
      enabled: true,
      text: 'Ace di {numero}',
      seconds: 7,
      priority: 10,
      devices: { tv: true, tablet: true, phone: false },
      position: 'bottom',
    });
    expect(body.tie.enabled).toBe(false);
    expect(body.size).toBe('large');
    fireEvent.click(screen.getByRole('tab', { name: 'Quali avvisi' }));
    fireEvent.click(within(await overlayRow('ace')).getByRole('button', { name: 'Ripristina predefinito Ace' }));
    expect(within(await overlayRow('ace')).getByRole('textbox', { name: 'Testo' })).toHaveProperty(
      'value',
      'ACE! {giocatore}',
    );
  });

  it('the scene shows the overlay being edited; «Prova» shows it again for its seconds; models', async () => {
    mockServer();
    renderAt('/admin/studio/avvisi');
    await overlayRow('ace');
    expect(checkedScene()).toBe('Avviso «Ace»');
    const region = await screen.findByTestId('prova-avviso');
    await waitFor(() => expect(region.textContent).toMatch(/^ACE! /));
    const mp = await overlayRow('matchPoint');
    fireEvent.click(within(mp).getByRole('button', { name: 'Modifica Match point' }));
    expect(checkedScene()).toBe('Avviso «Match point»');
    expect(screen.getByTestId('prova-avviso').textContent).toMatch(/^MATCH POINT /);
    fireEvent.click(within(await overlayRow('matchPoint')).getByRole('button', { name: 'Prova Match point' }));
    expect(screen.getByTestId('prova-avviso').querySelector('[data-overlay="home"]')).toBeTruthy();
    const models = screen.getByRole('radiogroup', { name: 'Modelli pronti' });
    expect(
      within(models)
        .getByRole('radio', { name: /Completo/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(models).getByRole('radio', { name: /Essenziale/ }));
    expect(within(await overlayRow('ace')).getByRole('switch', { name: 'Ace' })).toHaveProperty('checked', false);
    fireEvent.click(within(await overlayRow('ace')).getByRole('switch', { name: 'Ace' }));
    expect(screen.getByText(/Personalizzato: hai cambiato qualcosa/)).toBeTruthy();
  });
});

describe('scene of the preview: automatic and by hand', () => {
  it('follows the section and the pause being edited, and can always be chosen', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    expect(checkedScene()).toBe('In gioco');
    fireEvent.click(sectionButton(/^Pause/));
    expect(checkedScene()).toBe('Fine set');
    fireEvent.click(screen.getByRole('tab', { name: 'Time-out' }));
    expect(checkedScene()).toBe('Time-out');
    // the default time-out shows the sponsors: none chosen yet, the preview says why nothing shows
    expect(await screen.findByText(/Nessuna diapositiva da mostrare/)).toBeTruthy();
    fireEvent.click(scene('Fine partita'));
    expect(checkedScene()).toBe('Fine partita');
    fireEvent.click(scene('In gioco'));
    expect(screen.getByTestId('anteprima-tv').querySelector('[data-intermission]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Ogni N punti' }));
    expect(checkedScene()).toBe('Ogni N punti');
    fireEvent.click(sectionButton(/^Avvisi/));
    expect(checkedScene()).toMatch(/^Avviso/);
    fireEvent.click(sectionButton(/^Pagina live/));
    expect(checkedScene()).toBe('In gioco');
  });

  it('«Compare: …» shows the scene of the setting', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Loghi e nome' }));
    const sponsor = document.getElementById('studio-image-sponsorLogo') as HTMLElement;
    fireEvent.click(within(sponsor).getByRole('button', { name: /^Compare: / }));
    expect(checkedScene()).toBe('Fine set');
  });
});

describe('highlight and click in the preview', () => {
  /** A real DOMRect (its fields are getters, as in the browser). */
  const box = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height);

  it('passing over a setting outlines its elements; when they are not in the scene a button shows it', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.studioType === 'scoreboard' ? box(10, 10, 300, 80) : box(0, 0, 0, 0);
    });
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    await screen.findByTestId('anteprima-tv');
    const home = document.getElementById('studio-color-home') as HTMLElement;
    fireEvent.mouseEnter(home);
    expect((await screen.findAllByTestId('evidenziato')).length).toBeGreaterThan(0);
    fireEvent.mouseLeave(home);
    await waitFor(() => expect(screen.queryAllByTestId('evidenziato')).toHaveLength(0));
    fireEvent.click(screen.getByRole('tab', { name: 'Loghi e nome' }));
    const sponsor = document.getElementById('studio-image-sponsorLogo') as HTMLElement;
    fireEvent.focus(sponsor);
    const offer = await screen.findByRole('button', { name: 'Non si vede in questa scena. Mostra «Fine set»' });
    fireEvent.blur(sponsor);
    // it stays a moment after the setting is left, so it can be reached
    fireEvent.click(offer);
    expect(checkedScene()).toBe('Fine set');
  });

  it('a click on an element of the page opens its setting (section, tab) and marks it', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.studioPage !== undefined) return box(0, 0, 1000, 600);
      if (this.dataset.studioBlock === 'momentum') return box(0, 200, 400, 200);
      return box(0, 0, 0, 0);
    });
    mockServer();
    renderAt('/admin/studio/avvisi');
    await overlayRow('ace');
    await screen.findByTestId('anteprima-tv');
    fireEvent.click(scene('In gioco'));
    fireEvent.click(screen.getByTestId('anteprima-palco'), { clientX: 50, clientY: 250 });
    await waitFor(() => expect(where()).toBe('/admin/studio/pagina'));
    const setting = await waitFor(() => {
      const el = document.getElementById('studio-block-tv-momentum');
      if (!el) throw new Error('setting not there');
      return el;
    });
    await waitFor(() => expect(document.activeElement).toBe(setting));
    expect(setting.className).toContain('ring-2');
    // in «Colori e loghi» the same block opens the colours of the teams; the page its background
    fireEvent.click(sectionButton(/^Colori e loghi/));
    fireEvent.click(screen.getByTestId('anteprima-palco'), { clientX: 50, clientY: 250 });
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('studio-color-home')));
    fireEvent.click(screen.getByTestId('anteprima-palco'), { clientX: 900, clientY: 50 });
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('studio-color-background')));
  });

  it('«Anteprima a tutto schermo» opens the real view and closes with Esc', async () => {
    mockServer();
    renderAt('/admin/studio/avvisi');
    await overlayRow('ace');
    const open = screen.getByRole('button', { name: 'Anteprima a tutto schermo' });
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Anteprima a tutto schermo' });
    expect(within(dialog).getByTestId('anteprima-tv')).toBeTruthy();
    expect(within(dialog).getByTestId('prova-avviso')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Anteprima a tutto schermo' })).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});

describe('«Allarga anteprima»', () => {
  it('narrows sections and settings, keeps the sections usable, is remembered on the browser', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    const button = screen.getByRole('button', { name: 'Allarga anteprima' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('studio-colonne').dataset.wide).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('studio-colonne').dataset.wide).toBe('true');
    expect(screen.getByTestId('studio-colonne').className).toContain('grid-cols-[3.75rem');
    expect(window.localStorage.getItem(PREVIEW_WIDE_KEY)).toBe('1');
    // the thin column still names every section (short name on screen, full name for screen readers)
    fireEvent.click(sectionButton(/^Pause/));
    expect(where()).toBe('/admin/studio/pause');
    cleanup();
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    expect(screen.getByTestId('studio-colonne').dataset.wide).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Allarga anteprima' }));
    expect(window.localStorage.getItem(PREVIEW_WIDE_KEY)).toBeNull();
  });
});

describe('guided setup', () => {
  const nothingSaved = { branding: defaultBranding() };

  it('does not open by itself even with nothing saved (the first setup is the procedure of the first access)', async () => {
    mockServer(nothingSaved);
    renderAt('/admin/studio');
    await studio();
    expect(screen.queryByRole('dialog', { name: 'Logo e colori' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configurazione guidata' }));
    expect(screen.getByRole('dialog', { name: 'Logo e colori' })).toBeTruthy();
  });

  it('does not open by itself when something is saved; the button opens it; four steps, then saves', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio');
    await studio();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configurazione guidata' }));
    let dialog = screen.getByRole('dialog', { name: 'Logo e colori' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Colore principale' }), {
      target: { value: '#123456' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avanti' }));
    dialog = screen.getByRole('dialog', { name: 'La tua squadra' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Testo nel nome/ }), { target: { value: 'Perugia' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avanti' }));
    dialog = screen.getByRole('dialog', { name: 'La pagina' });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Mostra: Rotazioni' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avanti' }));
    dialog = screen.getByRole('dialog', { name: 'Le pause' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Sponsor in evidenza/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fine e salva' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(puts('/api/admin/branding').at(-1)?.body).toMatchObject({
      colors: { primary: '#123456' },
      ourTeam: { name: 'Perugia' },
    });
    const layout = puts('/api/admin/layout').at(-1)?.body as TenantLayout;
    expect(layout.phone.find((b) => b.type === 'rotations')?.visible).toBe(false);
    const pauses = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(pauses.setBreak.slides[0]?.type).toBe('sponsor');
    expect(puts('/api/admin/overlays')).toHaveLength(0);
  });
});

describe('phone: the Studio in steps', () => {
  it('sections, then settings, then «Vedi anteprima», and back', async () => {
    setWidth(390);
    mockServer();
    renderAt('/admin/studio');
    await screen.findByTestId('studio');
    expect(screen.getByTestId('studio').getAttribute('data-step')).toBe('sezioni');
    expect(screen.queryByRole('region', { name: 'Anteprima' })).toBeNull();
    fireEvent.click(sectionButton(/^Pause/));
    expect(screen.getByTestId('studio').getAttribute('data-step')).toBe('impostazioni');
    expect(screen.getByRole('radiogroup', { name: 'Modelli pronti' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Sezioni dello Studio' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Vedi anteprima' }));
    expect(screen.getByRole('region', { name: 'Anteprima' })).toBeTruthy();
    expect(checkedScene()).toBe('Fine set');
    fireEvent.click(screen.getByRole('button', { name: 'Indietro alle impostazioni' }));
    fireEvent.click(screen.getByRole('button', { name: 'Indietro alle sezioni' }));
    expect(screen.getByRole('navigation', { name: 'Sezioni dello Studio' })).toBeTruthy();
  });

  it('an address with a section opens its settings at once', async () => {
    setWidth(390);
    mockServer();
    renderAt('/admin/avvisi');
    await screen.findByTestId('studio');
    expect(screen.getByTestId('studio').getAttribute('data-step')).toBe('impostazioni');
    expect(await screen.findByRole('list', { name: 'Eventi' })).toBeTruthy();
  });
});
