import type { ClubResponse, ClubTeamsResponse } from '@arenalive/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminApp } from './AdminApp.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const LEAGUE = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const PERUGIA = '9a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7d';
const CUNEO = '8b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7e';
const CUP = '7c1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7f';
const NEVER = { status: 'never' as const, message: null, at: null, lastSuccessAt: null, running: true };

const option = {
  id: LEAGUE,
  externalId: 999,
  season: 2026,
  name: 'Regular Season SuperLega',
  teamCount: 12,
  sync: { status: 'ok' as const, message: null, at: null, lastSuccessAt: '2026-10-16T10:00:00.000Z', running: false },
};

const cupOption = { ...option, id: CUP, externalId: 1010, name: 'Coppa Italia SuperLega', teamCount: 0, sync: NEVER };

const club = (over: Partial<ClubResponse> = {}): ClubResponse => ({
  name: 'Sir Safety Perugia',
  logoUrl: null,
  displayName: null,
  logoMark: null,
  ourTeam: { code: null, name: null },
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
  available: [option],
  ...over,
});

const teams: ClubTeamsResponse = {
  teams: [
    { id: CUNEO, name: "Acqua Sant'Anna Cuneo", city: null, logoUrl: null },
    { id: PERUGIA, name: 'Sir Susa Scai Perugia', city: 'Perugia (PG)', logoUrl: null },
  ],
};

function mockServer(role: 'admin' | 'superadmin', initial: ClubResponse) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      // A superadmin works on the club of the client it has entered.
      const tenant = role === 'superadmin' ? { id: USER_ID, slug: 'sir', name: 'Sir' } : null;
      if (url === '/api/auth/me') return json({ id: USER_ID, email: 'a@b.it', role, tenant });
      if (url === '/api/admin/club' && method === 'GET') return json(initial);
      if (url === '/api/admin/club' && method === 'PUT')
        return json(
          club({
            ourTeam: { code: null, name: 'Perugia' },
            leagues: [{ league: option, team: teams.teams[1] ?? null }],
          }),
        );
      if (url === `/api/admin/club/leagues/${LEAGUE}/teams`) return json(teams);
      if (url === '/api/admin/club/sync') return json({ started: 1, busy: 0 }, 202);
      if (url === '/api/admin/club/competitions' && method === 'GET')
        return json({
          competitions: [
            { externalId: 1004, name: 'Supercoppa A1', season: 2026 },
            { externalId: 1010, name: 'Coppa Italia SuperLega', season: 2026 },
          ],
        });
      if (url === '/api/admin/club/competitions' && method === 'POST')
        return json(
          {
            ...initial,
            leagues: [...initial.leagues, { league: cupOption, team: null }],
            available: [...initial.available, cupOption],
          },
          201,
        );
      if (url === '/api/admin/club/profile') return json(initial);
      if (url === '/api/admin/club/league')
        return json(
          {
            state: 'ready',
            message: null,
            gender: 'M',
            series: 'superlega',
            leagueId: LEAGUE,
            leagueName: 'Regular Season SuperLega',
            season: 2026,
            teams: teams.teams.map((t) => ({ ...t, leagueId: LEAGUE })),
            teamId: null,
          },
          method === 'POST' ? 200 : 200,
        );
      return json([]);
    }),
  );
  return calls;
}

