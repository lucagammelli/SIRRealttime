import type { CalendarResponse, ClubFixture } from '@sir/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminApp } from './AdminApp.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const LEAGUE = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const F1 = '9a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7d';
const F2 = '8b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7e';
const MATCH = '7c1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7f';

const fixture = (over: Partial<ClubFixture>): ClubFixture => ({
  id: F1,
  startsAt: '2026-10-18T16:00:00.000Z',
  officialStartsAt: '2026-10-18T16:00:00.000Z',
  dateOverridden: false,
  dateOverriddenAt: null,
  movedByLeague: false,
  home: { name: "Acqua Sant'Anna Cuneo", logoUrl: null },
  away: { name: 'Sir Susa Scai Perugia', logoUrl: null },
  ourSide: 'away',
  venue: 'Palasport di Cuneo',
  venueCity: 'Cuneo (CN)',
  roundLabel: '1ª Giornata Andata',
  leagueName: 'Regular Season SuperLega',
  status: 'scheduled',
  result: null,
  inCalendar: true,
  league: { id: LEAGUE, name: 'Regular Season SuperLega', season: 2026 },
  origin: 'league',
  kind: null,
  broadcast: 'auto',
  broadcasted: true,
  hidden: false,
  logos: { our: null, opponent: null },
  state: 'scheduled',
  link: { id: F1, revoked: false, shortCode: 'K7M2QX9P', shortUrl: 'http://portale.test/l/K7M2QX9P' },
  match: null,
  ...over,
});

const data: CalendarResponse = {
  fixtures: [
    fixture({}),
    fixture({
      id: F2,
      startsAt: '2026-10-25T17:00:00.000Z',
      home: { name: 'Sir Susa Scai Perugia', logoUrl: null },
      away: { name: 'Tinet Prata di Pordenone', logoUrl: null },
      ourSide: 'home',
      roundLabel: '2ª Giornata Andata',
      state: 'removed',
      inCalendar: false,
      link: { id: F2, revoked: false, shortCode: 'ABCD2345', shortUrl: 'http://portale.test/l/ABCD2345' },
    }),
  ],
  pending: [
    {
      id: MATCH,
      matchKey: 'perugia-suntory',
      live: true,
      homeName: 'Sir Susa Scai Perugia_Amichevoli',
      awayName: 'SUNTORY SUNBIRDS OSAKA',
      date: '2026-10-08',
      createdAt: '2026-10-08T16:00:00.000Z',
      candidates: [],
    },
  ],
};

/** Fake server; `matchLinks`: «Link e QR per singola partita» of the client of the admin. */
function mockServer(calendar: CalendarResponse = data, matchLinks = true) {
  const tenant = {
    id: '2b7e1c4d-9f3a-4e8b-a6d2-5c0f8e1b3a79',
    slug: 'club',
    name: 'Club',
    matchLinksEnabled: matchLinks,
  };
  const calls: { url: string; method: string; body: unknown }[] = [];
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      if (url === '/api/auth/me') return json({ id: USER_ID, email: 'a@b.it', role: 'admin', tenant });
      if (url === '/api/admin/calendar') return json(calendar);
      if (url.endsWith('/date')) return Promise.resolve(new Response(null, { status: 204 }));
      if (url === `/api/admin/matches/${MATCH}/fixture`) return Promise.resolve(new Response(null, { status: 204 }));
      return json([]);
    }),
  );
  return calls;
}

