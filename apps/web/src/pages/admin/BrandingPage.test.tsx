import type { AssetListResponse, AssetSummary, BrandingResponse, MeResponse, TenantBranding } from '@sir/shared';
import { DEFAULT_BRAND_COLORS, defaultBranding } from '@sir/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTenantLook } from '../../lib/branding.ts';
import { AdminApp } from './AdminApp.tsx';
import { contrastText, withOurTeamField } from './BrandingPage.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const LOGO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
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

const asset = (id: string, width = 240, height = 60): AssetSummary => ({
  id,
  kind: 'logo',
  mime: 'image/png',
  width,
  height,
  bytes: 1234,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-15T10:00:00.000Z',
  url: `/api/public/assets/${id}`,
});

function mockServer(role: MeResponse['role'] = 'admin'): { calls: Call[] } {
  let branding: TenantBranding = { ...defaultBranding(), colors: { home: '#e30613' }, logoMain: LOGO };
  let assets = [asset(LOGO)];
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
      if (url === '/api/admin/branding' && method === 'GET')
        return json({ tenantName: 'Sir', branding } satisfies BrandingResponse);
      if (url === '/api/admin/branding' && method === 'PUT') {
        branding = { ...defaultBranding(), ...(body as Partial<TenantBranding>) };
        return json({ tenantName: 'Sir', branding } satisfies BrandingResponse);
      }
      if (url === '/api/admin/assets' && method === 'GET')
        return json({ assets, usedBytes: 1234, quotaBytes: 50 * 1024 * 1024 } satisfies AssetListResponse);
      if (url === '/api/admin/assets' && method === 'POST') {
        const created = asset(UPLOADED, 64, 64);
        assets = [created, ...assets];
        return json(created, 201);
      }
      if (url.startsWith('/api/admin/assets/') && method === 'DELETE')
        return json({ error: 'Immagine in uso nella grafica: toglila prima di eliminarla' }, 409);
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

const preview = () => screen.getByTestId('anteprima-grafica');
const previewVar = (name: string) => preview().style.getPropertyValue(name);

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  // The graphics loaded by a test (after a save) must not leak into the next one.
  act(() => setTenantLook(null));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Grafica» page', () => {
  it('is in the menu of an admin and not of a viewer', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    expect(await screen.findByRole('link', { name: 'Grafica' })).toBeTruthy();
    cleanup();
    mockServer('viewer');
    renderAt('/admin/grafica');
    await screen.findByRole('link', { name: 'Partite' });
    expect(screen.queryByRole('link', { name: 'Grafica' })).toBeNull();
    expect(screen.queryByTestId('anteprima-grafica')).toBeNull();
  });

  it('shows the saved graphics in the live preview and follows the edits', async () => {
    mockServer();
    renderAt('/admin/grafica');
    await screen.findByTestId('anteprima-grafica');
    expect(previewVar('--sir-home')).toBe('#e30613');
    // Colours left to the default are written too, so the page around does not leak into the preview.
    expect(previewVar('--sir-away')).toBe(DEFAULT_BRAND_COLORS.away);
    const logo = within(preview()).getByRole('img', { name: 'Sir' });
    expect(logo.getAttribute('src')).toBe(`/api/public/assets/${LOGO}`);

    fireEvent.change(screen.getByRole('textbox', { name: 'Squadra ospite' }), { target: { value: '#003399' } });
    expect(previewVar('--sir-away')).toBe('#003399');
    expect(previewVar('--sir-on-away')).toBe('#ffffff');
    fireEvent.change(screen.getByLabelText('Colore principale: selettore'), { target: { value: '#ffcc00' } });
    expect(previewVar('--sir-primary')).toBe('#ffcc00');
    expect(previewVar('--sir-on-primary')).toBe('#000000');
    expect(screen.getByText('Modifiche non salvate.')).toBeTruthy();
  });

  it('warns about colours with little contrast on the background', async () => {
    mockServer();
    renderAt('/admin/grafica');
    const field = await screen.findByRole('textbox', { name: 'Squadra di casa' });
    fireEvent.change(field, { target: { value: '#ffee00' } });
    expect(await screen.findByText(/«Squadra di casa» ha contrasto/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Sfondo della pagina' }), { target: { value: '#111111' } });
    expect(await screen.findByText(/Lo sfondo è troppo scuro/)).toBeTruthy();
  });

  it('ignores a half typed colour and marks it', async () => {
    mockServer();
    renderAt('/admin/grafica');
    const field = await screen.findByRole('textbox', { name: 'Squadra di casa' });
    fireEvent.change(field, { target: { value: '#ff' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(previewVar('--sir-home')).toBe('#e30613');
    expect(screen.getByText(/Scrivi il colore come #rrggbb/)).toBeTruthy();
  });

  it('saves the draft with PUT and restores the defaults', async () => {
    const { calls } = mockServer();
    renderAt('/admin/grafica');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Squadra ospite' }), {
      target: { value: '#003399' },
    });
    fireEvent.change(screen.getByLabelText('Nome visualizzato', { exact: false }), {
      target: { value: 'Sir Safety Perugia' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText(/Grafica salvata/)).toBeTruthy();
    const put = calls.find((c) => c.url === '/api/admin/branding' && c.method === 'PUT');
    expect(put?.body).toMatchObject({
      displayName: 'Sir Safety Perugia',
      colors: { home: '#e30613', away: '#003399' },
      logoMain: LOGO,
    });
    // After the save the portal reads its graphics again, skipping the HTTP cache.
    await waitFor(() => expect(calls.some((c) => c.url === '/api/public/tenant')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Ripristina predefiniti' }));
    expect(previewVar('--sir-home')).toBe(DEFAULT_BRAND_COLORS.home);
    expect(within(preview()).queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ ...defaultBranding() }));
  });

  it('uploads a logo as base64 and puts it in the draft', async () => {
    const { calls } = mockServer();
    renderAt('/admin/grafica');
    const input = await screen.findByLabelText('Carica logo quadrato');
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    fireEvent.change(input, { target: { files: [new File([bytes], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/assets' && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.url === '/api/admin/assets' && c.method === 'POST');
    expect(post?.body).toEqual({ kind: 'logo', data: Buffer.from(bytes).toString('base64') });
    const mark = await within(preview()).findByRole('img', { name: 'Logo quadrato' });
    expect(mark.getAttribute('src')).toBe(`/api/public/assets/${UPLOADED}`);
  });

  it('refuses a file over 2 MB before sending it and shows why the server refuses a deletion', async () => {
    const { calls } = mockServer();
    renderAt('/admin/grafica');
    const input = await screen.findByLabelText('Carica logo orizzontale');
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('Immagine troppo grande: al massimo 2 MB.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/assets')).toBe(false);

    const list = screen.getByRole('heading', { name: 'Immagini caricate' }).closest('section');
    if (!list) throw new Error('no list');
    fireEvent.click(within(list).getByRole('button', { name: 'Elimina' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Conferma eliminazione' }));
    expect(await screen.findByText(/Immagine in uso nella grafica/)).toBeTruthy();
  });
});

describe('template and team of the client', () => {
  it('chooses the template, shows it in the preview and saves it with the team of the client', async () => {
    const { calls } = mockServer();
    renderAt('/admin/grafica');
    const picker = await screen.findByRole('radiogroup', { name: 'Modello grafico' });
    expect(
      within(picker)
        .getByRole('radio', { name: /Standard/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.click(within(picker).getByRole('radio', { name: /SIR VOLLEY/ }));
    expect(preview().getAttribute('data-template')).toBe('sir-volley');
    expect(preview().getAttribute('data-theme')).toBe('dark');
    expect(within(preview()).getByRole('img', { name: 'SIR Real Time' })).toBeTruthy();
    expect(screen.getByText(/usa sempre il tema scuro/)).toBeTruthy();
    // Only the colours chosen go over the template (here the home colour of the saved graphics).
    expect(previewVar('--sir-away')).toBe('');
    fireEvent.change(screen.getByRole('textbox', { name: /Codice squadra/ }), { target: { value: 'PER' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Testo nel nome/ }), { target: { value: 'Perugia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText(/Grafica salvata/)).toBeTruthy();
    const put = calls.find((c) => c.url === '/api/admin/branding' && c.method === 'PUT');
    expect(put?.body).toMatchObject({ template: 'sir-volley', ourTeam: { code: 'PER', name: 'Perugia' } });
  });

  it('sends an emptied field of the team as null', () => {
    expect(withOurTeamField({ code: 'PER', name: null }, 'code', '  ')).toEqual({ code: null, name: null });
    expect(withOurTeamField({ code: null, name: null }, 'name', 'Perugia')).toEqual({ code: null, name: 'Perugia' });
  });
});

describe('contrastText', () => {
  it('writes the ratio in Italian', () => {
    expect(contrastText({ color: 'home', against: 'background', ratio: 2.04 })).toBe(
      '«Squadra di casa» ha contrasto 2:1 sullo sfondo (minimo 4,5:1): i testi in questo colore si leggono male.',
    );
  });
});
