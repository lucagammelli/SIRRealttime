import type {
  AgentSummary,
  CalendarResponse,
  ClubFixture,
  ClubResponse,
  LeagueSummary,
  ShareTokenSummary,
} from '@sir/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { AgentsPage, validityEnd, validityText } from './AgentsPage.tsx';
import { CalendarPage } from './CalendarPage.tsx';
import { ClubPage } from './ClubPage.tsx';
import { LeaguesPage, leaguePlanText } from './LeaguesPage.tsx';
import { ShareLinksPage } from './ShareLinksPage.tsx';

const LEAGUE = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const F1 = '9a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7d';
const F2 = '8b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7e';
const AGENT = '7c1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7f';
const REG = '6d1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b70';

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
  venue: null,
  venueCity: null,
  roundLabel: '1ª Giornata Andata',
  leagueName: 'Regular Season SuperLega',
  status: 'scheduled',
  result: null,
  inCalendar: true,
  league: { id: LEAGUE, name: 'Regular Season SuperLega', season: 2026 },
  origin: 'league',
  kind: null,
  broadcast: 'auto',
  broadcasted: false,
  hidden: false,
  logos: { our: null, opponent: null },
  state: 'scheduled',
  link: { id: F1, revoked: false, shortCode: 'K7M2QX9P', shortUrl: 'http://portale.test/l/K7M2QX9P' },
  match: null,
  ...over,
});

const calendar: CalendarResponse = {
  fixtures: [
    fixture({}),
    fixture({
      id: F2,
      startsAt: '2026-10-12T16:00:00.000Z',
      home: { name: 'Sir Susa Scai Perugia', logoUrl: null },
      away: { name: 'Suntory Sunbirds', logoUrl: null },
      ourSide: 'home',
      roundLabel: 'Amichevole',
      league: null,
      leagueName: null,
      origin: 'manual',
      kind: 'friendly',
      broadcasted: true,
      link: { id: F2, revoked: false, shortCode: 'ABCD2345', shortUrl: 'http://portale.test/l/ABCD2345' },
    }),
  ],
  pending: [],
};

const club: ClubResponse = {
  name: 'Sir Safety Perugia',
  logoUrl: null,
  displayName: null,
  logoMark: null,
  ourTeam: { code: null, name: 'Perugia' },
  profile: {
    series: null,
    gender: null,
    seriesId: null,
    leagueId: null,
    leagueIds: [],
    newSeason: false,
    coverage: 'homeOnly',
    teamLogos: 'all',
  },
  leagues: [],
  available: [],
};

const agent: AgentSummary = {
  id: AGENT,
  name: 'PC scout',
  revoked: false,
  lastSeenAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  expiresAt: '2026-10-20T21:59:59.000Z',
};

const league: LeagueSummary = {
  id: LEAGUE,
  provider: 'legavolley',
  externalId: 999,
  season: 2026,
  name: 'Regular Season SuperLega',
  phases: [],
  teamCount: 12,
  fixtureCount: 132,
  sync: { status: 'ok', message: null, at: null, lastSuccessAt: '2026-10-17T02:00:00.000Z', running: false },
  createdAt: '2026-10-01T10:00:00.000Z',
  plan: { nextSyncAt: '2026-10-18T02:00:00.000Z', matchToday: false },
};

const channel: ShareTokenSummary = {
  id: F1,
  label: 'Maxischermo',
  matchId: null,
  clientFixtureId: null,
  expiresAt: null,
  revoked: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  shortCode: 'K7M2QX9P',
  shortUrl: 'http://portale.test/l/K7M2QX9P',
};

