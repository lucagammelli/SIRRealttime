import type {
  AssetListResponse,
  AssetSummary,
  BrandingResponse,
  IntermissionsResponse,
  TenantIntermissions,
} from '@sir/shared';
import { defaultBranding, defaultIntermission, defaultIntermissions, TenantIntermissionsSchema } from '@sir/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.tsx';
import {
  addSlide,
  freeSlideId,
  moveSlide,
  pauseAt,
  pauseProblems,
  removeSlide,
  resetPause,
  setOwnPause,
  targetSet,
  withPause,
} from './intermissionEditor.ts';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const SPONSOR = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const URL = '/api/admin/intermissions';

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

function mockServer(initial: TenantIntermissions = defaultIntermissions()): { calls: Call[] } {
  let intermissions = initial;
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
      if (url === URL && method === 'GET')
        return json({ tenantName: 'Sir', intermissions } satisfies IntermissionsResponse);
      if (url === URL && method === 'PUT') {
        intermissions = TenantIntermissionsSchema.parse(body);
        return json({ tenantName: 'Sir', intermissions } satisfies IntermissionsResponse);
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

const slideList = () => screen.getByRole('list', { name: /^Diapositive/ });
const order = (): string[] =>
  Array.from(slideList().querySelectorAll<HTMLElement>(':scope > li')).map((li) => li.dataset.slideId ?? '');
const lastPut = (calls: Call[]) => calls.filter((c) => c.url === URL && c.method === 'PUT').at(-1);
const savedBody = (calls: Call[]) => lastPut(calls)?.body as TenantIntermissions;

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editing helpers of the pauses', () => {
  it('add, move, remove slides and reset a pause', () => {
    const pause = defaultIntermission('setBreak');
    const added = addSlide(addSlide(pause, 'qr'), 'qr');
    expect(added.slides.map((s) => s.id)).toEqual(['setSummary', 'sponsor', 'qr', 'qr-2']);
    expect(added.slides.at(-1)).toMatchObject({ seconds: 8, options: { caption: 'Segui la partita sul telefono' } });
    expect(moveSlide(added, 3, 0).slides[0]?.id).toBe('qr-2');
    expect(moveSlide(added, 0, 99).slides.at(-1)?.id).toBe('setSummary');
    expect(removeSlide(added, 'sponsor').slides.map((s) => s.id)).toEqual(['setSummary', 'qr', 'qr-2']);
    expect(freeSlideId(added.slides, 'mvp')).toBe('mvp');
    const config = withPause(defaultIntermissions(), 'timeout', { ...pause, delaySeconds: 9 });
    expect(config.timeout.delaySeconds).toBe(9);
    expect(resetPause(config, 'timeout')).toEqual(defaultIntermissions());
  });

  it('own pause of a set: copy of the generic one, then back to it', () => {
    expect(targetSet('setBreak-3')).toBe('3');
    expect(targetSet('setBreak')).toBeNull();
    const base = withPause(defaultIntermissions(), 'setBreak', { ...defaultIntermission('setBreak'), delaySeconds: 2 });
    expect(pauseAt(base, 'setBreak-2')).toBeUndefined();
    const own = setOwnPause(base, '2', true);
    expect(pauseAt(own, 'setBreak-2')).toEqual(base.setBreak);
    expect(pauseAt(own, 'setBreak-2')).not.toBe(base.setBreak);
    expect(setOwnPause(own, '2', false).setBreakBySet).toEqual({});
    expect(pauseAt(resetPause(own, 'setBreak-2'), 'setBreak-2')?.delaySeconds).toBe(5);
  });

  it('finds the pauses that cannot be saved', () => {
    const config = defaultIntermissions();
    expect(pauseProblems(config).size).toBe(0);
    const empty = withPause(config, 'timeout', { ...config.timeout, slides: [] });
    expect(pauseProblems(empty)).toEqual(new Set(['timeout']));
    const own = setOwnPause(config, '4', true);
    const broken = withPause(own, 'setBreak-4', {
      ...config.setBreak,
      slides: [{ id: 'm', type: 'message', seconds: 8, options: { text: ' ', size: 'normal' } }],
    });
    expect(pauseProblems(broken)).toEqual(new Set(['setBreak-4']));
  });
});

