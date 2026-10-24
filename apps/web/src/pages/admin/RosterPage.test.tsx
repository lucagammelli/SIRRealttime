import type { AssetListResponse, AssetSummary, ImportRosterResponse, Player, RosterResponse } from '@arenalive/shared';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { importSummary, photoProgressText, requestOf, ROSTER_POLL_MS, RosterPage } from './RosterPage.tsx';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PHOTO = id(101);
const CLIP = id(102);
const SHOT = id(103);

const item = (assetId: string, video = false, name: string | null = null) => ({
  assetId,
  url: `/api/admin/assets/${assetId}/file`,
  video,
  name,
});

const player = (n: number, over: Partial<Player> = {}): Player => ({
  id: id(n),
  season: 2026,
  number: n,
  firstName: 'Mario',
  lastName: `Cognome${n}`,
  role: 'outside',
  birthYear: 1998,
  heightCm: 195,
  birthplace: null,
  nationality: 'ITA',
  source: 'league',
  externalKey: `KEY-${n}`,
  editedFields: [],
  photo: null,
  media: [],
  removed: false,
  position: n,
  ...over,
});

const idle = { running: false, photosDone: 0, photosTotal: 0, lastAt: null, lastError: null };
const rosterOf = (players: Player[], over: Partial<RosterResponse> = {}): RosterResponse => ({
  season: 2026,
  seasons: [2026],
  team: { id: id(900), name: 'Sir Susa Scai Perugia' },
  players,
  import: idle,
  ...over,
});

const file = (fid: string, name: string, mime: AssetSummary['mime'], kind: AssetSummary['kind'] = 'player') => ({
  id: fid,
  kind,
  mime,
  width: 640,
  height: 480,
  bytes: 1000,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-15T10:00:00.000Z',
  url: `/api/admin/assets/${fid}/file`,
  sponsorId: null,
  name,
});
const LIBRARY: AssetListResponse = {
  assets: [
    file(PHOTO, 'Rossi in posa', 'image/jpeg'),
    file(SHOT, 'Rossi in schiacciata', 'image/jpeg'),
    file(CLIP, 'Rossi muro', 'video/mp4'),
    file(id(104), 'Logo', 'image/png', 'logo'),
  ],
  usedBytes: 4000,
  quotaBytes: 50 * 1024 * 1024,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pure helpers', () => {
  it('summary and progress texts', () => {
    expect(importSummary({ added: 3, updated: 1, unchanged: 8 })).toBe('Aggiunti 3, aggiornati 1, invariati 8.');
    expect(photoProgressText({ ...idle, running: true, photosDone: 3, photosTotal: 12 })).toBe(
      'Foto scaricate: 3 di 12',
    );
    expect(photoProgressText(idle)).toBeNull();
  });

  it('the form fields become the request: empty is null, a role is checked', () => {
    expect(
      requestOf({
        number: '7',
        lastName: 'Rossi',
        firstName: 'Mario',
        role: 'libero',
        birthYear: '',
        heightCm: '190',
        birthplace: ' ',
        nationality: 'ita',
      }),
    ).toMatchObject({
      number: 7,
      role: 'libero',
      birthYear: null,
      heightCm: 190,
      birthplace: null,
      nationality: 'ita',
    });
    expect(
      requestOf({
        number: '',
        lastName: '',
        firstName: '',
        role: 'boh',
        birthYear: '',
        heightCm: '',
        birthplace: '',
        nationality: '',
      }),
    ).toMatchObject({ role: null });
  });
});

