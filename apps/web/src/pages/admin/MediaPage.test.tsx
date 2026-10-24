import type { AssetListResponse, AssetSummary, Sponsor } from '@arenalive/shared';
import {
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  TenantOverlaysSchema,
} from '@arenalive/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { assetUseText, MediaPage, playersByAsset, UPLOAD_USES } from './MediaPage.tsx';

const LOGO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const BACKGROUND = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b';
const SPARE = '2c3d4e5f-6071-4829-8b3c-4d5e6f7a8b9c';
const SPONSOR = '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c';

const asset = (id: string, kind: AssetSummary['kind'], name: string | null): AssetSummary => ({
  id,
  kind,
  mime: 'image/png',
  width: 240,
  height: 60,
  bytes: 1234,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-15T10:00:00.000Z',
  url: `/api/public/assets/${id}`,
  sponsorId: null,
  name,
});
const ASSETS: AssetListResponse = {
  assets: [
    asset(LOGO, 'logo', 'Logo del club'),
    asset(BACKGROUND, 'overlay', 'Sfondo ace'),
    asset(SPARE, 'logo', 'Logo vecchio'),
  ],
  usedBytes: 3702,
  quotaBytes: 50 * 1024 * 1024,
};
const SPONSORS: Sponsor[] = [
  {
    id: SPONSOR,
    name: 'Bar Centrale',
    website: null,
    position: 0,
    imageIds: [],
    createdAt: '2026-10-15T10:00:00.000Z',
  },
];