const renderCalendar = () =>
  render(
    <MemoryRouter initialEntries={['/admin/calendario']}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('page «Calendario»', () => {
  it('lists the matches of the club with date, teams, venue, state and link', async () => {
    mockServer();
    renderCalendar();
    const items = await screen.findAllByTestId('calendar-fixture');
    expect(items).toHaveLength(2);
    const first = items[0];
    if (!first) throw new Error('no item');
    expect(within(first).getByText(/dom 18 ott 2026/)).toBeTruthy();
    expect(within(first).getByText(/ore 18:00/)).toBeTruthy();
    expect(within(first).getByText('Palasport di Cuneo · Cuneo (CN)')).toBeTruthy();
    expect(within(first).getByText('Programmata')).toBeTruthy();
    expect(within(first).getByText('http://portale.test/l/K7M2QX9P')).toBeTruthy();
    expect(within(first).getByText('K7M2-QX9P')).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Copia link' })).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText('Non più in calendario')).toBeTruthy();
    fireEvent.click(within(first).getByRole('button', { name: 'Scarica QR' }));
    expect(await within(first).findByRole('button', { name: 'Scarica QR (PNG)' })).toBeTruthy();
  });

  it('shows no link nor QR of single matches without «Link e QR per singola partita»', async () => {
    mockServer(data, false);
    renderCalendar();
    const items = await screen.findAllByTestId('calendar-fixture');
    expect(items).toHaveLength(2);
    const first = items[0] as HTMLElement;
    expect(within(first).queryByText('http://portale.test/l/K7M2QX9P')).toBeNull();
    expect(within(first).queryByRole('button', { name: 'Copia link' })).toBeNull();
    expect(within(first).queryByRole('button', { name: 'Scarica QR' })).toBeNull();
    expect(screen.getByText(/Link per singola partita non attivi: usa il canale del club/)).toBeTruthy();
  });

  it('confirms a .dvw out of the calendar as «nessuna (amichevole)»', async () => {
    const calls = mockServer();
    renderCalendar();
    expect(await screen.findByRole('heading', { name: 'Da confermare' })).toBeTruthy();
    expect(screen.getByText(/nessuna partita del calendario corrisponde/)).toBeTruthy();
    const select = screen.getByRole('combobox', { name: /Partita del calendario di Sir Susa Scai Perugia_Amichevoli/ });
    expect((select as HTMLSelectElement).value).toBe('none');
    expect(within(select).getByRole('option', { name: /Tinet Prata di Pordenone \(in casa\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/matches/${MATCH}/fixture`,
        method: 'PUT',
        body: { clientFixtureId: null },
      }),
    );
  });

  it('marks a date changed by hand: label, official date struck through, warning of the league, button', async () => {
    const changed = fixture({
      startsAt: '2026-10-19T17:30:00.000Z',
      officialStartsAt: '2026-10-25T16:00:00.000Z',
      dateOverridden: true,
      dateOverriddenAt: '2026-10-10T10:00:00.000Z',
      movedByLeague: true,
    });
    const calls = mockServer({ ...data, fixtures: [changed, fixture({ id: F2 })] });
    renderCalendar();
    const items = await screen.findAllByTestId('calendar-fixture');
    const [first, second] = items;
    if (!first || !second) throw new Error('no item');
    expect(within(first).getByText(/lun 19 ott 2026/)).toBeTruthy();
    expect(within(first).getByText(/ore 19:30/)).toBeTruthy();
    expect(within(first).getByText('Modificata a mano')).toBeTruthy();
    const official = within(first).getByTestId('official-date');
    expect(official.tagName).toBe('S');
    expect(official.textContent).toMatch(/dom 25 ott 2026 · ore 17:00/);
    expect(within(first).getByTestId('moved-by-league').textContent).toMatch(
      /La Lega ha spostato la partita al dom 25 ott 2026 · ore 17:00/,
    );
    expect(within(second).queryByText('Modificata a mano')).toBeNull();
    expect(within(second).queryByTestId('moved-by-league')).toBeNull();
    expect(within(second).queryByRole('button', { name: 'Torna alla data ufficiale' })).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: 'Torna alla data ufficiale' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/calendar/fixtures/${F1}/date`,
        method: 'PUT',
        body: { startsAt: null },
      }),
    );
  });

  it('changes the date of a downloaded match in Italian time', async () => {
    const calls = mockServer();
    renderCalendar();
    const [first] = await screen.findAllByTestId('calendar-fixture');
    if (!first) throw new Error('no item');
    fireEvent.click(within(first).getByRole('button', { name: 'Cambia data e ora' }));
    fireEvent.change(within(first).getByLabelText('Data (ora italiana)'), { target: { value: '2026-11-02' } });
    fireEvent.change(within(first).getByLabelText('Ora (ora italiana)'), { target: { value: '20:30' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Salva data e ora' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/calendar/fixtures/${F1}/date`,
        method: 'PUT',
        // 20:30 in Rome on 2 November (CET, UTC+1).
        body: { startsAt: '2026-11-02T19:30:00.000Z' },
      }),
    );
  });
});
