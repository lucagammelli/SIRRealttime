import type { ClubResponse, ClubTeamsResponse } from '@sir/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminApp } from './AdminApp.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const LEAGUE = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const PERUGIA = '9a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7d';
const CUNEO = '8b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7e';

const option = {
  id: LEAGUE,
  externalId: 999,
  season: 2026,
  name: 'Regular Season SuperLega',
  teamCount: 12,
  sync: { status: 'ok' as const, message: null, at: null, lastSuccessAt: '2026-10-16T10:00:00.000Z', running: false },
};

const club = (over: Partial<ClubResponse> = {}): ClubResponse => ({
  name: 'Sir Safety Perugia',
  logoUrl: null,
  ourTeam: { code: null, name: null },
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
      if (url === '/api/auth/me') return json({ id: USER_ID, email: 'a@b.it', role, tenant: null });
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

  it('starts the update of the calendar of the club', async () => {
    const calls = mockServer('admin', club({ leagues: [{ league: option, team: teams.teams[1] ?? null }] }));
    renderClub();
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiorna calendario' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/club/sync' && c.method === 'POST')).toBe(true));
    expect(await screen.findByText(/Aggiornamento avviato/)).toBeTruthy();
  });

  it('lets the superadmin add a championship of the Lega by IdCampionato', async () => {
    mockServer('superadmin', club({ available: [] }));
    renderClub();
    expect(await screen.findByRole('heading', { name: 'Nuovo campionato della Lega' })).toBeTruthy();
    expect(screen.getByText(/Nessun campionato disponibile/)).toBeTruthy();
  });
});
