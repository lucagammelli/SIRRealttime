import type { ClubFixture, ClubResponse, MatchSummary, ShareTokenSummary } from '@arenalive/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { fixedChoices, fixtureOptionText, ShareLinksPage } from './ShareLinksPage.tsx';

const NOW = Date.parse('2026-10-20T10:00:00.000Z');
const ids = (n: number) => `${n}f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c`;

const fixture = (n: number, over: Partial<ClubFixture> = {}): ClubFixture => ({
  id: ids(n),
  startsAt: '2026-10-25T17:00:00.000Z',
  officialStartsAt: '2026-10-25T17:00:00.000Z',
  dateOverridden: false,
  dateOverriddenAt: null,
  movedByLeague: false,
  home: { name: 'Sir Susa Scai Perugia', logoUrl: null },
  away: { name: 'Itas Trentino', logoUrl: null },
  ourSide: 'home',
  venue: null,
  venueCity: null,
  roundLabel: '1ª Giornata Andata',
  leagueName: 'Regular Season SuperLega',
  status: 'scheduled',
  result: null,
  inCalendar: true,
  league: null,
  origin: 'league',
  kind: null,
  broadcast: 'auto',
  broadcasted: true,
  hidden: false,
  logos: { our: null, opponent: null },
  state: 'scheduled',
  link: { id: ids(n), revoked: false, shortCode: 'K7M2QX9P', shortUrl: 'http://portale.test/l/K7M2QX9P' },
  match: null,
  ...over,
});

const match = (n: number, over: Partial<MatchSummary> = {}): MatchSummary => ({
  id: ids(n),
  matchKey: `partita-${n}`,
  live: false,
  lineCount: 10,
  version: 1,
  homeName: 'Sir Susa Scai Perugia_Amichevoli',
  awayName: 'SUNTORY',
  setsWon: null,
  status: 'finished',
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T12:00:00.000Z',
  ...over,
});

const club: ClubResponse = {
  name: 'Perugia',
  logoUrl: null,
  displayName: 'Perugia',
  logoMark: null,
  ourLogoSize: 'medium',
  ourTeam: { code: null, name: 'Perugia' },
  profile: {
    series: null,
    gender: null,
    seriesId: null,
    leagueId: null,
    leagueIds: [],
    newSeason: false,
    coverage: 'homeAndAway',
    teamLogos: 'all',
  },
  leagues: [],
  available: [],
};

const link = (n: number, over: Partial<ShareTokenSummary> = {}): ShareTokenSummary => ({
  id: ids(n),
  label: `Link ${n}`,
  matchId: null,
  clientFixtureId: null,
  expiresAt: null,
  revoked: false,
  createdAt: '2026-10-15T10:00:00.000Z',
  shortCode: 'K7M2QX9P',
  shortUrl: 'http://portale.test/l/K7M2QX9P',
  ...over,
});

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('choices of «Una partita fissa»', () => {
  it('writes the match with the name of the club, the day and the time', () => {
    expect(fixtureOptionText(fixture(1), 'Perugia')).toBe('Perugia – Itas Trentino · dom 25/10, 18:00');
    expect(fixtureOptionText(fixture(1, { ourSide: 'away', startsAt: null }), 'Perugia')).toBe(
      'Sir Susa Scai Perugia – Perugia · data da definire',
    );
  });

  it('offers the live match first, then the coming ones in order of time; nothing past, hidden or not broadcast', () => {
    const fixtures = [
      fixture(1, { startsAt: '2026-11-08T16:00:00.000Z' }),
      fixture(2, { startsAt: '2026-10-11T16:00:00.000Z', state: 'finished' }),
      fixture(3, { startsAt: '2026-10-19T16:00:00.000Z' }),
      fixture(4, { startsAt: '2026-11-01T16:00:00.000Z', hidden: true }),
      fixture(5, { startsAt: '2026-11-02T16:00:00.000Z', broadcasted: false }),
      fixture(6, { startsAt: '2026-10-26T19:30:00.000Z' }),
      fixture(7, { startsAt: '2026-10-20T08:00:00.000Z', state: 'live' }),
    ];
    const matches = [match(8), match(9, { live: true, status: 'inProgress', homeName: 'Perugia', awayName: 'Osaka' })];
    const keys = fixedChoices({ fixtures, matches, ourName: 'Perugia', now: NOW }).map((c) => [c.key, c.text]);
    expect(keys).toEqual([
      [`f:${ids(7)}`, 'In diretta: Perugia – Itas Trentino · mar 20/10, 10:00'],
      [`m:${ids(9)}`, 'In diretta: Perugia – Osaka'],
      [`f:${ids(6)}`, 'Perugia – Itas Trentino · lun 26/10, 20:30'],
      [`f:${ids(1)}`, 'Perugia – Itas Trentino · dom 08/11, 17:00'],
    ]);
  });
});

