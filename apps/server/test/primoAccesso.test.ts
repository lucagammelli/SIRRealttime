import type { ClubLeagueStatus, ClubResponse, OnboardingStatus } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickSeriesChampionships, seriesById } from '@sir/shared';
import { leagues, leagueTeams, tenantLeagues, tenants } from '../src/db/index.js';
import { discoverChampionships } from '../src/leagues/catalog.js';
import { LeagueFormatError, parseChampionshipLinkIds, parseChampionshipMenu } from '../src/leagues/legavolley.js';
import type { FetchLike } from '../src/leagues/fetcher.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, startServer, SUPERADMIN, VIEWER } from './helpers.js';
import { fixture, superLega2026Fetch } from './leagueFixtures.js';

const HOST_B = 'b.test';
const ADMIN_B = { email: 'admin-b@sir.test', password: 'password-admin-b' };

/**
 * www.legavolley.it from the saved pages, counting the requests: the calendar without filters shows only the
 * SuperLega in its menu (as the real site), the page of an `IdCampionato` the menu of its series.
 */
function site(bare: string = fixture('calendario-senza-filtri-2026.html')) {
  const calls: string[] = [];
  const inner = superLega2026Fetch();
  const html = (body: string) =>
    Promise.resolve(new Response(body, { headers: { 'content-type': 'text/html; charset=UTF-8' } }));
  const fetch: FetchLike = (url, init) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.pathname === '/calendario/' && u.search === '') return html(bare);
    if (u.pathname === '/calendario/' && ['?IdCampionato=1000', '?IdCampionato=1003'].includes(u.search))
      return html(fixture('calendario-1000-2026-andata.html'));
    if (u.pathname === '/calendario/' && ['?IdCampionato=1001', '?IdCampionato=1002'].includes(u.search))
      return html(fixture('calendario-1001-2026-andata.html'));
    return inner(url, init);
  };
  return { fetch, calls };
}