function api() {
  return mockApi(({ url, method }) => {
    if (url === '/api/admin/calendar') return { body: calendar };
    if (url === '/api/admin/club' || url === '/api/admin/club/profile') return { body: club };
    if (url === '/api/admin/agents' && method === 'GET') return { body: [agent] };
    if (url === '/api/admin/agent-quota') return { body: { quota: 2, used: 1 } };
    if (url === '/api/admin/agent-registrations')
      return {
        body: [
          {
            id: REG,
            name: 'PC nuovo',
            pairingCode: 'K7M2QX',
            ip: null,
            createdAt: '2026-10-17T10:00:00.000Z',
            expiresAt: '2026-10-18T10:00:00.000Z',
            status: 'pending',
          },
        ],
      };
    if (url.endsWith('/approve'))
      return {
        body: {
          id: REG,
          name: 'PC nuovo',
          pairingCode: 'K7M2QX',
          ip: null,
          createdAt: '2026-10-17T10:00:00.000Z',
          expiresAt: '2026-10-18T10:00:00.000Z',
          status: 'approved',
        },
      };
    if (url === `/api/admin/agents/${AGENT}` && method === 'PATCH') return { body: { ...agent, expiresAt: null } };
    if (url === '/api/admin/agent/info') return { body: { available: false } };
    if (url === '/api/admin/share-tokens') return { body: [channel] };
    if (url === '/api/admin/leagues') return { body: { leagues: [league] } };
    if (url === `/api/admin/leagues/${LEAGUE}/sync`) return { body: league, status: 202 };
    if (url === '/api/admin/calendar/fixtures') return { body: { id: F2 }, status: 201 };
    if (url.startsWith('/api/admin/calendar/fixtures/')) return null;
    return { body: [] };
  });
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('read-only users (viewer)', () => {
  it('see the calendar without any command that changes it', async () => {
    api();
    renderAs('viewer', <CalendarPage />);
    expect(await screen.findAllByTestId('calendar-fixture')).toHaveLength(2);
    expect(screen.getByText(/Sola lettura/)).toBeTruthy();
    for (const name of ['Aggiungi partita', 'Aggiorna calendario', 'Impostazioni', 'Nascondi', 'Modifica', 'Cancella'])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('see the profile of the club disabled and no save', async () => {
    api();
    renderAs('viewer', <ClubPage />);
    expect(await screen.findByRole('heading', { name: 'Profilo del club' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salva profilo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aggiungi campionato' })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(/^Serie/).closest('fieldset')?.disabled).toBe(true);
  });

  it('see the agents but cannot enable, prolong or revoke them, nor read the requests', async () => {
    const calls = api();
    renderAs('viewer', <AgentsPage />);
    expect(await screen.findByText('PC scout')).toBeTruthy();
    expect(await screen.findByText(/1 di 2 agenti in uso/)).toBeTruthy();
    for (const name of ['Abilita', 'Prolunga', 'Revoca', 'Crea token'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(calls.some((c) => c.url === '/api/admin/agent-registrations')).toBe(false);
  });

  it('see the public links without creating or revoking them', async () => {
    api();
    renderAs('viewer', <ShareLinksPage />);
    expect(await screen.findByText(/Canale del club: tutte le partite del calendario/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Nuovo link pubblico' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoca' })).toBeNull();
  });
});

describe('page «Calendario» of an admin', () => {
  it('shows a match not broadcast without its link, and one added by hand with its commands', async () => {
    const calls = api();
    renderAs('admin', <CalendarPage />);
    const [away, manual] = await screen.findAllByTestId('calendar-fixture');
    if (!away || !manual) throw new Error('missing');
    expect(within(away).getByTestId('broadcast-state').textContent).toBe('Non trasmessa');
    expect(within(away).getByText(/Link non attivo/)).toBeTruthy();
    expect(within(away).queryByText('http://portale.test/l/K7M2QX9P')).toBeNull();
    fireEvent.click(within(away).getByRole('button', { name: 'Impostazioni' }));
    fireEvent.click(within(away).getByRole('radio', { name: 'Trasmessa' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/calendar/fixtures/${F1}/settings`,
        method: 'PATCH',
        body: { broadcast: 'on' },
      }),
    );
    fireEvent.click(within(away).getByRole('button', { name: 'Nascondi' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/calendar/fixtures/${F1}/settings`,
        method: 'PATCH',
        body: { hidden: true },
      }),
    );
    expect(within(manual).getByText(/aggiunta a mano/)).toBeTruthy();
    expect(within(manual).queryByRole('button', { name: 'Nascondi' })).toBeNull();
    fireEvent.click(within(manual).getByRole('button', { name: 'Cancella' }));
    fireEvent.click(within(manual).getByRole('button', { name: 'Conferma cancellazione' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: `/api/admin/calendar/fixtures/${F2}`, method: 'DELETE', body: null }),
    );
  });

  it('adds a match by hand: kind, date and time, opponent, home or away, venue', async () => {
    const calls = api();
    renderAs('admin', <CalendarPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiungi partita' }));
    const form = screen.getByRole('form', { name: 'Partita aggiunta a mano' });
    fireEvent.click(within(form).getByRole('radio', { name: 'Coppa' }));
    fireEvent.change(within(form).getByLabelText('Data'), { target: { value: '2026-10-21' } });
    fireEvent.change(within(form).getByLabelText('Ora'), { target: { value: '20:30' } });
    fireEvent.change(within(form).getByLabelText('Avversario'), { target: { value: 'Itas Trentino' } });
    fireEvent.click(within(form).getByRole('radio', { name: 'In trasferta' }));
    fireEvent.change(within(form).getByLabelText(/^Palazzetto/), { target: { value: 'BLM Group Arena' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Aggiungi la partita' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/admin/calendar/fixtures',
        method: 'POST',
        body: {
          kind: 'cup',
          // 20:30 in Rome (CEST, UTC+2).
          startsAt: '2026-10-21T18:30:00.000Z',
          opponent: 'Itas Trentino',
          opponentLogo: null,
          ourSide: 'away',
          venue: 'BLM Group Arena',
          venueCity: null,
        },
      }),
    );
    expect(await screen.findByText(/Partita aggiunta/)).toBeTruthy();
  });
});

describe('page «Agenti» of an admin', () => {
  it('enables a registration «Fino al» a day and prolongs an agent «Senza scadenza»', async () => {
    const calls = api();
    renderAs('admin', <AgentsPage />);
    const day = await screen.findByLabelText('Fino al giorno');
    fireEvent.change(day, { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abilita' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/admin/agent-registrations/${REG}/approve`,
        method: 'POST',
        body: { expiresAt: new Date('2026-12-31T23:59:59').toISOString() },
      }),
    );
    const item = (await screen.findAllByTestId('agent'))[0];
    if (!item) throw new Error('no agent');
    fireEvent.click(within(item).getByRole('button', { name: 'Prolunga' }));
    fireEvent.click(within(item).getByRole('radio', { name: 'Senza scadenza' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Salva validità' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: `/api/admin/agents/${AGENT}`, method: 'PATCH', body: { expiresAt: null } }),
    );
  });

  it('writes the validity of an agent', () => {
    const now = Date.parse('2026-10-17T10:00:00Z');
    expect(validityText({ revoked: false, expiresAt: null }, now)).toBe('senza scadenza');
    expect(validityText({ revoked: false, expiresAt: '2026-10-20T21:59:59.000Z' }, now)).toBe(
      'valido fino al 20/10/2026',
    );
    expect(validityText({ revoked: false, expiresAt: '2026-10-10T21:59:59.000Z' }, now)).toBe('scaduto il 10/10/2026');
    expect(validityEnd('')).toBeNull();
    expect(validityEnd('2026-12-31')).toBe(new Date('2026-12-31T23:59:59').toISOString());
  });
});

describe('page «Campionati» of the superadmin', () => {
  it('lists the championships with the last update and the next one, and updates one now', async () => {
    const calls = api();
    renderAs('superadmin', <LeaguesPage />);
    expect(await screen.findByText('Regular Season SuperLega 2026/2027')).toBeTruthy();
    expect(screen.getByText(/Ogni notte alle 04:00, prossimo/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna ora' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/admin/leagues/${LEAGUE}/sync` && c.method === 'POST')).toBe(true),
    );
    expect(screen.getByRole('heading', { name: 'Nuovo campionato della Lega' })).toBeTruthy();
  });

  it('says when the automatic updates are off or every 10 minutes', () => {
    const now = Date.parse('2026-10-17T10:00:00Z');
    expect(leaguePlanText({ ...league, plan: { nextSyncAt: null, matchToday: false } }, now)).toMatch(/spenti/);
    expect(leaguePlanText({ ...league, plan: { nextSyncAt: '2026-10-17T09:00:00Z', matchToday: true } }, now)).toBe(
      'Oggi c’è una partita di un club: ogni 10 minuti, prossimo appena possibile.',
    );
  });
});