describe('«Link pubblici» page', () => {
  function serve(links: ShareTokenSummary[], fixtures: ClubFixture[], matches: MatchSummary[] = [match(8)]) {
    return mockApi(({ url, method }) => {
      if (url === '/api/admin/share-tokens' && method === 'GET') return { body: links };
      if (url === '/api/admin/matches') return { body: matches };
      if (url === '/api/admin/calendar') return { body: { fixtures, pending: [] } };
      if (url === '/api/admin/club') return { body: club };
      return { body: [] };
    });
  }

  it('shows the link a match of the calendar already has instead of creating another one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const calls = serve([], [fixture(1)]);
    renderAs('admin', <ShareLinksPage />, { matchLinks: true });
    fireEvent.click(await screen.findByRole('radio', { name: 'Una partita fissa' }));
    const select = await screen.findByRole('combobox', { name: 'Partita' });
    await within(select).findByRole('option', { name: 'Perugia – Itas Trentino · dom 25/10, 18:00' });
    // The old matches received from the agent are not offered.
    expect(within(select).queryByRole('option', { name: /SUNTORY/ })).toBeNull();
    fireEvent.change(select, { target: { value: `f:${ids(1)}` } });
    expect(screen.getByText('Questa partita ha già il suo link')).toBeTruthy();
    expect(screen.getByText('http://portale.test/l/K7M2QX9P')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copia link' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crea link' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('says so when the link of the match was revoked', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    serve([], [fixture(1, { link: { id: ids(1), revoked: true, shortCode: null, shortUrl: null } })]);
    renderAs('admin', <ShareLinksPage />, { matchLinks: true });
    fireEvent.click(await screen.findByRole('radio', { name: 'Una partita fissa' }));
    const select = await screen.findByRole('combobox', { name: 'Partita' });
    await within(select).findByRole('option', { name: /Itas Trentino/ });
    fireEvent.change(select, { target: { value: `f:${ids(1)}` } });
    expect(screen.getByText(/è stato revocato: non se ne crea un altro/)).toBeTruthy();
  });

  it('says the link is not ready yet when the match has none', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    serve([], [fixture(1, { link: null })]);
    renderAs('admin', <ShareLinksPage />, { matchLinks: true });
    fireEvent.click(await screen.findByRole('radio', { name: 'Una partita fissa' }));
    const select = await screen.findByRole('combobox', { name: 'Partita' });
    await within(select).findByRole('option', { name: /Itas Trentino/ });
    fireEvent.change(select, { target: { value: `f:${ids(1)}` } });
    expect(screen.getByText(/non è ancora pronto: si crea al prossimo aggiornamento del calendario/)).toBeTruthy();
    expect(screen.queryByText(/è stato revocato/)).toBeNull();
  });

  it('creates a fixed link on a match live outside the calendar', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const live = match(9, { live: true, status: 'inProgress', homeName: 'Perugia', awayName: 'Osaka' });
    const calls = mockApi(({ url, method }) => {
      if (url === '/api/admin/share-tokens' && method === 'POST')
        return {
          status: 201,
          body: {
            ...link(3, { matchId: live.id, label: 'Amichevole' }),
            token: 'x'.repeat(43),
            url: 'http://portale.test/live/x',
          },
        };
      if (url === '/api/admin/matches') return { body: [live] };
      if (url === '/api/admin/calendar') return { body: { fixtures: [], pending: [] } };
      if (url === '/api/admin/club') return { body: club };
      return { body: [] };
    });
    renderAs('admin', <ShareLinksPage />, { matchLinks: true });
    fireEvent.change(await screen.findByRole('textbox', { name: /Etichetta/ }), { target: { value: 'Amichevole' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Una partita fissa' }));
    const select = await screen.findByRole('combobox', { name: 'Partita' });
    await within(select).findByRole('option', { name: 'In diretta: Perugia – Osaka' });
    fireEvent.change(select, { target: { value: `m:${live.id}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea link' }));
    await screen.findByText(/copialo ora/);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Amichevole',
      matchId: live.id,
      expiresAt: null,
    });
  });

  it('offers only the channel without «Link e QR per singola partita», the revoked links of one match kept', async () => {
    const calls = serve(
      [
        link(1, { label: 'Canale' }),
        link(2, { label: 'Partita revocata', matchId: ids(7), revoked: true, shortCode: null, shortUrl: null }),
      ],
      [fixture(1)],
    );
    renderAs('admin', <ShareLinksPage />, { matchLinks: false });
    expect(await screen.findByText('Canale')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Una partita fissa' })).toBeNull();
    expect(screen.getByRole('radio', { name: /canale del club/ })).toBeTruthy();
    expect(screen.getByText(/Link per singola partita non attivi: usa il canale del club/)).toBeTruthy();
    // The QR of the channel stays.
    expect(await screen.findByRole('button', { name: 'Scarica QR (PNG)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostra revocati (1)' }));
    expect(screen.getByText('Partita revocata')).toBeTruthy();
    // No calendar asked for: «Una partita fissa» is not offered.
    expect(calls.some((c) => c.url === '/api/admin/calendar')).toBe(false);
  });

  it('hides the revoked links behind «Mostra revocati (N)»', async () => {
    serve(
      [link(1, { label: 'Tribuna' }), link(2, { label: 'Vecchio', revoked: true, shortCode: null, shortUrl: null })],
      [],
    );
    renderAs('admin', <ShareLinksPage />, { matchLinks: true });
    expect(await screen.findByText('Tribuna')).toBeTruthy();
    expect(screen.queryByText('Vecchio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostra revocati (1)' }));
    expect(screen.getByText('Vecchio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nascondi revocati (1)' }));
    expect(screen.queryByText('Vecchio')).toBeNull();
  });
});