async function waitReady(call: (o: InjectOptions) => Promise<{ json<T>(): T }>): Promise<ClubLeagueStatus> {
  for (let i = 0; i < 200; i++) {
    const status = (await call({ url: '/api/admin/club/league' })).json<ClubLeagueStatus>();
    if (status.state !== 'downloading') return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('download never ended');
}

describe('club league (series chosen from the catalog)', () => {
  let server: TestServer;
  let cookie: string;
  let cookieB: string;
  let viewer: string;
  let superCookie: string;
  let tenantB: string;
  const fake = site();
  const as = (who: string) => (options: InjectOptions, host?: string) =>
    server.app.inject({ ...options, headers: { cookie: who, ...(host ? { host } : {}), ...options.headers } });
  let callA: ReturnType<typeof as>;
  let callB: ReturnType<typeof as>;
  const choose = (call: typeof callA, series: string, gender = 'M') =>
    call({ method: 'POST', url: '/api/admin/club/league', payload: { gender, series } });

  beforeAll(async () => {
    server = await startServer({}, {}, { leagueFetcher: { fetch: fake.fetch } });
    tenantB = await createTenant(server, 'b', [HOST_B]);
    await createUser(server, ADMIN_B, 'admin', tenantB);
    cookie = await login(server.app, ADMIN);
    cookieB = await login(server.app, ADMIN_B, HOST_B);
    viewer = await login(server.app, VIEWER);
    superCookie = await login(server.app, SUPERADMIN);
    callA = as(cookie);
    callB = as(cookieB);
  });
  afterAll(async () => {
    await server.close();
  });

  it('refuses a viewer, an anonymous call, values out of the catalog and the female gender', async () => {
    expect((await choose(as(viewer), 'superlega')).statusCode).toBe(403);
    expect((await server.app.inject({ method: 'POST', url: '/api/admin/club/league', payload: {} })).statusCode).toBe(
      401,
    );
    expect((await choose(callA, 'a9')).statusCode).toBe(400);
    expect((await choose(callA, 'superlega', 'F')).statusCode).toBe(400);
    expect((await callA({ method: 'POST', url: '/api/admin/club/league', payload: { gender: 'M' } })).statusCode).toBe(
      400,
    );
    // The superadmin outside any client has no club.
    expect((await choose(as(superCookie), 'superlega')).statusCode).toBe(409);
  });

  it('says «none» before any choice, also to a viewer', async () => {
    const res = await as(viewer)({ url: '/api/admin/club/league' });
    expect(res.statusCode).toBe(200);
    expect(res.json<ClubLeagueStatus>()).toMatchObject({ state: 'none', leagueId: null, teams: [] });
  });

  it('creates the championship of the series, downloads it in the background and then lists its teams', async () => {
    const res = await choose(callA, 'superlega');
    expect(res.statusCode).toBe(202);
    expect(res.json<ClubLeagueStatus>()).toMatchObject({ state: 'downloading', gender: 'M', series: 'superlega' });
    const ready = await waitReady(callA);
    expect(ready.state).toBe('ready');
    expect(ready.leagueName).toBe('Regular Season SuperLega');
    expect(ready.season).toBe(2026);
    expect(ready.teams.length).toBeGreaterThan(10);
    const rows = await server.database.db.select().from(leagues).where(eq(leagues.externalId, 999));
    expect(rows).toHaveLength(1);
    // The club is linked to it (team to choose) and the profile keeps gender and series.
    const club = (await callA({ url: '/api/admin/club' })).json<ClubResponse>();
    expect(club.profile).toMatchObject({
      gender: 'M',
      seriesId: 'superlega',
      series: 'SuperLega',
      leagueId: rows[0]?.id,
    });
    expect(club.leagues.map((l) => [l.league.externalId, l.team])).toEqual([[999, null]]);
  });

  it('keeps the championship of the profile when the profile is saved, whatever the body says', async () => {
    const club = (await callA({ url: '/api/admin/club' })).json<ClubResponse>();
    const res = await callA({
      method: 'PUT',
      url: '/api/admin/club/profile',
      payload: {
        displayName: null,
        logoMark: null,
        ourTeam: club.ourTeam,
        // An old card of the Club page: it sends back (or invents) the fields of the server.
        profile: {
          ...club.profile,
          leagueId: crypto.randomUUID(),
          leagueIds: [crypto.randomUUID()],
          seriesId: 'a3',
          gender: 'F',
          newSeason: true,
          series: 'Altro',
          coverage: 'homeOnly',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ClubResponse>().profile).toEqual({
      ...club.profile,
      coverage: 'homeOnly',
    });
    expect(res.json<ClubResponse>().profile).toMatchObject({
      seriesId: 'superlega',
      gender: 'M',
      newSeason: false,
      leagueId: club.profile.leagueId,
      leagueIds: club.profile.leagueIds,
    });
  });

  it('reuses a championship already downloaded: no second row, no new request, ready at once', async () => {
    const before = fake.calls.filter((c) => c.startsWith('/calendario/?') || c.startsWith('/classifica/')).length;
    const res = await choose(callB, 'superlega');
    expect(res.statusCode).toBe(200);
    expect(res.json<ClubLeagueStatus>()).toMatchObject({ state: 'ready', teamId: null });
    expect(await server.database.db.select().from(leagues).where(eq(leagues.externalId, 999))).toHaveLength(1);
    expect(fake.calls.filter((c) => c.startsWith('/calendario/?') || c.startsWith('/classifica/')).length).toBe(before);
    // The menu of the site was read once for both clubs (cache).
    expect(fake.calls.filter((c) => c === '/calendario/')).toHaveLength(1);
  });

  it('keeps the clubs apart: the team chosen by one is not seen by the other', async () => {
    const status = (await callA({ url: '/api/admin/club/league' })).json<ClubLeagueStatus>();
    const team = status.teams[0];
    if (!team || !status.leagueId) throw new Error('no team');
    const put = await callA({
      method: 'PUT',
      url: '/api/admin/club',
      payload: { leagues: [{ leagueId: status.leagueId, teamId: team.id }] },
    });
    expect(put.statusCode).toBe(200);
    expect((await callA({ url: '/api/admin/club/league' })).json<ClubLeagueStatus>().teamId).toBe(team.id);
    expect((await callB({ url: '/api/admin/club/league' }, HOST_B)).json<ClubLeagueStatus>().teamId).toBeNull();
    const rows = await server.database.db.select().from(tenantLeagues).where(eq(tenantLeagues.tenantId, tenantB));
    expect(rows.map((r) => r.leagueTeamId)).toEqual([null]);
  });

  it('matches the series by name: A2 yes, cups and other groups no; a failed download shows the error', async () => {
    const res = await choose(callA, 'a2');
    expect([200, 202]).toContain(res.statusCode);
    const status = await waitReady(callA);
    // The fake site has no pages for the A2: the download fails with a clear message.
    expect(status).toMatchObject({ state: 'error', series: 'a2' });
    expect(status.message).toBeTruthy();
    const row = (await server.database.db.select().from(leagues).where(eq(leagues.externalId, 1000)))[0];
    expect(row?.season).toBe(2026);
    expect(await server.database.db.select().from(leagues).where(eq(leagues.externalId, 1003))).toHaveLength(0);
    // The championship of the previous series went away from the club; the other club keeps it.
    const club = (await callA({ url: '/api/admin/club' })).json<ClubResponse>();
    expect(club.leagues.map((l) => l.league.externalId)).toEqual([1000]);
    const clubB = (await callB({ url: '/api/admin/club' }, HOST_B)).json<ClubResponse>();
    expect(clubB.leagues.map((l) => l.league.externalId)).toEqual([999]);
  });

  it('still lets the superadmin add a championship by IdCampionato', async () => {
    const res = await as(superCookie)({
      method: 'POST',
      url: '/api/admin/leagues',
      payload: { provider: 'legavolley', externalId: 1004, season: 2026 },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('club league with a site page that changed', () => {
  it('answers a clear error and keeps the club untouched', async () => {
    const bad = site(
      '<html><body><select id="Anno"><option selected value=2026>2026/2027</option></select></body></html>',
    );
    const server = await startServer({}, {}, { leagueFetcher: { fetch: bad.fetch } });
    try {
      const cookie = await login(server.app, ADMIN);
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/club/league',
        headers: { cookie },
        payload: { gender: 'M', series: 'superlega' },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json<{ error: string }>().error).toContain('Campionato');
      expect(await server.database.db.select().from(tenantLeagues)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('answers a clear error when the site is not reachable', async () => {
    const server = await startServer();
    try {
      const cookie = await login(server.app, ADMIN);
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/club/league',
        headers: { cookie },
        payload: { gender: 'M', series: 'a3' },
      });
      expect(res.statusCode).toBe(502);
    } finally {
      await server.close();
    }
  });
});

describe('onboarding flag', () => {
  let server: TestServer;
  let cookie: string;
  let cookieB: string;
  let viewer: string;
  let tenantB: string;
  const call = (who: string, options: InjectOptions, host?: string) =>
    server.app.inject({ ...options, headers: { cookie: who, ...(host ? { host } : {}), ...options.headers } });

  beforeAll(async () => {
    server = await startServer();
    tenantB = await createTenant(server, 'b', [HOST_B]);
    await createUser(server, ADMIN_B, 'admin', tenantB);
    cookie = await login(server.app, ADMIN);
    cookieB = await login(server.app, ADMIN_B, HOST_B);
    viewer = await login(server.app, VIEWER);
  });
  afterAll(async () => {
    await server.close();
  });

  it('is to do for a new client, readable by a viewer, set only by an admin and only for its own client', async () => {
    expect((await call(viewer, { url: '/api/admin/onboarding' })).json<OnboardingStatus>()).toEqual({
      completed: false,
      completedAt: null,
    });
    expect(
      (await call(viewer, { method: 'POST', url: '/api/admin/onboarding/complete', payload: {} })).statusCode,
    ).toBe(403);
    expect(
      (await server.app.inject({ method: 'POST', url: '/api/admin/onboarding/complete', payload: {} })).statusCode,
    ).toBe(401);
    const done = await call(cookie, { method: 'POST', url: '/api/admin/onboarding/complete', payload: {} });
    expect(done.statusCode).toBe(200);
    const first = done.json<OnboardingStatus>();
    expect(first.completed).toBe(true);
    expect(first.completedAt).not.toBeNull();
    // A second call keeps the first time.
    const again = await call(cookie, { method: 'POST', url: '/api/admin/onboarding/complete', payload: {} });
    expect(again.json<OnboardingStatus>()).toEqual(first);
    expect((await call(viewer, { url: '/api/admin/onboarding' })).json<OnboardingStatus>().completed).toBe(true);
    // The other client is untouched.
    expect((await call(cookieB, { url: '/api/admin/onboarding' }, HOST_B)).json<OnboardingStatus>().completed).toBe(
      false,
    );
    const [b] = await server.database.db
      .select({ at: tenants.onboardedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantB));
    expect(b?.at).toBeNull();
  });
});

/** A championship already downloaded, inserted directly (the fake site has no pages for it). */
async function readyLeague(
  server: TestServer,
  externalId: number,
  season: number,
  name: string,
  teamList: [number, string][],
) {
  const [row] = await server.database.db
    .insert(leagues)
    .values({ provider: 'legavolley', externalId, season, name, lastStatus: 'ok', lastSuccessAt: new Date() })
    .returning();
  if (!row) throw new Error('no league');
  const teamRows = teamList.length
    ? await server.database.db
        .insert(leagueTeams)
        .values(teamList.map(([id, teamName]) => ({ leagueId: row.id, externalId: id, name: teamName })))
        .returning()
    : [];
  return { league: row, teams: teamRows };
}

describe('series with two groups (A3)', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({}, {}, { leagueFetcher: { fetch: site().fetch } });
  });
  afterAll(async () => {
    await server.close();
  });

  it('links both groups, lists the teams of both and keeps only the group of the chosen team', async () => {
    const bianco = await readyLeague(server, 1001, 2026, 'Regular Season Serie A3 Credem Banca G.Bianco', [
      [11, 'Alfa Bianco'],
    ]);
    const blu = await readyLeague(server, 1002, 2026, 'Regular Season Serie A3 Credem Banca G.Blu', [[22, 'Beta Blu']]);
    const cookie = await login(server.app, ADMIN);
    const call = (options: InjectOptions) => server.app.inject({ ...options, headers: { cookie } });
    const first = await call({ method: 'POST', url: '/api/admin/club/league', payload: { gender: 'M', series: 'a3' } });
    expect(first.statusCode).toBe(200);
    const status = first.json<ClubLeagueStatus>();
    expect(status.state).toBe('ready');
    expect(status.teams.map((t) => [t.name, t.leagueId])).toEqual([
      ['Alfa Bianco', bianco.league.id],
      ['Beta Blu', blu.league.id],
    ]);
    let club = (await call({ url: '/api/admin/club' })).json<ClubResponse>();
    expect(club.leagues.map((l) => l.league.externalId).sort()).toEqual([1001, 1002]);
    expect(club.profile.leagueIds).toEqual([bianco.league.id, blu.league.id]);

    const team = blu.teams[0];
    // Both groups sent (as the Club page does): the one with the team stays, the other goes away.
    const put = await call({
      method: 'PUT',
      url: '/api/admin/club',
      payload: {
        leagues: [
          { leagueId: bianco.league.id, teamId: null },
          { leagueId: blu.league.id, teamId: team?.id },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    club = (await call({ url: '/api/admin/club' })).json<ClubResponse>();
    expect(club.leagues.map((l) => [l.league.externalId, l.team?.name])).toEqual([[1002, 'Beta Blu']]);
    expect((await call({ url: '/api/admin/club/league' })).json<ClubLeagueStatus>().teamId).toBe(team?.id);
    // Choosing the series again keeps the group of the team only.
    await call({ method: 'POST', url: '/api/admin/club/league', payload: { gender: 'M', series: 'a3' } });
    club = (await call({ url: '/api/admin/club' })).json<ClubResponse>();
    expect(club.leagues.map((l) => l.league.externalId)).toEqual([1002]);
  });
});

describe('new season of the series', () => {
  async function clubInOldSeason(server: TestServer) {
    const old = await readyLeague(server, 978, 2025, 'Regular Season Serie A2', [
      [55, 'Volley Uno'],
      [56, 'Volley Due'],
    ]);
    const team = old.teams[0];
    if (!team) throw new Error('no team');
    await server.database.db
      .insert(tenantLeagues)
      .values({ tenantId: server.tenantId, leagueId: old.league.id, leagueTeamId: team.id });
    await server.database.db
      .update(tenants)
      .set({
        clubProfile: {
          series: 'Serie A2',
          gender: 'M',
          seriesId: 'a2',
          leagueId: old.league.id,
          leagueIds: [old.league.id],
        },
      })
      .where(eq(tenants.id, server.tenantId));
    return old;
  }

  it('moves the club to the new championship with the same team (external id, otherwise name)', async () => {
    for (const renamed of [false, true]) {
      const server = await startServer({}, {}, { leagueFetcher: { fetch: site().fetch } });
      try {
        await clubInOldSeason(server);
        const next = await readyLeague(server, 1000, 2026, 'Regular Season Serie A2 Credem Banca', [
          renamed ? [900, 'VOLLEY  uno'] : [55, 'Volley Uno S.r.l.'],
          [57, 'Altra'],
        ]);
        await server.app.advanceSeasons();
        const cookie = await login(server.app, ADMIN);
        const club = (await server.app.inject({ url: '/api/admin/club', headers: { cookie } })).json<ClubResponse>();
        expect(club.leagues.map((l) => [l.league.externalId, l.team?.id])).toEqual([[1000, next.teams[0]?.id]]);
        expect(club.profile).toMatchObject({ leagueId: next.league.id, leagueIds: [next.league.id], newSeason: false });
      } finally {
        await server.close();
      }
    }
  });

  it('removes only the links of the series: a cup added by the superadmin stays; an old Club card does not bring the old ones back', async () => {
    const server = await startServer({}, {}, { leagueFetcher: { fetch: site().fetch } });
    try {
      await clubInOldSeason(server);
      const cup = await readyLeague(server, 991, 2025, 'Coppa Italia', [[55, 'Volley Uno']]);
      await server.database.db
        .insert(tenantLeagues)
        .values({ tenantId: server.tenantId, leagueId: cup.league.id, leagueTeamId: cup.teams[0]?.id ?? null });
      const next = await readyLeague(server, 1000, 2026, 'Regular Season Serie A2 Credem Banca', [[55, 'Volley Uno']]);
      const cookie = await login(server.app, ADMIN);
      const staleCard = (await server.app.inject({ url: '/api/admin/club', headers: { cookie } })).json<ClubResponse>();
      await server.app.advanceSeasons();
      const get = async () =>
        (await server.app.inject({ url: '/api/admin/club', headers: { cookie } })).json<ClubResponse>();
      let club = await get();
      expect(club.leagues.map((l) => l.league.externalId).sort((a, b) => a - b)).toEqual([991, 1000]);
      // The old card is saved after the change of season: the profile keeps the new championships.
      const res = await server.app.inject({
        method: 'PUT',
        url: '/api/admin/club/profile',
        headers: { cookie },
        payload: {
          displayName: null,
          logoMark: null,
          ourTeam: staleCard.ourTeam,
          profile: { ...staleCard.profile, coverage: 'homeOnly' },
        },
      });
      expect(res.statusCode).toBe(200);
      club = await get();
      expect(club.profile).toMatchObject({
        leagueId: next.league.id,
        leagueIds: [next.league.id],
        coverage: 'homeOnly',
      });
    } finally {
      await server.close();
    }
  });

  it('keeps the old championship and says «new season» when the team is not in the new one, until the club chooses again', async () => {
    const server = await startServer({}, {}, { leagueFetcher: { fetch: site().fetch } });
    try {
      const old = await clubInOldSeason(server);
      await readyLeague(server, 1000, 2026, 'Regular Season Serie A2 Credem Banca', [[70, 'Sconosciuta']]);
      await server.app.advanceSeasons();
      const cookie = await login(server.app, ADMIN);
      const get = async () =>
        (await server.app.inject({ url: '/api/admin/club', headers: { cookie } })).json<ClubResponse>();
      let club = await get();
      expect(club.leagues.map((l) => l.league.externalId)).toEqual([978]);
      expect(club.profile).toMatchObject({ leagueId: old.league.id, newSeason: true });
      // The club chooses the series again: the new championship, no team, the notice goes away.
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/admin/club/league',
        headers: { cookie },
        payload: { gender: 'M', series: 'a2' },
      });
      expect(res.statusCode).toBe(200);
      club = await get();
      expect(club.leagues.map((l) => [l.league.externalId, l.team])).toEqual([[1000, null]]);
      expect(club.profile.newSeason).toBe(false);
    } finally {
      await server.close();
    }
  });
});

const need = (id: string) => {
  const found = seriesById(id);
  if (!found) throw new Error(`series ${id} missing`);
  return found;
};

describe('discovery of the catalog on the official site', () => {
  const pages: Record<string, string> = {
    '': 'calendario-999-2026-andata.html',
    '1000': 'calendario-1000-2026-andata.html',
    '1001': 'calendario-1001-2026-andata.html',
  };
  const reader = (reads: (number | null)[]) => (id: number | null) => {
    reads.push(id);
    const html =
      id === null
        ? fixture('calendario-senza-filtri-2026.html')
        : fixture(pages[id === 1003 ? '1000' : id === 1002 ? '1001' : String(id)] ?? 'calendario-999-2026-andata.html');
    return Promise.resolve({ menu: parseChampionshipMenu(html), linkIds: parseChampionshipLinkIds(html) });
  };

  it('reads the links of the page as numbers only', () => {
    const ids = parseChampionshipLinkIds(fixture('calendario-senza-filtri-2026.html'));
    expect(ids).toEqual(expect.arrayContaining([978, 980, 988, 998, 999, 1000, 1001, 1002, 1003]));
    expect(ids.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
  });

  it('merges the menus of the pages read until every series is found', async () => {
    const reads: (number | null)[] = [];
    const menu = await discoverChampionships(reader(reads));
    expect(menu.season).toBe(2026);
    const names = menu.championships.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Regular Season SuperLega',
        'Regular Season Serie A2 Credem Banca',
        'Regular Season Serie A3 Credem Banca G.Bianco',
        'Regular Season Serie A3 Credem Banca G.Blu',
      ]),
    );
    // Highest ids first; stops as soon as the three series are there.
    expect(reads).toEqual([null, 1003, 1002]);
    for (const [id, groups] of [
      ['superlega', [999]],
      ['a2', [1000]],
      ['a3', [1001, 1002]],
    ] as const)
      expect(pickSeriesChampionships(need(id), menu.championships).map((c) => c.externalId)).toEqual(groups);
  });

  it('skips a page whose format changed (logged) and goes on; a first page that changed fails', async () => {
    const skipped: number[] = [];
    const reads: (number | null)[] = [];
    const ok = reader(reads);
    const broken = (id: number | null) =>
      id === 1003 ? Promise.reject(new LeagueFormatError('pagina cambiata')) : ok(id);
    const menu = await discoverChampionships(broken, undefined, undefined, (id) => skipped.push(id));
    expect(skipped).toEqual([1003]);
    expect(reads).toEqual([null, 1002, 1000]);
    expect(pickSeriesChampionships(need('a2'), menu.championships).map((c) => c.externalId)).toEqual([1000]);
    await expect(discoverChampionships(() => Promise.reject(new LeagueFormatError('x')))).rejects.toThrow('x');
    // Series missing at the end: the choice of that series fails with a clear error (the others work).
    const onlyFirst = (id: number | null) =>
      id === null ? ok(null) : Promise.reject(new LeagueFormatError('pagina cambiata'));
    const partial = await discoverChampionships(onlyFirst);
    expect(pickSeriesChampionships(need('a2'), partial.championships)).toEqual([]);
    expect(pickSeriesChampionships(need('superlega'), partial.championships)).toHaveLength(1);
  });

  it('reads only the first page when it already has every series, and never more than the limit', async () => {
    const reads: (number | null)[] = [];
    await discoverChampionships(reader(reads), [need('superlega')]);
    expect(reads).toEqual([null]);
    const many: (number | null)[] = [];
    const endless = (id: number | null) => {
      many.push(id);
      const html = fixture('calendario-999-2026-andata.html');
      return Promise.resolve({
        menu: parseChampionshipMenu(html),
        linkIds: id === null ? [2001, 2002, 2003, 2004, 2005] : [],
      });
    };
    await discoverChampionships(endless, [need('a3')], 3);
    expect(many).toEqual([null, 2005, 2004]);
  });
});