describe('«Pause e sponsor» page', () => {
  it('is in the menu of an admin, with the three pauses, the sets and the preview of the end of set', async () => {
    mockServer();
    renderAt('/admin/pause');
    expect(await screen.findByRole('link', { name: 'Pause e sponsor' })).toBeTruthy();
    const pauses = within(await screen.findByRole('tablist', { name: 'Pausa' })).getAllByRole('tab');
    expect(pauses.map((t) => t.textContent)).toEqual(['Time-out', 'Fine set', 'Fine partita']);
    expect(pauses[1]?.getAttribute('aria-selected')).toBe('true');
    const sets = within(screen.getByRole('tablist', { name: 'Set' })).getAllByRole('tab');
    expect(sets.map((t) => t.textContent)).toEqual(['Tutti i set', '1° set', '2° set', '3° set', '4° set']);
    expect(order()).toEqual(['setSummary', 'sponsor']);
    // TV preview of the example match with the end of its first set, full screen
    const tv = await screen.findByTestId('anteprima-tv');
    const dialog = await within(tv).findByRole('dialog', { name: 'Fine 1° set' });
    expect(within(dialog).getByText('Riepilogo del 1° set')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Torna alla partita' })).toBeNull();
    // on the phone the end of set is a banner
    fireEvent.click(screen.getByRole('tab', { name: 'Telefono' }));
    const phone = await screen.findByTestId('anteprima-phone');
    await waitFor(() => expect(phone.querySelector('[data-intermission="banner"]')).toBeTruthy());
    expect(within(phone).queryByRole('dialog')).toBeNull();
  });

  it('changes the mode of a device, the delay and the slides, and saves with PUT', async () => {
    const { calls } = mockServer();
    renderAt('/admin/pause');
    fireEvent.click(await screen.findByRole('tab', { name: 'Time-out' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Modo su TV' }), { target: { value: 'fullscreen' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Ritardo prima della pausa/ }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo di diapositiva' }), { target: { value: 'message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi diapositiva' }));
    expect(order()).toEqual(['sponsor', 'message']);
    expect(screen.getByText('Messaggio aggiunta in fondo.')).toBeTruthy();
    const text = screen.getByRole('textbox', { name: 'Testo del messaggio' });
    fireEvent.change(text, { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toContain('non valide');
    expect(screen.getByRole('button', { name: 'Salva' })).toHaveProperty('disabled', true);
    fireEvent.change(text, { target: { value: 'Forza <b>Sir</b>!' } });
    // the preview shows the time-out, full screen on the TV, with the new message as plain text
    fireEvent.click(screen.getByRole('button', { name: 'Sposta su Messaggio' }));
    expect(order()).toEqual(['message', 'sponsor']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sposta giù Messaggio' }));
    const tv = await screen.findByTestId('anteprima-tv');
    expect(await within(tv).findByText('Forza <b>Sir</b>!')).toBeTruthy();
    expect(within(tv).getByRole('dialog', { name: 'Time-out Pallavolo Città' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Secondi sullo schermo: Messaggio' }), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Immagine 1 · 300×100 px/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText(/Pause salvate/)).toBeTruthy();
    expect(screen.queryByText('Modifiche non salvate.')).toBeNull();
    const saved = savedBody(calls);
    expect(saved.timeout).toMatchObject({
      modes: { tv: 'fullscreen', tablet: 'banner', phone: 'banner' },
      delaySeconds: 3,
      slides: [
        { id: 'message', type: 'message', seconds: 12, options: { text: 'Forza <b>Sir</b>!' } },
        { id: 'sponsor', type: 'sponsor', options: { images: [SPONSOR] } },
      ],
    });
    expect(saved.setBreak).toEqual(defaultIntermissions().setBreak);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/public/tenant')).toBe(true));
  });

  it('gives the 3rd set its own end of set, turns a pause off and restores the default', async () => {
    const { calls } = mockServer();
    renderAt('/admin/pause');
    fireEvent.click(await screen.findByRole('tab', { name: '3° set' }));
    expect(screen.getByText(/si usa la pausa di «Tutti i set»/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ripristina predefinito' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pausa propria per la fine del 3° set' }));
    expect(order()).toEqual(['setSummary', 'sponsor']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi Sponsor' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Fine partita' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Pausa attiva' }));
    expect(screen.getByText('Pausa disattivata: gli spettatori non la vedono.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await screen.findByText(/Pause salvate/);
    const saved = savedBody(calls);
    expect(saved.setBreakBySet['3']?.slides.map((s) => s.type)).toEqual(['setSummary']);
    expect(saved.setBreakBySet['1']).toBeUndefined();
    expect(saved.matchEnd.enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina predefinito' }));
    expect(screen.getByRole('switch', { name: 'Pausa attiva' })).toHaveProperty('checked', true);
    expect(order()).toEqual(['finalResult', 'mvp', 'thanks', 'sponsor']);
    expect(screen.getByText('Modifiche non salvate.')).toBeTruthy();
  });
});
