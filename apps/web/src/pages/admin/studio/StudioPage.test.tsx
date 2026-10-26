import type {
  AssetListResponse,
  AssetSummary,
  MeResponse,
  Player,
  Sponsor,
  SponsorListResponse,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@arenalive/shared';
import {
  DEFAULT_BRAND_COLORS,
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  LayoutBlockSchema,
  noPlayerEvents,
  SLIDE_TYPES,
  TenantIntermissionsSchema,
  TenantLayoutSchema,
  TenantOverlaysSchema,
} from '@arenalive/shared';
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
const VIDEO_ID = '7c6b5a49-3827-4615-8a4b-3c2d1e0f9a8b';

/** Players of the roster served by `GET /api/admin/roster` (reset for every test). */
let rosterPlayers: Player[] = [];

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

const SPONSOR_ID = '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c';
/** One sponsor of the client with the sponsor image. */
const SPONSORS: Sponsor[] = [
  {
    id: SPONSOR_ID,
    name: 'Bar Centrale',
    website: null,
    position: 0,
    imageIds: [SPONSOR],
    createdAt: '2026-10-15T10:00:00.000Z',
  },
];

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
  sponsorId: null,
  name: null,
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
  extraAssets: AssetSummary[] = [],
): { calls: Call[]; puts: (url: string) => Call[] } {
  const saved: Saved = {
    branding: SAVED_BRANDING,
    layout: defaultLayout(),
    intermissions: defaultIntermissions(),
    overlays: defaultOverlays(),
    ...initial,
  };
  let assets = [...extraAssets, asset(LOGO, 'logo', 240, 60), asset(SPONSOR, 'sponsor')];
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
      if (url === '/api/admin/assets/video' && method === 'POST') {
        const header = (init?.headers as Record<string, string> | undefined)?.['x-file-name'];
        const created: AssetSummary = {
          ...asset(VIDEO_ID, 'sponsor', 1280, 720),
          kind: 'overlay',
          mime: 'video/mp4',
          url: `/api/admin/assets/${VIDEO_ID}/file`,
          name: header ? decodeURIComponent(header) : null,
        };
        assets = [created, ...assets];
        return json(created, 201);
      }
      if (url.startsWith('/api/admin/assets/') && method === 'PATCH') {
        const id = url.split('/').at(-1) ?? '';
        const name = (body as { name: string | null }).name;
        assets = assets.map((a) => (a.id === id ? { ...a, name } : a));
        return json(assets.find((a) => a.id === id));
      }
      if (url.startsWith('/api/admin/assets/') && method === 'DELETE')
        return json({ error: 'Immagine in uso nella grafica: toglila prima di eliminarla' }, 409);
      if (url === '/api/admin/sponsors') return json({ sponsors: SPONSORS } satisfies SponsorListResponse);
      if (url === '/api/public/tenant') return json({ error: 'Non trovato' }, 404);
      if (url === '/api/admin/roster')
        return json({
          season: 2026,
          seasons: [2026],
          team: null,
          players: rosterPlayers,
          import: { running: false, photosDone: 0, photosTotal: 0, lastAt: null, lastError: null },
        });
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
  rosterPlayers = [];
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
  it('«Grafica» → Colori e loghi (colori, loghi e nome, squadra; modello in «Avanzate»)', async () => {
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
    for (const name of [
      'Scegli dalla libreria: logo orizzontale',
      'Scegli dalla libreria: logo quadrato',
      'Scegli dalla libreria: logo dello sponsor',
    ])
      expect(screen.getByLabelText(name)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Squadra' }));
    expect(screen.getByRole('textbox', { name: /Codice squadra/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Testo nel nome/ })).toBeTruthy();
    // The library of the files is the page «Immagini e video» of the menu, not a tab nor a section of the Studio.
    expect(screen.queryByRole('tab', { name: 'Immagini' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Immagini e video/ })).toBeNull();
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
      court: 'Metà della nostra squadra',
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
  it('draws the TV page in a box with the rem of the big screen (same groups of blocks as the real page)', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    const page = (await screen.findByTestId('anteprima-tv')).querySelector<HTMLElement>('[data-studio-page]');
    // jsdom has no --sir-tv-font-size: default theme at 1920 × 1080 = 23.76 px per rem against the 16 px of the area.
    const width = Number.parseFloat(page?.style.width ?? '0');
    expect(width).toBeCloseTo((1920 * 16) / 23.76, 0);
    expect(Number.parseFloat(page?.style.height ?? '0')).toBeCloseTo((1080 * 16) / 23.76, 0);
  });

  it('follows the template of the draft: another text size of the big screen redraws the TV page', async () => {
    // jsdom does not compute the themes: each template gets its --sir-tv-font-size from the scope of the preview.
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      const template = el.closest('[data-template]')?.getAttribute('data-template');
      const raw = template === 'sir-volley' ? 'clamp(14px, min(0.9vw, 1.6vh), 36px)' : '';
      return new Proxy(style, {
        get: (t, k) =>
          k === 'getPropertyValue'
            ? (name: string) => (name === '--sir-tv-font-size' && raw ? raw : t.getPropertyValue(name))
            : (Reflect.get(t, k) as unknown),
      });
    });
    try {
      mockServer({}, 'superadmin');
      renderAt('/admin/studio/colori');
      await studio();
      const width = () =>
        Number.parseFloat(
          screen.getByTestId('anteprima-tv').querySelector<HTMLElement>('[data-studio-page]')?.style.width ?? '0',
        );
      expect(width()).toBeCloseTo((1920 * 16) / 23.76, 0);
      fireEvent.click(
        within(screen.getByRole('radiogroup', { name: 'Modello grafico' })).getByRole('radio', { name: /SIR VOLLEY/ }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'No, tieni i blocchi attuali' }));
      // SIR VOLLEY at 1920 × 1080: min(17.28, 17.28) px per rem.
      await waitFor(() => expect(width()).toBeCloseTo((1920 * 16) / 17.28, 0));
    } finally {
      spy.mockRestore();
    }
  });

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
    // Saved branding and example match loaded first: a value arriving later would reset the field being typed.
    await studio();
    const field = screen.getByRole('textbox', { name: 'Squadra di casa' });
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

  it('another template asks whether «Pagina live» takes its blocks: no keeps them, yes puts the defaults in the draft', async () => {
    const { puts } = mockServer({}, 'superadmin');
    renderAt('/admin/studio/colori');
    await studio();
    const pick = (name: RegExp) =>
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Modello grafico' })).getByRole('radio', { name }));
    const question = () =>
      screen.queryByRole('alertdialog', { name: 'Applicare anche la disposizione dei blocchi del modello?' });
    pick(/SIR VOLLEY/);
    expect(question()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No, tieni i blocchi attuali' }));
    expect(question()).toBeNull();
    expect(scope().getAttribute('data-template')).toBe('sir-volley');
    expect(sectionButton(/Pagina live/).textContent).not.toMatch(/●/);
    // The same template again: nothing to ask.
    pick(/SIR VOLLEY/);
    expect(question()).toBeNull();
    pick(/Standard/);
    pick(/SIR VOLLEY/);
    fireEvent.click(screen.getByRole('button', { name: 'Sì, applica i blocchi del modello' }));
    expect(question()).toBeNull();
    expect(sectionButton(/Pagina live/).textContent).toMatch(/●/);
    save();
    expect(await screen.findByText(/Grafica salvata/)).toBeTruthy();
    fireEvent.click(sectionButton(/Pagina live/));
    save();
    expect(await screen.findByText(/Pagina pubblica salvata/)).toBeTruthy();
    expect(puts('/api/admin/layout').at(-1)?.body).toEqual(defaultLayout('sir-volley'));
  });

  it('chooses a logo from the library: no upload here, a link to «Immagini e video»', async () => {
    const { calls } = mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Loghi e nome' }));
    expect(screen.queryByLabelText('Carica logo quadrato')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Carica immagine' })).toBeNull();
    expect(screen.getAllByText('Carica nella libreria')[0]?.getAttribute('href')).toBe('/admin/media');
    // Only the files of the right kind (logos) are offered, by name.
    const mark = screen.getByLabelText('Scegli dalla libreria: logo quadrato');
    expect(
      within(mark)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Scegli dalla libreria…', 'Immagine del 15/10/2026 · 240×60 px · 0 MB']);
    fireEvent.change(mark, { target: { value: LOGO } });
    expect(await screen.findByRole('img', { name: 'Logo quadrato' })).toBeTruthy();
    expect(within(saveBar()).getByText('1 modifica non salvata')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
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

  it('«Esporta / Importa» is a section under «Avvisi», no longer a tab of «Colori e loghi»', async () => {
    mockServer();
    renderAt('/admin/studio/colori');
    await studio();
    expect(screen.queryByRole('tab', { name: 'Esporta / Importa' })).toBeNull();
    const names = within(screen.getByRole('navigation', { name: 'Sezioni dello Studio' }))
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    expect(names.map((n) => n.split(/Ace|Aspetto|Blocchi|Fine set|Salva|Libreria/)[0])).toEqual([
      'Colori e loghi',
      'Pagina live',
      'Pause',
      'Avvisi',
      'Esporta / Importa',
    ]);
    fireEvent.click(sectionButton(/^Esporta \/ Importa/));
    expect(where()).toBe('/admin/studio/esporta');
    expect(screen.getByRole('button', { name: 'Esporta configurazione' })).toBeTruthy();
    expect(screen.getByLabelText(/File della configurazione/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Modifiche non salvate' })).toBeNull();
    expect(screen.queryByTestId('export-unsaved')).toBeNull();
  });

  it('warns in «Esporta / Importa» that the file has the saved graphics, not the changes in progress', async () => {
    mockServer();
    renderAt('/admin/studio/avvisi');
    const ace = await overlayRow('ace');
    fireEvent.click(within(ace).getByRole('switch', { name: 'Ace' }));
    fireEvent.click(sectionButton(/^Esporta \/ Importa/));
    fireEvent.click(screen.getByRole('button', { name: 'Continua senza salvare' }));
    const warning = await screen.findByTestId('export-unsaved');
    expect(warning.textContent).toContain('«Avvisi»');
    expect(warning.textContent).toContain('già salvata');
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
  it('switches «Touch» off for one device and saves it', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/pagina');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Tablet' }));
    expect(screen.getByRole<HTMLInputElement>('switch', { name: 'Touch: Tablet' }).checked).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Telefono' }));
    expect(screen.getByRole<HTMLInputElement>('switch', { name: 'Touch: Telefono' }).checked).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Touch: Telefono' }));
    expect(screen.getByText('Touch: No')).toBeTruthy();
    save();
    expect(await screen.findByText(/Pagina pubblica salvata/)).toBeTruthy();
    const body = puts('/api/admin/layout').at(-1)?.body as TenantLayout;
    expect(body.touch).toEqual({ tv: true, tablet: true, phone: false });
  });

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

  it('«Rimuovi» is in the row of every block, not under «Opzioni»; a block with its own options asks first', async () => {
    const base = defaultLayout();
    const message = LayoutBlockSchema.parse({ id: 'msg', type: 'message', width: 12, options: { text: 'Benvenuti' } });
    const { puts } = mockServer({ layout: { ...base, tv: [...base.tv.slice(0, 2), message] } });
    renderAt('/admin/studio/pagina');
    await studio();
    expect(blockOrder()).toEqual(['scoreboard', 'momentum', 'msg']);
    for (const name of ['Tabellone', BLOCKS.momentum.label, BLOCKS.message.label]) {
      // A closed <details> hides its content: the button must be outside it to be seen.
      expect(screen.getByRole('button', { name: `Rimuovi ${name}` }).closest('details')).toBeNull();
    }
    // Default options: removed at once.
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${BLOCKS.momentum.label}` }));
    expect(blockOrder()).toEqual(['scoreboard', 'msg']);
    // Its own text would be lost: a confirmation first, «Annulla» keeps it.
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${BLOCKS.message.label}` }));
    expect(blockOrder()).toEqual(['scoreboard', 'msg']);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${BLOCKS.message.label}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma rimozione' }));
    expect(blockOrder()).toEqual(['scoreboard']);
    save();
    expect(await screen.findByText(/Pagina pubblica salvata/)).toBeTruthy();
    expect((puts('/api/admin/layout').at(-1)?.body as TenantLayout).tv.map((b) => b.id)).toEqual(['scoreboard']);
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
    // Own title: empty is the automatic one (placeholder), the text typed is saved.
    expect(screen.getByRole('textbox', { name: 'Titolo' })).toHaveProperty('placeholder', 'Time-out <squadra>');
    fireEvent.change(screen.getByRole('textbox', { name: 'Titolo' }), { target: { value: 'Pausa tecnica' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo di diapositiva' }), { target: { value: 'message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi diapositiva' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sposta su Messaggio' }));
    expect(slideOrder()).toEqual(['message', 'sponsor']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sposta giù Messaggio' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Bar Centrale · 1 immagine/ }));
    expect(screen.getByRole('combobox', { name: 'Dimensione a tutto schermo' })).toHaveProperty('value', 'normal');
    fireEvent.change(screen.getByRole('combobox', { name: 'Dimensione a tutto schermo' }), {
      target: { value: 'fill' },
    });
    expect(screen.getByLabelText('Secondi per immagine')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Come mostrarli' }), { target: { value: 'all' } });
    // All in one page: no seconds per image (the slide keeps its own seconds).
    expect(screen.queryByLabelText('Secondi per immagine')).toBeNull();
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.setBreak.slides.map((s) => s.id)).toEqual(['setSummary', 'sponsor']);
    expect(body.setBreak.modes.phone).toBe('banner');
    expect(body.timeout).toMatchObject({
      modes: { tv: 'fullscreen', tablet: 'banner', phone: 'banner' },
      delaySeconds: 3,
      title: 'Pausa tecnica',
      fullscreenSize: 'fill',
      slides: [
        { id: 'message', type: 'message' },
        { id: 'sponsor', options: { sponsors: [SPONSOR_ID], images: [], display: 'all' } },
      ],
    });
  });

  it('«Dopo la partita» in «Fine partita»: switch, photo chosen from the library, minutes, PUT', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Fine partita' }));
    const card = screen.getByRole('region', { name: 'Dopo la partita' });
    fireEvent.click(within(card).getByRole('switch', { name: 'Mostra foto o video dopo la partita' }));
    expect(within(card).getByText(/senza file la schermata non compare/)).toBeTruthy();
    expect(within(card).queryByTestId('anteprima-dopo-partita')).toBeNull();
    // The photo is chosen once, from the library (no second list of the same images under it).
    expect(within(card).queryByText(/Oppure scegli/)).toBeNull();
    expect(within(card).queryAllByRole('radio')).toHaveLength(0);
    const choose = within(card).getByLabelText('Scegli dalla libreria: Foto o video a tutto schermo');
    await waitFor(() => expect(within(choose).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(choose, { target: { value: SPONSOR } });
    fireEvent.change(within(card).getByRole('spinbutton', { name: /Minuti dopo la fine della partita/ }), {
      target: { value: '500' },
    });
    expect(within(card).getByRole<HTMLInputElement>('spinbutton').value).toBe('240');
    fireEvent.change(within(card).getByRole('spinbutton'), { target: { value: '45' } });
    const preview = within(card).getByTestId('anteprima-dopo-partita');
    expect(preview.querySelector('img')?.getAttribute('src')).toBe(`/api/admin/assets/${SPONSOR}/file`);
    expect(within(preview).getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.afterMatch).toEqual({
      enabled: true,
      image: SPONSOR,
      kind: 'image',
      audio: false,
      fit: 'cover',
      delayMinutes: 45,
    });

    fireEvent.click(within(card).getByRole('button', { name: 'Togli foto o video' }));
    await waitFor(() => expect(within(card).queryByTestId('anteprima-dopo-partita')).toBeNull());
    // No upload here: the photo is chosen from the library, which is filled in «Immagini e video».
    expect(within(card).queryByLabelText('Carica immagine')).toBeNull();
    expect(within(card).getByText('Carica nella libreria').getAttribute('href')).toBe('/admin/media');
    const pick = within(card).getByLabelText('Scegli dalla libreria: Foto o video a tutto schermo');
    await waitFor(() => expect(within(pick).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(pick, { target: { value: SPONSOR } });
    await waitFor(() =>
      expect(within(card).getByTestId('anteprima-dopo-partita').querySelector('img')?.getAttribute('src')).toBe(
        `/api/admin/assets/${SPONSOR}/file`,
      ),
    );
  });

  it('«Dopo la partita» has its own scene in the big preview, reachable from the card: the draft photo and the next match', async () => {
    mockServer();
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Fine partita' }));
    const card = screen.getByRole('region', { name: 'Dopo la partita' });
    expect(scene('Dopo la partita')).toBeTruthy();
    // Without photo: a notice, no screen.
    fireEvent.click(within(card).getByRole('button', { name: 'Vedi nell’anteprima grande' }));
    expect(checkedScene()).toBe('Dopo la partita');
    expect(scope().querySelector('[data-testid="dopo-partita"]')).toBeNull();
    expect(screen.getByText(/scegli una foto o un video e accendi/)).toBeTruthy();
    // With the photo of the draft (not saved yet): the screen with the photo and the countdown.
    fireEvent.click(within(card).getByRole('switch', { name: 'Mostra foto o video dopo la partita' }));
    const choose = within(card).getByLabelText('Scegli dalla libreria: Foto o video a tutto schermo');
    await waitFor(() => expect(within(choose).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(choose, { target: { value: SPONSOR } });
    fireEvent.click(within(card).getByRole('button', { name: 'Vedi nell’anteprima grande' }));
    const screenOfPhoto = await waitFor(() => {
      const el = scope().querySelector('[data-testid="dopo-partita"]');
      if (!el) throw new Error('screen missing');
      return el;
    });
    expect(screenOfPhoto.querySelector('img')?.getAttribute('src')).toBe(`/api/admin/assets/${SPONSOR}/file`);
    expect(within(screenOfPhoto as HTMLElement).getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    // Off: the screen is still shown to the editor, with the reason.
    fireEvent.click(within(card).getByRole('switch', { name: 'Mostra foto o video dopo la partita' }));
    expect(screen.getByText(/Dopo la partita è spento/)).toBeTruthy();
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

  it('every slide has «Attiva» and «Rimuovi» in its row; a slide off stays in the list and is saved off', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Fine partita' }));
    const result = SLIDE_LABELS.finalResult.label;
    const thanks = SLIDE_LABELS.message.label;
    const toggle = () => screen.getByRole<HTMLInputElement>('switch', { name: `Attiva: ${result}` });
    expect(toggle().closest('details')).toBeNull();
    expect(toggle().checked).toBe(true);
    fireEvent.click(toggle());
    expect(toggle().checked).toBe(false);
    expect(screen.getByText('(disattivata)')).toBeTruthy();
    expect(slideOrder()).toContain('finalResult');
    // The thanks message has its own text: «Rimuovi» (outside «Opzioni») asks first.
    const remove = screen.getByRole('button', { name: `Rimuovi ${thanks}` });
    expect(remove.closest('details')).toBeNull();
    fireEvent.click(remove);
    expect(slideOrder()).toContain('thanks');
    fireEvent.click(screen.getByRole('button', { name: 'Conferma rimozione' }));
    expect(slideOrder()).not.toContain('thanks');
    // The MVP has the default options: removed at once.
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${SLIDE_LABELS.mvp.label}` }));
    expect(slideOrder()).not.toContain('mvp');
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.matchEnd.slides.find((s) => s.id === 'finalResult')?.enabled).toBe(false);
    expect(body.matchEnd.slides.map((s) => s.id)).not.toContain('thanks');
    expect(body.matchEnd.slides.map((s) => s.id)).not.toContain('mvp');
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

  it('background: none, image or video chosen from the library (no upload here), previewed, with its options, saved', async () => {
    const video: AssetSummary = {
      ...asset(VIDEO_ID, 'sponsor', 1280, 720),
      kind: 'overlay',
      mime: 'video/mp4',
      url: `/api/admin/assets/${VIDEO_ID}/file`,
      name: 'ace.mp4',
    };
    const { puts, calls } = mockServer({}, 'admin', [video]);
    renderAt('/admin/studio/avvisi');
    await studio();
    const ace = await overlayRow('ace');
    expect(within(ace).getByRole('radio', { name: 'Nessuno' })).toHaveProperty('checked', true);
    fireEvent.click(within(ace).getByRole('radio', { name: 'Video' }));
    expect(within(ace).queryByLabelText('Carica video per lo sfondo: Ace')).toBeNull();
    expect(within(ace).getByText('Carica nella libreria').getAttribute('href')).toBe('/admin/media');
    const select = within(ace).getByRole('combobox', { name: 'Video dello sfondo: Ace' });
    fireEvent.change(select, { target: { value: VIDEO_ID } });
    expect(
      within(within(ace).getByRole('combobox', { name: 'Video dello sfondo: Ace' })).getByRole('option', {
        name: /^ace\.mp4 · 1280×720 px/,
      }),
    ).toBeTruthy();
    // Options of the video: muted, in the box, our team only, for the seconds of the overlay by default.
    expect(within(ace).getByRole('checkbox', { name: 'Audio del video: Ace' })).toHaveProperty('checked', false);
    expect(within(ace).getByRole('combobox', { name: 'Posizione dello sfondo: Ace' })).toHaveProperty(
      'value',
      'center',
    );
    expect(within(ace).getByRole('combobox', { name: 'Sfondo per: Ace' })).toHaveProperty('value', 'ours');
    expect(within(ace).getByRole('combobox', { name: 'Durata: Ace' })).toHaveProperty('value', 'seconds');
    expect(
      within(within(ace).getByRole('combobox', { name: 'Durata: Ace' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Secondi impostati', 'Quanto il video']);
    expect(within(ace).getByLabelText('Anteprima del video dello sfondo: Ace').tagName).toBe('VIDEO');
    // The preview of the overlay has the video behind its text, in a loop (no «Prova»).
    const region = screen.getByTestId('prova-avviso');
    expect(region.querySelector('[data-background="video"] video')?.getAttribute('src')).toBe(
      `/api/admin/assets/${VIDEO_ID}/file`,
    );
    expect(region.querySelector('video')?.loop).toBe(true);
    fireEvent.click(within(ace).getByRole('checkbox', { name: 'Audio del video: Ace' }));
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Posizione dello sfondo: Ace' }), {
      target: { value: 'fullscreen' },
    });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Sfondo per: Ace' }), { target: { value: 'both' } });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Durata: Ace' }), { target: { value: 'video' } });
    expect(within(ace).getByText(/resta finché il video finisce/)).toBeTruthy();
    expect(region.querySelector('[data-background="video"]')?.getAttribute('data-fit')).toBe('fullscreen');
    // The preview always in view stays silent: the sound only in a «Prova».
    expect(region.querySelector('video')?.muted).toBe(true);
    save();
    expect(await screen.findByText(/Avvisi salvati/)).toBeTruthy();
    expect((puts('/api/admin/overlays').at(-1)?.body as TenantOverlays).ace.background).toEqual({
      kind: 'video',
      assetId: VIDEO_ID,
      audio: true,
      fit: 'fullscreen',
      teams: 'both',
      duration: 'video',
      showText: true,
    });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    // Back to none: the background goes.
    fireEvent.click(within(await overlayRow('ace')).getByRole('radio', { name: 'Nessuno' }));
    save();
    await waitFor(() =>
      expect((puts('/api/admin/overlays').at(-1)?.body as TenantOverlays).ace.background).toBeUndefined(),
    );
  });

  it('«Giocatore della nostra squadra»: only for ACE!, Muro and Cambio; photo or video (no «Quale»), the options of a video, saved', async () => {
    const { puts } = mockServer();
    renderAt('/admin/studio/avvisi');
    await studio();
    const tie = await overlayRow('tie');
    fireEvent.click(within(tie).getByRole('button', { name: 'Modifica Pareggio' }));
    expect(within(await overlayRow('tie')).queryByText('Giocatore della nostra squadra')).toBeNull();
    for (const kind of ['block', 'substitution']) {
      fireEvent.click(within(await overlayRow(kind)).getByRole('button', { name: /^Modifica / }));
      expect(within(await overlayRow(kind)).getByText('Giocatore della nostra squadra')).toBeTruthy();
    }
    fireEvent.click(within(await overlayRow('ace')).getByRole('button', { name: 'Modifica Ace' }));
    const ace = await overlayRow('ace');
    expect(within(ace).getByRole('radio', { name: 'Sfondo fisso dell’avviso' })).toHaveProperty('checked', true);
    expect(within(ace).queryByRole('combobox', { name: 'Quale foto o video: Ace' })).toBeNull();
    expect(within(ace).queryByRole('checkbox', { name: /Mostra il testo sopra/ })).toBeNull();
    expect(within(ace).getByText(/Si usano la foto e il video scelti per questo avviso in/)).toBeTruthy();
    expect(within(ace).getByText(/senza foto dell’avviso si usa la foto principale/)).toBeTruthy();
    expect(within(ace).getByRole('link', { name: 'Squadra' }).getAttribute('href')).toBe('/admin/squadra');
    fireEvent.click(within(ace).getByRole('radio', { name: 'Foto del giocatore' }));
    expect(within(ace).queryByRole('checkbox', { name: 'Audio del video del giocatore: Ace' })).toBeNull();
    // The photo has «Mostra il testo» and «Posizione» too (not «Audio» nor «Durata»).
    expect(
      within(ace).getByRole('checkbox', { name: 'Mostra il testo sopra la foto del giocatore: Ace' }),
    ).toBeTruthy();
    expect(within(ace).getByRole('combobox', { name: 'Posizione della foto del giocatore: Ace' })).toBeTruthy();
    expect(within(ace).queryByRole('combobox', { name: /Durata/ })).toBeNull();
    expect(within(ace).queryByRole('combobox', { name: /Quale/ })).toBeNull();
    expect(within(ace).queryByText(/Casuale|Principale/)).toBeNull();
    fireEvent.click(within(ace).getByRole('radio', { name: 'Video del giocatore' }));
    // The options of the video appear; still no «Quale».
    expect(within(ace).queryByRole('combobox', { name: /Quale/ })).toBeNull();
    fireEvent.click(within(ace).getByRole('checkbox', { name: 'Audio del video del giocatore: Ace' }));
    const showText = within(ace).getByRole('checkbox', { name: 'Mostra il testo sopra il video del giocatore: Ace' });
    expect(showText).toHaveProperty('checked', true);
    fireEvent.click(showText);
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Posizione del video del giocatore: Ace' }), {
      target: { value: 'fullscreen' },
    });
    fireEvent.change(within(ace).getByRole('combobox', { name: 'Durata del video del giocatore: Ace' }), {
      target: { value: 'video' },
    });
    save();
    expect(await screen.findByText(/Avvisi salvati/)).toBeTruthy();
    expect((puts('/api/admin/overlays').at(-1)?.body as TenantOverlays).ace.playerMedia).toEqual({
      source: 'video',
      audio: true,
      fit: 'fullscreen',
      duration: 'video',
      showText: false,
    });
    // Back to the fixed background: no player media.
    fireEvent.click(within(await overlayRow('ace')).getByRole('radio', { name: 'Sfondo fisso dell’avviso' }));
    save();
    await waitFor(() =>
      expect((puts('/api/admin/overlays').at(-1)?.body as TenantOverlays).ace.playerMedia).toBeUndefined(),
    );
  });

  it('the preview and «Prova» use the first player of the roster with files: the video of the overlay, also on the phone', async () => {
    const item = (assetId: string, video: boolean) => ({
      assetId,
      url: `/api/admin/assets/${assetId}/file`,
      video,
      name: null,
    });
    const base = {
      season: 2026,
      firstName: 'Mario',
      role: null,
      birthYear: null,
      heightCm: null,
      birthplace: null,
      nationality: null,
      source: 'league' as const,
      externalKey: null,
      editedFields: [],
      removed: false,
    };
    const PHOTO_ID = '2c3d4e5f-6071-4829-8b3c-4d5e6f7a8b9c';
    const ACE_PHOTO = '3d4e5f60-7182-4930-9c4d-5e6f7a8b9c0d';
    rosterPlayers = [
      {
        ...base,
        id: '11111111-1111-4111-8111-111111111111',
        number: 1,
        lastName: 'Senzafile',
        photo: null,
        // Files chosen for no overlay: they show nothing, not a sample.
        media: [item(VIDEO_ID, true)],
        events: noPlayerEvents(),
        position: 0,
      },
      {
        ...base,
        id: '22222222-2222-4222-8222-222222222222',
        number: 8,
        lastName: 'Rossi',
        photo: item(PHOTO_ID, false),
        media: [item(ACE_PHOTO, false), item(VIDEO_ID, true)],
        events: { ...noPlayerEvents(), ace: { photoAssetId: ACE_PHOTO, videoAssetId: VIDEO_ID } },
        position: 1,
      },
    ];
    const overlays = TenantOverlaysSchema.parse({ ace: { playerMedia: { source: 'video' } } });
    mockServer({ overlays });
    renderAt('/admin/studio/avvisi');
    await studio();
    await overlayRow('ace');
    const region = await waitFor(() => {
      const r = screen.getByTestId('prova-avviso');
      if (!r.querySelector('video')) throw new Error('video not there yet');
      return r;
    });
    expect(region.querySelector('video')?.getAttribute('src')).toBe(`/api/admin/assets/${VIDEO_ID}/file`);
    // The text is the one of the player of the roster.
    expect(region.textContent).toContain('ACE! Rossi');
    fireEvent.click(within(await overlayRow('ace')).getByRole('button', { name: 'Prova Ace' }));
    expect(screen.getByTestId('prova-avviso').querySelector('video')).not.toBeNull();
    // Phone: the video too.
    fireEvent.click(screen.getByRole('radio', { name: /Telefono/ }));
    await waitFor(() => {
      expect(screen.getByTestId('prova-avviso').querySelector('video')?.getAttribute('src')).toBe(
        `/api/admin/assets/${VIDEO_ID}/file`,
      );
    });
  });

  it('the videos are listed by name (a file without name by day and size); choosing another one changes the preview', async () => {
    const video = (id: string, name: string | null): AssetSummary => ({
      ...asset(id, 'sponsor', 1920, 1080),
      kind: 'overlay',
      mime: 'video/mp4',
      url: `/api/admin/assets/${id}/file`,
      name,
    });
    const OTHER = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
    mockServer({}, 'admin', [video(VIDEO_ID, 'Sigla ace.mp4'), video(OTHER, null)]);
    renderAt('/admin/studio/avvisi');
    const ace = await overlayRow('ace');
    fireEvent.click(within(ace).getByRole('radio', { name: 'Video' }));
    const select = await within(ace).findByRole('combobox', { name: 'Video dello sfondo: Ace' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Scegli…', 'Sigla ace.mp4 · 1920×1080 px · 0 MB', 'Video del 15/10/2026 · 1920×1080 px · 0 MB']);
    const region = screen.getByTestId('prova-avviso');
    fireEvent.change(select, { target: { value: VIDEO_ID } });
    const first = region.querySelector('video');
    expect(first?.getAttribute('src')).toBe(`/api/admin/assets/${VIDEO_ID}/file`);
    fireEvent.change(select, { target: { value: OTHER } });
    const second = region.querySelector('video');
    expect(second).not.toBe(first);
    expect(second?.getAttribute('src')).toBe(`/api/admin/assets/${OTHER}/file`);
    expect(within(ace).getByLabelText('Anteprima del video dello sfondo: Ace').getAttribute('src')).toBe(
      `/api/admin/assets/${OTHER}/file`,
    );
  });

  it('the example overlay is of our team: its video for our team only is shown', async () => {
    mockServer({
      branding: { ...SAVED_BRANDING, ourTeam: { code: 'SIR', name: 'Sir Susa' } },
      overlays: TenantOverlaysSchema.parse({ ace: { background: { kind: 'video', assetId: VIDEO_ID } } }),
    });
    renderAt('/admin/studio/avvisi');
    await overlayRow('ace');
    const region = await screen.findByTestId('prova-avviso');
    // The example match has our team at home: the example ace is ours, with the video.
    await waitFor(() =>
      expect(region.querySelector('[data-overlay="home"] video')?.getAttribute('src')).toBe(
        `/api/admin/assets/${VIDEO_ID}/file`,
      ),
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

describe('Pause: «Mostra titolo» and «Foto o video»', () => {
  const video: AssetSummary = {
    ...asset(VIDEO_ID, 'sponsor', 1280, 720),
    kind: 'overlay',
    mime: 'video/mp4',
    url: `/api/admin/assets/${VIDEO_ID}/file`,
    name: 'Spot',
  };

  it('a slide of photo or video from the whole library, its options and the title hidden, PUT', async () => {
    const { puts } = mockServer({}, 'admin', [video]);
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Time-out' }));
    const label = SLIDE_LABELS.media.label;
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo di diapositiva' }), { target: { value: 'media' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi diapositiva' }));
    expect(slideOrder()).toEqual(['sponsor', 'media']);
    const row = (): HTMLElement => {
      const li = screen
        .getByRole('list', { name: /^Diapositive/ })
        .querySelector<HTMLElement>('[data-slide-id="media"]');
      if (!li) throw new Error('no row');
      return li;
    };
    expect(within(row()).getByText('Senza un file la diapositiva non compare.')).toBeTruthy();
    // Images: every image of the library (logo and sponsor too), never a video.
    const images = within(row()).getByRole('combobox', { name: `Immagine: ${label}` });
    await waitFor(() => expect(within(images).getAllByRole('option')).toHaveLength(3));
    fireEvent.change(images, { target: { value: SPONSOR } });
    expect(
      within(row())
        .getByRole('img', { name: `Anteprima dell’immagine: ${label}` })
        .getAttribute('src'),
    ).toBe(`/api/admin/assets/${SPONSOR}/file`);
    expect(within(row()).queryByRole('checkbox', { name: `Audio del video: ${label}` })).toBeNull();
    // A video: the image chosen goes, the options of a video come.
    fireEvent.click(within(row()).getByRole('radio', { name: 'Video' }));
    const videos = within(row()).getByRole('combobox', { name: `Video: ${label}` });
    expect(
      within(videos)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', VIDEO_ID]);
    fireEvent.change(videos, { target: { value: VIDEO_ID } });
    fireEvent.click(within(row()).getByRole('checkbox', { name: `Audio del video: ${label}` }));
    fireEvent.change(within(row()).getByRole('combobox', { name: `Durata del video: ${label}` }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(row()).getByRole('combobox', { name: `Spazio: ${label}` }), { target: { value: 'cover' } });
    const title = within(row()).getByRole<HTMLInputElement>('checkbox', { name: `Mostra titolo: ${label}` });
    expect(title.checked).toBe(true);
    fireEvent.click(title);
    expect(within(row()).getByText(/Il titolo della pausa non compare/)).toBeTruthy();
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.timeout.slides[0]).toMatchObject({ id: 'sponsor', showTitle: true });
    expect(body.timeout.slides[1]).toEqual({
      id: 'media',
      type: 'media',
      seconds: 8,
      enabled: true,
      showTitle: false,
      options: { kind: 'video', assetId: VIDEO_ID, fit: 'cover', audio: true, duration: 'video' },
    });
  });

  it('«Dopo la partita» with a video of the library: its kind follows the file, sound and fit, PUT', async () => {
    const { puts } = mockServer({}, 'admin', [video]);
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Fine partita' }));
    const card = screen.getByRole('region', { name: 'Dopo la partita' });
    fireEvent.click(within(card).getByRole('switch', { name: 'Mostra foto o video dopo la partita' }));
    const choose = within(card).getByLabelText('Scegli dalla libreria: Foto o video a tutto schermo');
    // Photos and videos of the whole library.
    await waitFor(() => expect(within(choose).getAllByRole('option')).toHaveLength(4));
    fireEvent.change(choose, { target: { value: VIDEO_ID } });
    await waitFor(() =>
      expect(within(card).getByRole('checkbox', { name: 'Audio del video: Dopo la partita' })).toBeTruthy(),
    );
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Audio del video: Dopo la partita' }));
    fireEvent.change(within(card).getByRole('combobox', { name: 'Spazio: Dopo la partita' }), {
      target: { value: 'contain' },
    });
    const preview = within(card).getByTestId('anteprima-dopo-partita');
    expect(preview.querySelector('video')?.getAttribute('src')).toBe(`/api/admin/assets/${VIDEO_ID}/file`);
    // The preview is silent.
    expect(preview.querySelector('video')?.dataset.audio).toBe('off');
    save();
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    const body = puts('/api/admin/intermissions').at(-1)?.body as TenantIntermissions;
    expect(body.afterMatch).toMatchObject({
      enabled: true,
      image: VIDEO_ID,
      kind: 'video',
      audio: true,
      fit: 'contain',
    });
    // Back to a photo: an image again, no sound option.
    fireEvent.change(within(card).getByLabelText('Scegli dalla libreria: Foto o video a tutto schermo'), {
      target: { value: SPONSOR },
    });
    await waitFor(() =>
      expect(within(card).queryByRole('checkbox', { name: 'Audio del video: Dopo la partita' })).toBeNull(),
    );
  });

  it('a file no longer in the library is told, to choose another one', async () => {
    const intermissions = TenantIntermissionsSchema.parse({
      timeout: {
        slides: [{ id: 'media', type: 'media', options: { assetId: '00000000-0000-4000-8000-000000000000' } }],
      },
    });
    mockServer({ intermissions });
    renderAt('/admin/studio/pause');
    await studio();
    fireEvent.click(screen.getByRole('tab', { name: 'Time-out' }));
    expect(await screen.findByText(/Il file scelto non è più nella libreria/)).toBeTruthy();
  });
});