function serve(
  onCall?: (call: { url: string; method: string; body: unknown }) => { body: unknown; status?: number } | undefined,
) {
  const overlays = defaultOverlays();
  overlays.ace = { ...overlays.ace, background: { kind: 'image', assetId: BACKGROUND } } as typeof overlays.ace;
  return mockApi((call) => {
    const own = onCall?.(call);
    if (own) return own;
    if (call.url === '/api/admin/assets' && call.method === 'GET') return { body: ASSETS };
    if (call.url === '/api/admin/sponsors') return { body: { sponsors: SPONSORS } };
    if (call.url === '/api/admin/branding')
      return { body: { tenantName: 'Sir', branding: { ...defaultBranding(), logoMain: LOGO } } };
    if (call.url === '/api/admin/layout') return { body: { tenantName: 'Sir', layout: defaultLayout() } };
    if (call.url === '/api/admin/intermissions')
      return { body: { tenantName: 'Sir', intermissions: defaultIntermissions() } };
    if (call.url === '/api/admin/overlays')
      return {
        body: { tenantName: 'Sir', overlays: TenantOverlaysSchema.parse(JSON.parse(JSON.stringify(overlays))) },
      };
    if (call.url === '/api/admin/assets' && call.method === 'POST')
      return { status: 201, body: asset(SPARE, 'logo', 'nuovo.png') };
    return { body: [] };
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('page «Immagini e video»', () => {
  it('lists the files with their use and «in uso» from the saved documents, with a loading state first', async () => {
    serve();
    renderAs('admin', <MediaPage />);
    expect(screen.getByText('Caricamento delle immagini e dei video…')).toBeTruthy();
    const list = (await screen.findByRole('heading', { name: 'Immagini e video caricati' })).closest(
      'section',
    ) as HTMLElement;
    const row = (name: string) => within(list).getByText(name).closest('li') as HTMLElement;
    expect(row('Logo del club').textContent).toContain('in uso');
    expect(row('Sfondo ace').textContent).toContain('in uso');
    expect(row('Sfondo ace').textContent).toContain('Sfondo di un avviso');
    expect(row('Logo vecchio').textContent).not.toContain('in uso');
    expect(document.title).toBe('Immagini e video · Area riservata');
  });

  it('uploads an image for a logo, or for a sponsor of the list, with the name of the file', async () => {
    const calls = serve();
    renderAs('admin', <MediaPage />);
    await screen.findByRole('heading', { name: 'Immagini e video caricati' });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Carica immagine nella libreria'), { target: { files: [file] } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/assets' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ kind: 'logo', name: 'logo.png' });
    expect(await screen.findByText(/Caricato: nuovo\.png/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Uso dell’immagine'), { target: { value: 'sponsor' } });
    fireEvent.change(screen.getByLabelText(/^Sponsor/), { target: { value: SPONSOR } });
    fireEvent.change(screen.getByLabelText('Carica immagine nella libreria'), { target: { files: [file] } });
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toMatchObject({ kind: 'sponsor', sponsorId: SPONSOR });
  });

  it('uploads a video as the background of the overlays; refuses a wrong file or a too big image in Italian', async () => {
    const calls = serve();
    renderAs('admin', <MediaPage />);
    await screen.findByRole('heading', { name: 'Immagini e video caricati' });
    fireEvent.change(screen.getByLabelText('Carica video nella libreria'), {
      target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText('Formato non ammesso: scegli un video MP4 o WebM.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Carica immagine nella libreria'), {
      target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('Immagine troppo grande: al massimo 2 MB.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('Carica video nella libreria'), {
      target: { files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })] },
    });
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/admin/assets/video' && c.method === 'POST')).toBe(true),
    );
  });

  it('renames and deletes; a refusal of the server is shown in Italian', async () => {
    const calls = serve(({ url, method }) =>
      method === 'DELETE' && url.startsWith('/api/admin/assets/')
        ? { status: 409, body: { error: 'Immagine in uso nella grafica: toglila prima da dove la usi' } }
        : undefined,
    );
    renderAs('admin', <MediaPage />);
    const list = (await screen.findByRole('heading', { name: 'Immagini e video caricati' })).closest(
      'section',
    ) as HTMLElement;
    fireEvent.click(within(list).getByRole('button', { name: 'Elimina Logo del club' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Conferma eliminazione' }));
    expect(await screen.findByText(/Immagine in uso nella grafica/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    fireEvent.click(within(list).getByRole('button', { name: 'Rinomina Logo vecchio' }));
    fireEvent.change(within(list).getByRole('textbox', { name: 'Nuovo nome di Logo vecchio' }), {
      target: { value: 'Logo 2020' },
    });
    fireEvent.click(within(list).getByRole('button', { name: 'Salva nome' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Logo 2020' }));
  });

  it('a file without a name is shown with its day and size', async () => {
    mockApi((call) => {
      if (call.url === '/api/admin/assets') return { body: { ...ASSETS, assets: [asset(LOGO, 'logo', null)] } };
      if (call.url === '/api/admin/sponsors') return { body: { sponsors: [] } };
      if (call.url === '/api/admin/branding') return { body: { tenantName: 'Sir', branding: defaultBranding() } };
      if (call.url === '/api/admin/layout') return { body: { tenantName: 'Sir', layout: defaultLayout() } };
      if (call.url === '/api/admin/intermissions')
        return { body: { tenantName: 'Sir', intermissions: defaultIntermissions() } };
      return { body: { tenantName: 'Sir', overlays: defaultOverlays() } };
    });
    renderAs('admin', <MediaPage />);
    expect(await screen.findByText('Immagine del 15/10/2026 · 240×60')).toBeTruthy();
    expect(screen.getByText(/^Logo · 240×60 px · 0 MB/)).toBeTruthy();
  });

  it('a failed load shows the error in Italian', async () => {
    mockApi(() => ({ status: 500, body: { error: 'Errore del server' } }));
    renderAs('admin', <MediaPage />);
    expect(await screen.findByText(/Errore del server|errore/i)).toBeTruthy();
  });
});

describe('page «Immagini e video»: photos and videos of the players', () => {
  const CLIP = '3d4e5f60-7182-4930-8c4d-5e6f7a8b9cad';
  const SHOT = '4e5f6071-8293-4a41-8d5e-6f7a8b9cadbe';
  const PLAYER_ID = '5f607182-93a4-4b52-8e6f-7a8b9cadbecf';
  const rosterBody = {
    season: 2026,
    seasons: [2026],
    team: null,
    import: { running: false, photosDone: 0, photosTotal: 0, lastAt: null, lastError: null },
    players: [
      {
        id: PLAYER_ID,
        season: 2026,
        number: 8,
        firstName: 'Mario',
        lastName: 'Rossi',
        role: null,
        birthYear: null,
        heightCm: null,
        birthplace: null,
        nationality: null,
        source: 'manual',
        externalKey: null,
        editedFields: [],
        photo: { assetId: SHOT, url: `/api/admin/assets/${SHOT}/file`, video: false, name: null },
        media: [{ assetId: CLIP, url: `/api/admin/assets/${CLIP}/file`, video: true, name: null }],
        removed: false,
        position: 0,
      },
    ],
  };
  const files: AssetListResponse = {
    ...ASSETS,
    assets: [
      { ...asset(SHOT, 'player', 'Rossi in posa') },
      { ...asset(CLIP, 'player', 'Rossi muro'), mime: 'video/mp4' },
      { ...asset(SPARE, 'player', 'Foto libera') },
    ],
  };

  it('shows «Giocatore: Cognome» for the files a player uses, and «in uso» only for them', async () => {
    mockApi((call) => {
      if (call.url === '/api/admin/roster') return { body: rosterBody };
      if (call.url === '/api/admin/assets') return { body: files };
      if (call.url === '/api/admin/sponsors') return { body: { sponsors: [] } };
      if (call.url === '/api/admin/branding') return { body: { tenantName: 'Sir', branding: defaultBranding() } };
      if (call.url === '/api/admin/layout') return { body: { tenantName: 'Sir', layout: defaultLayout() } };
      if (call.url === '/api/admin/intermissions')
        return { body: { tenantName: 'Sir', intermissions: defaultIntermissions() } };
      return { body: { tenantName: 'Sir', overlays: defaultOverlays() } };
    });
    renderAs('admin', <MediaPage />);
    const list = (await screen.findByRole('heading', { name: 'Immagini e video caricati' })).closest(
      'section',
    ) as HTMLElement;
    const row = (name: string) => within(list).getByText(name).closest('li') as HTMLElement;
    await waitFor(() => expect(row('Rossi in posa').textContent).toContain('Giocatore: Rossi'));
    expect(row('Rossi in posa').textContent).toContain('in uso');
    expect(row('Rossi muro').textContent).toContain('Giocatore: Rossi');
    expect(row('Foto libera').textContent).toContain('Foto di un giocatore');
    expect(row('Foto libera').textContent).not.toContain('in uso');
  });

  it('pure texts: the use of a player file, and the players by file (removed ones left out)', () => {
    const photo = asset(SHOT, 'player', null);
    expect(assetUseText(photo, new Map())).toBe('Foto di un giocatore');
    expect(assetUseText({ ...photo, mime: 'video/webm' }, new Map())).toBe('Video di un giocatore');
    expect(assetUseText(photo, new Map(), ['Rossi', 'Bianchi'])).toBe('Giocatore: Rossi, Bianchi');
    const [rossi] = rosterBody.players;
    if (!rossi) throw new Error('giocatore mancante');
    const byAsset = playersByAsset([rossi, { ...rossi, lastName: 'Bianchi', removed: true }]);
    expect(byAsset.get(SHOT)).toEqual(['Rossi']);
    expect(byAsset.get(CLIP)).toEqual(['Rossi']);
  });

  it('«Foto e video dei giocatori» is a use: the image goes as kind player and the video with ?kind=player', async () => {
    expect(UPLOAD_USES.map((u) => u.label)).toContain('Foto e video dei giocatori');
    const calls = serve();
    renderAs('admin', <MediaPage />);
    await screen.findByRole('heading', { name: 'Immagini e video caricati' });
    fireEvent.change(screen.getByLabelText('Uso dell’immagine'), { target: { value: 'player' } });
    fireEvent.change(screen.getByLabelText('Carica immagine nella libreria'), {
      target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'rossi.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/assets' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.url === '/api/admin/assets' && c.method === 'POST')?.body).toMatchObject({
      kind: 'player',
    });
    fireEvent.change(screen.getByLabelText('Carica video nella libreria'), {
      target: { files: [new File(['v'], 'rossi.mp4', { type: 'video/mp4' })] },
    });
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/admin/assets/video?kind=player' && c.method === 'POST')).toBe(true),
    );
  });
});
