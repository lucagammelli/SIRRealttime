import type { AssetListResponse, AssetSummary, LayoutBlock, Sponsor } from '@arenalive/shared';
import { LayoutBlockSchema } from '@arenalive/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { BlockOptionsEditor } from './studio/blockEditors.tsx';
import { movedIds, SponsorsPage } from './SponsorsPage.tsx';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const IMG = '33333333-3333-4333-8333-333333333333';
const LOOSE = '44444444-4444-4444-8444-444444444444';

const sponsor = (id: string, name: string, position: number, imageIds: string[] = []): Sponsor => ({
  id,
  name,
  website: position === 0 ? 'https://bar.example.it' : null,
  position,
  imageIds,
  createdAt: '2026-10-15T10:00:00.000Z',
});

const asset = (id: string, sponsorId: string | null): AssetSummary => ({
  id,
  kind: 'sponsor',
  mime: 'image/png',
  width: 300,
  height: 100,
  bytes: 1234,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-15T10:00:00.000Z',
  url: `/api/admin/assets/${id}/file`,
  sponsorId,
});

const SPONSORS = [sponsor(S1, 'Bar Centrale', 0, [IMG]), sponsor(S2, 'Autofficina', 1)];
const ASSETS: AssetListResponse = {
  assets: [asset(IMG, S1), asset(LOOSE, null)],
  usedBytes: 2468,
  quotaBytes: 1_000_000,
};

function serve() {
  return mockApi(({ url, method }) => {
    if (url === '/api/admin/sponsors' && method === 'GET') return { body: { sponsors: SPONSORS } };
    if (url === '/api/admin/sponsors' && method === 'POST')
      return { status: 201, body: sponsor('55555555-5555-4555-8555-555555555555', 'Nuovo', 2) };
    if (url === '/api/admin/sponsors/order') return { body: { sponsors: [...SPONSORS].reverse() } };
    if (url === '/api/admin/assets' && method === 'GET') return { body: ASSETS };
    if (url.startsWith('/api/admin/assets/') && method === 'PATCH') return { body: asset(LOOSE, S2) };
    if (url.startsWith('/api/admin/sponsors/') && method === 'DELETE')
      return {
        status: 409,
        body: { error: 'Sponsor in uso nella pagina pubblica: toglilo dal blocco sponsor prima di eliminarlo' },
      };
    return { body: [] };
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('movedIds', () => {
  it('moves one id and ignores a move out of the list', () => {
    expect(movedIds(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(movedIds(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});

describe('page «Sponsor»', () => {
  it('lists the sponsors in order with website and images, and the images without sponsor', async () => {
    serve();
    renderAs('admin', <SponsorsPage />);
    const bar = await screen.findByRole('listitem', { name: 'Bar Centrale' });
    expect(within(bar).getByText('1. Bar Centrale')).toBeTruthy();
    expect(within(bar).getByText(/https:\/\/bar\.example\.it · 1 immagine/)).toBeTruthy();
    expect(within(bar).getByRole('img', { name: 'Bar Centrale, immagine 1' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Sposta su Bar Centrale' })).toHaveProperty('disabled', true);
    const auto = screen.getByRole('listitem', { name: 'Autofficina' });
    expect(within(auto).getByText(/Nessun sito · nessuna immagine/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Immagini senza sponsor' })).toBeTruthy();
  });

  it('creates a sponsor, refusing a website that is not https', async () => {
    const calls = serve();
    renderAs('admin', <SponsorsPage />);
    const form = await screen.findByRole('form', { name: 'Nuovo sponsor' });
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Nuovo' } });
    fireEvent.change(within(form).getByLabelText(/Sito/), { target: { value: 'http://nuovo.it' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Crea sponsor' }));
    expect(await within(form).findByText(/inizia con https:\/\//)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(within(form).getByLabelText(/Sito/), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Crea sponsor' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        url: '/api/admin/sponsors',
        body: { name: 'Nuovo', website: null },
      }),
    );
  });

  it('moves a sponsor, gives an image to a sponsor and shows why a deletion is refused', async () => {
    const calls = serve();
    renderAs('admin', <SponsorsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sposta su Autofficina' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        url: '/api/admin/sponsors/order',
        body: { ids: [S2, S1] },
      }),
    );
    fireEvent.change(await screen.findByRole('combobox', { name: 'Assegna a' }), { target: { value: S2 } });
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        url: `/api/admin/assets/${LOOSE}`,
        body: { sponsorId: S2 },
      }),
    );
    const bar = screen.getByRole('listitem', { name: 'Bar Centrale' });
    fireEvent.click(within(bar).getAllByRole('button', { name: 'Elimina' })[0] as HTMLElement);
    fireEvent.click(within(bar).getByRole('button', { name: 'Conferma eliminazione' }));
    expect(await screen.findByText(/Sponsor in uso nella pagina pubblica/)).toBeTruthy();
  });
});

describe('options of a sponsor block in the Studio', () => {
  const block = (options: object): LayoutBlock => LayoutBlockSchema.parse({ id: 'sp', type: 'sponsor', options });

  it('chooses sponsors, keeps the single images chosen before only to take them away, and links «Gestisci sponsor»', () => {
    const onChange = vi.fn();
    renderAs(
      'admin',
      <BlockOptionsEditor block={block({ images: [IMG] })} onChange={onChange} assets={ASSETS} sponsors={SPONSORS} />,
    );
    expect(screen.queryByLabelText(/Carica immagine sponsor/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Gestisci sponsor' }).getAttribute('href')).toBe('/admin/sponsor');
    fireEvent.click(screen.getByRole('checkbox', { name: /Autofficina · nessuna immagine/ }));
    const optionsOf = (): unknown => (onChange.mock.lastCall?.[0] as LayoutBlock | undefined)?.options;
    expect(optionsOf()).toMatchObject({ sponsors: [S2], images: [IMG] });
    expect(screen.getByRole('group', { name: 'Immagini singole' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Togli l’immagine singola 1 da Sponsor' }));
    expect(optionsOf()).toMatchObject({ images: [] });
  });
});