describe('page «Squadra»', () => {
  it('shows a loading state, then the table with the fields changed by hand marked', async () => {
    mockApi(() => ({
      body: rosterOf([
        player(8, { lastName: 'Rossi', editedFields: ['heightCm', 'photo'], photo: item(PHOTO) }),
        player(3, { role: null, heightCm: null, nationality: null }),
      ]),
    }));
    renderAs('admin', <RosterPage />);
    expect(screen.getByText('Caricamento della squadra…')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Giocatori della squadra' });
    expect(document.title).toBe('Squadra · Area riservata');
    const rossi = within(table).getByText('Rossi').closest('tr') as HTMLElement;
    expect(rossi.textContent).toContain('195 cm');
    expect(rossi.textContent).toContain('Schiacciatore');
    expect(within(rossi).getAllByText('(modificato a mano)')).toHaveLength(2);
    expect(rossi.querySelector('img')?.getAttribute('src')).toBe(`/api/admin/assets/${PHOTO}/file`);
    expect(rossi.querySelectorAll('img')).toHaveLength(1);
    const other = within(table).getByText('Cognome3').closest('tr') as HTMLElement;
    expect(within(other).queryByText('(modificato a mano)')).toBeNull();
    expect(screen.getByText('Stagione 2026/2027')).toBeTruthy();
  });

  it('shows small thumbnails of the photos and videos of each player, «Nessuno» when there are none', async () => {
    mockApi(() => ({
      body: rosterOf([
        player(8, {
          lastName: 'Rossi',
          photo: item(PHOTO, false, 'Rossi in posa'),
          media: [item(SHOT, false, 'Rossi in schiacciata'), item(CLIP, true, 'Rossi muro')],
        }),
        player(3),
      ]),
    }));
    renderAs('viewer', <RosterPage />);
    const table = await screen.findByRole('table', { name: 'Giocatori della squadra' });
    const rossi = within(table).getByText('Rossi').closest('tr') as HTMLElement;
    const main = within(rossi).getByAltText('Foto principale di Rossi Mario: Rossi in posa');
    expect(main.getAttribute('loading')).toBe('lazy');
    expect(main.className).toContain('ring-primary');
    expect(main.className).toContain('size-10');
    expect(rossi.querySelectorAll('img')).toHaveLength(2);
    expect(main.parentElement?.getAttribute('title')).toBe('Foto principale: Rossi in posa');
    const other = within(rossi).getByAltText('Foto di Rossi Mario: Rossi in schiacciata');
    expect(other.className).not.toContain('ring-primary');
    const video = rossi.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('aria-label')).toBe('Video di Rossi Mario: Rossi muro');
    expect(video.parentElement?.getAttribute('title')).toBe('Rossi muro');
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.getAttribute('preload')).toBe('metadata');
    const empty = within(table).getByText('Cognome3').closest('tr') as HTMLElement;
    expect(within(empty).getByText('Nessuno')).toBeTruthy();
  });

  it('the form opens in a side panel (dialog) and closes with Esc, a click outside or «Annulla», focus back', async () => {
    mockApi(() => ({ body: rosterOf([player(8, { lastName: 'Rossi' })]) }));
    renderAs('admin', <RosterPage />);
    const opener = await screen.findByRole('button', { name: 'Modifica Rossi Mario' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Modifica Rossi Mario' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Numero'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi giocatore' }));
    expect(screen.getByRole('dialog', { name: 'Aggiungi giocatore' })).toBeTruthy();
  });

  it('Tab stays inside the side panel', async () => {
    mockApi(() => ({ body: rosterOf([player(8, { lastName: 'Rossi' })]) }));
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica Rossi Mario' }));
    const cancel = screen.getByRole('button', { name: 'Annulla' });
    cancel.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chiudi' }));
  });

  it('an error of the server is shown in Italian, with «Riprova»', async () => {
    mockApi(() => ({ status: 500, body: { error: 'Errore' } }));
    renderAs('admin', <RosterPage />);
    expect(await screen.findByText(/Errore del server/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it('imports from the site of the league and shows the result, the skipped and those no longer on the site', async () => {
    const result: ImportRosterResponse = {
      season: 2026,
      added: 2,
      updated: 1,
      unchanged: 9,
      skipped: [{ number: 55, name: 'Bianchi Luca', reason: 'numero già usato' }],
      notOnSite: [{ id: id(3), number: 3, name: 'Cognome3 Mario' }],
      photosQueued: 4,
    };
    const calls = mockApi((call) => {
      if (call.url === '/api/admin/roster/import') return { body: result };
      if (call.url.startsWith('/api/admin/roster')) return { body: rosterOf([player(3)]) };
      return { body: LIBRARY };
    });
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Importa dal sito della Lega' }));
    expect(await screen.findByText('Aggiunti 2, aggiornati 1, invariati 9.')).toBeTruthy();
    expect(screen.getByText('55 Bianchi Luca: numero già usato')).toBeTruthy();
    expect(screen.getByText('3 Cognome3 Mario')).toBeTruthy();
    expect(screen.getByText('Foto da scaricare: 4.')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/admin/roster/import' && c.method === 'POST')).toBe(true);
    // The row says it too.
    const row = screen.getByText('Cognome3').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('Non più sul sito');
  });

  it('a refused import shows the explanation of the server; without the team of the club the button is off', async () => {
    mockApi((call) =>
      call.url === '/api/admin/roster/import'
        ? { status: 502, body: { error: 'Il sito della Lega non risponde: riprova tra poco' } }
        : { body: rosterOf([]) },
    );
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Importa dal sito della Lega' }));
    expect(await screen.findByText(/Il sito della Lega non risponde/)).toBeTruthy();
    cleanup();
    mockApi(() => ({ body: rosterOf([], { team: null }) }));
    renderAs('admin', <RosterPage />);
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Importa dal sito della Lega' });
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Club' }).getAttribute('href')).toBe('/admin/club');
    expect(
      screen.getByText('Nessun giocatore in squadra. Importali dal sito della Lega o aggiungili a mano.'),
    ).toBeTruthy();
  });

  it('while the photos are downloaded it shows the progress and asks again until they are done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: RosterResponse['import'] = { ...idle, running: true, photosDone: 1, photosTotal: 3 };
    const calls = mockApi(() => ({ body: rosterOf([player(8)], { import: state }) }));
    renderAs('admin', <RosterPage />);
    expect(await screen.findByText('Foto scaricate: 1 di 3')).toBeTruthy();
    state = { ...idle, running: true, photosDone: 2, photosTotal: 3 };
    await act(() => vi.advanceTimersByTimeAsync(ROSTER_POLL_MS + 50));
    expect(await screen.findByText('Foto scaricate: 2 di 3')).toBeTruthy();
    state = { ...idle, lastAt: '2026-10-20T10:00:00.000Z' };
    await act(() => vi.advanceTimersByTimeAsync(ROSTER_POLL_MS + 50));
    await waitFor(() => expect(screen.queryByText(/Foto scaricate/)).toBeNull());
    const count = calls.length;
    await act(() => vi.advanceTimersByTimeAsync(ROSTER_POLL_MS * 3));
    expect(calls.length).toBe(count);
  });

  it('edits a player: sends only the changed fields; a wrong value is refused before sending', async () => {
    const calls = mockApi((call) => {
      if (call.method === 'PATCH')
        return { body: player(8, { lastName: 'Rossi', heightCm: 200, editedFields: ['heightCm'] }) };
      return { body: rosterOf([player(8, { lastName: 'Rossi' })]) };
    });
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica Rossi Mario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva giocatore' }));
    expect(await screen.findByText('Nessuna modifica da salvare.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Altezza (cm)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva giocatore' }));
    expect(await screen.findByText(/Dati non validi/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.change(screen.getByLabelText('Altezza (cm)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva giocatore' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ heightCm: 200 }));
    expect(calls.find((c) => c.method === 'PATCH')?.url).toBe(`/api/admin/roster/players/${id(8)}`);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salva giocatore' })).toBeNull());
  });

  it('adds a player by hand; the server refuses a number already used', async () => {
    let taken = true;
    const calls = mockApi((call) => {
      if (call.method === 'POST')
        return taken
          ? { status: 409, body: { error: 'Il numero 9 è già di un altro giocatore della rosa' } }
          : { status: 201, body: player(9, { source: 'manual' }) };
      return { body: rosterOf([player(8)]) };
    });
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiungi giocatore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(await screen.findByText(/Dati non validi/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Numero'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Cognome'), { target: { value: 'Bianchi' } });
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Luca' } });
    fireEvent.change(screen.getByLabelText('Ruolo'), { target: { value: 'libero' } });
    fireEvent.change(screen.getByLabelText(/^Nazionalità/), { target: { value: 'ita' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(await screen.findByText(/Il numero 9 è già di un altro giocatore/)).toBeTruthy();
    taken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toMatchObject({
      number: 9,
      lastName: 'Bianchi',
      firstName: 'Luca',
      role: 'libero',
      nationality: 'ITA',
      birthYear: null,
    });
  });

  it('removes with a confirmation, shows the removed ones on request and puts them back', async () => {
    const calls = mockApi((call) => {
      if (call.method === 'DELETE') return null;
      if (call.method === 'PATCH') return { body: player(3) };
      return { body: rosterOf([player(8, { lastName: 'Rossi' }), player(3, { removed: true })]) };
    });
    renderAs('admin', <RosterPage />);
    await screen.findByText('Rossi');
    expect(screen.queryByText('Cognome3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi Rossi Mario' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Conferma rimozione' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(`/api/admin/roster/players/${id(8)}`),
    );
    fireEvent.click(screen.getByLabelText('Mostra rimossi (1)'));
    const row = screen.getByText('Cognome3').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('Rimosso');
    fireEvent.click(within(row).getByRole('button', { name: 'Ripristina Cognome3 Mario' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ removed: false }));
  });

  it('«Foto e video»: chooses only among the files for the players of the library and saves', async () => {
    const calls = mockApi((call) => {
      if (call.method === 'PUT') return { body: player(8) };
      if (call.url === '/api/admin/assets') return { body: LIBRARY };
      return { body: rosterOf([player(8, { lastName: 'Rossi' })]) };
    });
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Foto e video di Rossi Mario' }));
    expect(await screen.findByRole('link', { name: 'Carica nella libreria' })).toBeTruthy();
    const main = screen.getByLabelText<HTMLSelectElement>(/^Foto principale/);
    // Only files for the players: the logo is not offered; the video is not a main photo.
    expect([...main.options].map((o) => o.textContent)).toEqual(['Nessuna', 'Rossi in posa', 'Rossi in schiacciata']);
    expect(screen.queryByText('Logo')).toBeNull();
    fireEvent.change(main, { target: { value: PHOTO } });
    fireEvent.click(screen.getByLabelText('Video: Rossi muro'));
    fireEvent.click(screen.getByLabelText('Foto: Rossi in schiacciata'));
    fireEvent.click(screen.getByRole('button', { name: 'Salva foto e video' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ photoAssetId: PHOTO, mediaIds: [CLIP, SHOT] }),
    );
    expect(calls.find((c) => c.method === 'PUT')?.url).toBe(`/api/admin/roster/players/${id(8)}/media`);
  });

  it('«Foto e video» without files in the library points to the library', async () => {
    mockApi((call) =>
      call.url === '/api/admin/assets' ? { body: { ...LIBRARY, assets: [] } } : { body: rosterOf([player(8)]) },
    );
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^Foto e video di/ }));
    expect(await screen.findByText('Nessun file per i giocatori nella libreria.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Carica nella libreria' }).getAttribute('href')).toBe('/admin/media');
  });

  it('the main photo in use and the other files keep what is already chosen', async () => {
    mockApi((call) => {
      if (call.url === '/api/admin/assets') return { body: LIBRARY };
      return { body: rosterOf([player(8, { lastName: 'Rossi', photo: item(PHOTO), media: [item(CLIP, true)] })]) };
    });
    renderAs('admin', <RosterPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Foto e video di Rossi Mario' }));
    expect((await screen.findByLabelText<HTMLSelectElement>(/^Foto principale/)).value).toBe(PHOTO);
    expect(screen.getByLabelText<HTMLInputElement>('Video: Rossi muro').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Foto: Rossi in schiacciata').checked).toBe(false);
  });

  it('a viewer reads the roster: no import, no forms, no commands', async () => {
    mockApi(() => ({ body: rosterOf([player(8, { lastName: 'Rossi' })]) }));
    renderAs('viewer', <RosterPage />);
    await screen.findByText('Rossi');
    expect(screen.getByText(/Sola lettura/)).toBeTruthy();
    for (const name of [/Importa/, /Aggiungi giocatore/, /^Modifica/, /^Rimuovi/, /^Foto e video/])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