const renderClub = () =>
  render(
    <MemoryRouter initialEntries={['/admin/club']}>
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

describe('page «Club»', () => {
  it('chooses the championship and the team of the club and saves them', async () => {
    const calls = mockServer('admin', club());
    renderClub();
    expect(await screen.findByText('Sir Safety Perugia')).toBeTruthy();
    expect(screen.getByText(/non impostata: si imposta da sola/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi campionato' }));
    const league = screen.getByRole('combobox', { name: 'Campionato' });
    expect(within(league).getByRole('option', { name: 'Regular Season SuperLega 2026/2027' })).toBeTruthy();
    const team = await screen.findByRole('combobox', { name: 'Squadra del club' });
    await within(team).findByRole('option', { name: 'Sir Susa Scai Perugia (Perugia (PG))' });
    fireEvent.change(team, { target: { value: PERUGIA } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/admin/club',
        method: 'PUT',
        body: { leagues: [{ leagueId: LEAGUE, teamId: PERUGIA }] },
      }),
    );
    expect(await screen.findByText(/Campionati salvati/)).toBeTruthy();
    expect(screen.getByText(/nome che contiene «Perugia»/)).toBeTruthy();
    // No form to add championships for an admin of the client.
    expect(screen.queryByRole('heading', { name: 'Nuovo campionato della Lega' })).toBeNull();
  });

  it('adds a competition of the series from the site: the team is chosen by the server, a missing one is said', async () => {
    const withSeries = club({
      profile: {
        ...club().profile,
        series: 'SuperLega',
        gender: 'M',
        seriesId: 'superlega',
        leagueId: LEAGUE,
        leagueIds: [LEAGUE],
      },
      leagues: [{ league: option, team: teams.teams[1] ?? null }],
    });
    const calls = mockServer('admin', withSeries);
    renderClub();
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiungi competizione' }));
    const select = await screen.findByRole('combobox', { name: 'Competizione da aggiungere' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Supercoppa A1 2026/2027', 'Coppa Italia SuperLega 2026/2027']);
    fireEvent.change(select, { target: { value: '1010' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: '/api/admin/club/competitions', method: 'POST', body: { externalId: 1010 } }),
    );
    // The new competition is in the list, still downloading: the team comes by itself, without it no match.
    expect(await screen.findByText(/Scaricamento in corso: la squadra del club si sceglie da sola/)).toBeTruthy();
    expect(screen.getAllByRole('combobox', { name: 'Campionato' })).toHaveLength(2);
  });

  it('says that a championship without team brings no match, and asks to save before adding a competition', async () => {
    const withSeries = club({
      profile: {
        ...club().profile,
        series: 'SuperLega',
        gender: 'M',
        seriesId: 'superlega',
        leagueId: LEAGUE,
        leagueIds: [LEAGUE],
      },
      leagues: [{ league: option, team: teams.teams[1] ?? null }],
    });
    mockServer('admin', withSeries);
    renderClub();
    const team = await screen.findByRole('combobox', { name: 'Squadra del club' });
    await within(team).findByRole('option', { name: 'Sir Susa Scai Perugia (Perugia (PG))' });
    fireEvent.change(team, { target: { value: '' } });
    expect(screen.getByText('Senza squadra non arriva nessuna partita: scegli la squadra del club.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Un campionato è senza squadra');
    expect(screen.getByRole('button', { name: 'Aggiungi competizione' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Salva prima le modifiche ai campionati.')).toBeTruthy();
  });

  it('starts the update of the calendar of the club', async () => {
    const calls = mockServer('admin', club({ leagues: [{ league: option, team: teams.teams[1] ?? null }] }));
    renderClub();
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiorna calendario' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/club/sync' && c.method === 'POST')).toBe(true));
    expect(await screen.findByText(/Aggiornamento avviato/)).toBeTruthy();
  });

  it('links «Colori e loghi» of the Studio grafico', async () => {
    mockServer('admin', club());
    renderClub();
    const link = await screen.findByRole('link', { name: 'Apri «Colori e loghi»' });
    expect(link.getAttribute('href')).toBe('/admin/studio/colori');
  });

  it('sends the superadmin to «Campionati» to add a championship of the Lega', async () => {
    mockServer('superadmin', club({ available: [] }));
    renderClub();
    expect(await screen.findByText(/Nessun campionato disponibile/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Aggiungilo in «Campionati».' }).getAttribute('href')).toBe(
      '/admin/campionati',
    );
    expect(screen.queryByRole('heading', { name: 'Nuovo campionato della Lega' })).toBeNull();
  });

  it('saves the profile: name, logo, «nostra squadra», coverage and team logos', async () => {
    const calls = mockServer('admin', club());
    renderClub();
    fireEvent.change(await screen.findByLabelText(/^Nome\s*Vuoto/), { target: { value: 'Sir Perugia' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Solo partite in casa' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Solo il mio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salva profilo' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/admin/club/profile',
        method: 'PUT',
        body: {
          displayName: 'Sir Perugia',
          logoMark: null,
          ourTeam: { code: null, name: null },
          profile: { coverage: 'homeOnly', teamLogos: 'ours' },
        },
      }),
    );
  });

  it('chooses gender and series from the catalog: the female gender is not available, the choice links the championship', async () => {
    const calls = mockServer('admin', club());
    renderClub();
    const gender = await screen.findByRole('combobox', { name: /^Genere/ });
    expect(
      within(gender).getByRole('option', { name: 'Femminile (presto disponibile)' }).hasAttribute('disabled'),
    ).toBe(true);
    expect((gender as HTMLSelectElement).value).toBe('M');
    const series = screen.getByRole('combobox', { name: /^Serie/ });
    expect(
      within(series)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Scegli la serie', 'SuperLega', 'Serie A2', 'Serie A3']);
    fireEvent.change(series, { target: { value: 'a2' } });
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/admin/club/league',
        method: 'POST',
        body: { gender: 'M', series: 'a2' },
      }),
    );
    // The club is read again: the list of championships starts from the new one.
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/admin/club' && c.method === 'GET').length).toBe(2));
  });

  it('shows the download error of the series', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((u: string, init?: RequestInit) => {
        if (u === '/api/auth/me')
          return Promise.resolve(
            new Response(JSON.stringify({ id: USER_ID, email: 'a@b.it', role: 'admin', tenant: null })),
          );
        if (u === '/api/admin/club/league' && init?.method === 'POST')
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'La pagina del calendario della Lega è cambiata' }), { status: 502 }),
          );
        return Promise.resolve(new Response(JSON.stringify(club())));
      }),
    );
    renderClub();
    fireEvent.change(await screen.findByRole('combobox', { name: /^Serie/ }), { target: { value: 'superlega' } });
    expect(await screen.findByText(/La pagina del calendario della Lega è cambiata/)).toBeTruthy();
  });
});
