import type { ClubCompetitionsResponse, ClubResponse } from '@arenalive/shared';
import { CLUB_COMPETITIONS_PATH, CLUB_MAX_LEAGUES } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { leagues, leagueTeams, tenantLeagues, tenants } from '../src/db/index.js';
import { findClubTeam } from '../src/leagues/competitions.js';
import type { FetchLike } from '../src/leagues/fetcher.js';
import type { TestServer } from './helpers.js';
import { ADMIN, login, startServer, VIEWER } from './helpers.js';
import { fixture, superLega2026Fetch } from './leagueFixtures.js';

/**
 * www.legavolley.it from the saved pages: the page of a championship (`IdCampionato` only) shows the menu of its
 * series: SuperLega 2025/26 (974: play off, Coppa Italia, Supercoppa) and 2026/27 (999: Supercoppa A1).
 */
function site(pages: Record<string, string> = {}): FetchLike {
  const inner = superLega2026Fetch();
  const html = (body: string) =>
    Promise.resolve(new Response(body, { headers: { 'content-type': 'text/html; charset=UTF-8' } }));
  const known: Record<string, string> = {
    '': fixture('calendario-senza-filtri-2026.html'),
    '?IdCampionato=974': fixture('calendario-974-2025-andata.html'),
    '?IdCampionato=999': fixture('calendario-999-2026-andata.html'),
    // The other series of the catalog (read by its discovery).
    '?IdCampionato=1000': fixture('calendario-1000-2026-andata.html'),
    '?IdCampionato=1003': fixture('calendario-1000-2026-andata.html'),
    '?IdCampionato=1001': fixture('calendario-1001-2026-andata.html'),
    '?IdCampionato=1002': fixture('calendario-1001-2026-andata.html'),
    ...pages,
  };
  return (url, init) => {
    const u = new URL(url);
    const page = known[u.search];
    if (u.pathname === '/calendario/' && page !== undefined) return html(page);
    return inner(url, init);
  };
}

const servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function start(pages?: Record<string, string>): Promise<TestServer> {
  const server = await startServer({}, {}, { leagueFetcher: { fetch: site(pages) } });
  servers.push(server);
  return server;
}

/** A championship already downloaded, inserted directly. */
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

/** The club of the test client plays the SuperLega of `season` (974 or 999) with Perugia (6865). */
async function clubInSuperLega(server: TestServer, externalId = 974, season = 2025) {
  const series = await readyLeague(server, externalId, season, 'Regular Season SuperLega Credem Banca', [
    [6865, 'Sir Susa Scai Perugia'],
    [6866, 'Itas Trentino'],
  ]);
  await server.database.db
    .insert(tenantLeagues)
    .values({ tenantId: server.tenantId, leagueId: series.league.id, leagueTeamId: series.teams[0]?.id ?? null });
  await server.database.db
    .update(tenants)
    .set({
      clubProfile: {
        series: 'SuperLega',
        gender: 'M',
        seriesId: 'superlega',
        leagueId: series.league.id,
        leagueIds: [series.league.id],
      },
    })
    .where(eq(tenants.id, server.tenantId));
  return series;
}

const caller = async (server: TestServer, who = ADMIN) => {
  const cookie = await login(server.app, who);
  return (options: InjectOptions) => server.app.inject({ ...options, headers: { cookie, ...options.headers } });
};

describe('other competitions of the club («Aggiungi competizione»)', () => {
  it('lists the competitions of the series on the site, adds one and chooses the team of the club by itself', async () => {
    const server = await start();
    await clubInSuperLega(server);
    const cup = await readyLeague(server, 988, 2025, 'Del Monte Coppa Italia SuperLega', [
      [6866, 'Itas Trentino'],
      [6865, 'Sir Susa Vim Perugia'],
    ]);
    const call = await caller(server);
    const list = await call({ url: CLUB_COMPETITIONS_PATH });
    expect(list.statusCode).toBe(200);
    expect(list.json<ClubCompetitionsResponse>().competitions).toEqual([
      { externalId: 991, name: 'Play Off SuperLega Credem Banca', season: 2025 },
      { externalId: 995, name: 'Play Off 5° Posto SuperLega Credem Banca', season: 2025 },
      { externalId: 988, name: 'Del Monte Coppa Italia SuperLega', season: 2025 },
      { externalId: 978, name: 'Del Monte Supercoppa', season: 2025 },
    ]);

    const added = await call({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId: 988 } });
    expect(added.statusCode).toBe(201);
    const club = added.json<ClubResponse>();
    // Same team of the site as in the series: chosen by itself (the calendar of the cup arrives without a choice).
    expect(club.leagues.map((l) => [l.league.externalId, l.team?.id ?? null])).toEqual([
      [974, expect.any(String)],
      [988, cup.teams[1]?.id],
    ]);
    // No new row of the championship: the one already known is reused.
    expect(await server.database.db.select().from(leagues).where(eq(leagues.externalId, 988))).toHaveLength(1);
    // Chosen: no longer in the list; the same request again changes nothing.
    const after = (await call({ url: CLUB_COMPETITIONS_PATH })).json<ClubCompetitionsResponse>();
    expect(after.competitions.map((c) => c.externalId)).toEqual([991, 995, 978]);
    expect((await call({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId: 988 } })).statusCode).toBe(
      200,
    );
  });

  it('adds a competition not known yet and starts its download; without its teams the team stays to choose', async () => {
    const server = await start();
    await clubInSuperLega(server);
    const call = await caller(server);
    const added = await call({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId: 978 } });
    expect(added.statusCode).toBe(201);
    const row = added.json<ClubResponse>().leagues.find((l) => l.league.externalId === 978);
    expect(row).toMatchObject({ league: { season: 2025 }, team: null });
    const [league] = await server.database.db.select().from(leagues).where(eq(leagues.externalId, 978));
    expect(league).toMatchObject({ provider: 'legavolley', season: 2025 });
  });

  it('refuses a competition not in the menu of the series (400), and over the most championships (409)', async () => {
    const server = await start();
    await clubInSuperLega(server);
    const call = await caller(server);
    for (const externalId of [1004, 999, 12345]) {
      const res = await call({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId } });
      expect(res.statusCode, String(externalId)).toBe(400);
    }
    expect(
      (await call({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId: '988' } })).statusCode,
    ).toBe(400);
    for (let i = 0; i < CLUB_MAX_LEAGUES - 1; i++) {
      const other = await readyLeague(server, 5000 + i, 2025, `Altro ${i}`, []);
      await server.database.db
        .insert(tenantLeagues)
        .values({ tenantId: server.tenantId, leagueId: other.league.id, leagueTeamId: null });
    }
    const full = await call({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId: 991 } });
    expect(full.statusCode).toBe(409);
    expect(full.json<{ error: string }>().error).toContain(`Al massimo ${CLUB_MAX_LEAGUES} campionati`);
  });

  it('is for the admin of the client only, and needs the series of the club first', async () => {
    const server = await start();
    const call = await caller(server);
    const none = await call({ url: CLUB_COMPETITIONS_PATH });
    expect(none.statusCode).toBe(409);
    expect(none.json<{ error: string }>().error).toContain('Scegli prima la serie del club');
    await clubInSuperLega(server);
    const viewer = await caller(server, VIEWER);
    expect((await viewer({ url: CLUB_COMPETITIONS_PATH })).statusCode).toBe(403);
    expect(
      (await viewer({ method: 'POST', url: CLUB_COMPETITIONS_PATH, payload: { externalId: 988 } })).statusCode,
    ).toBe(403);
    expect((await server.app.inject({ url: CLUB_COMPETITIONS_PATH })).statusCode).toBe(401);
  });

  it('answers a clear error when the page of the site changed', async () => {
    const server = await start({ '?IdCampionato=974': '<html><body><p>Manutenzione</p></body></html>' });
    await clubInSuperLega(server);
    const call = await caller(server);
    const res = await call({ url: CLUB_COMPETITIONS_PATH });
    expect(res.statusCode).toBe(502);
  });

  it('recognizes the team of the club: same team of the site, otherwise same name, otherwise «nostra squadra»', () => {
    const teams = [
      { externalId: 1, name: 'Itas Trentino' },
      { externalId: 2, name: 'Sir Susa Vim Perugia' },
    ];
    expect(findClubTeam(teams, { externalId: 2, name: 'x' }, null)?.externalId).toBe(2);
    expect(findClubTeam(teams, { externalId: 9, name: 'ITAS  trentino' }, null)?.externalId).toBe(1);
    expect(findClubTeam(teams, null, { code: null, name: 'Perugia' })?.externalId).toBe(2);
    expect(findClubTeam(teams, { externalId: 9, name: 'Altra' }, null)).toBeNull();
    // The team of the series is not in the competition: no guess from «nostra squadra» (short names mislead).
    expect(findClubTeam(teams, { externalId: 9, name: 'Altra' }, { code: null, name: 'Perugia' })).toBeNull();
    expect(
      findClubTeam([...teams, { externalId: 3, name: 'Perugia B' }], null, { code: null, name: 'perugia' }),
    ).toBeNull();
  });
});

describe('new season of the other competitions', () => {
  async function clubWithCups(server: TestServer) {
    await clubInSuperLega(server);
    const supercup = await readyLeague(server, 978, 2025, 'Del Monte Supercoppa', [[6865, 'Sir Susa Scai Perugia']]);
    const cup = await readyLeague(server, 988, 2025, 'Del Monte Coppa Italia SuperLega', [[6865, 'Sir Susa Perugia']]);
    await server.database.db.insert(tenantLeagues).values([
      { tenantId: server.tenantId, leagueId: supercup.league.id, leagueTeamId: supercup.teams[0]?.id ?? null },
      { tenantId: server.tenantId, leagueId: cup.league.id, leagueTeamId: cup.teams[0]?.id ?? null },
    ]);
    // The series of the new season, already downloaded.
    await readyLeague(server, 999, 2026, 'Regular Season SuperLega', [[6865, 'Sir Susa Scai Perugia']]);
  }
  const clubOf = async (server: TestServer) =>
    (await (await caller(server))({ url: '/api/admin/club' })).json<ClubResponse>();

  it('moves a competition to the one of the same kind of the new season, with the same team; the others stay', async () => {
    const server = await start();
    await clubWithCups(server);
    const next = await readyLeague(server, 1004, 2026, 'Supercoppa A1', [
      [6866, 'Itas Trentino'],
      [6865, 'Sir Susa Scai Perugia'],
    ]);
    await server.app.advanceSeasons();
    const club = await clubOf(server);
    // The series moved (its own logic), the Supercoppa followed it, the Coppa Italia is not published yet: it stays.
    expect(
      club.leagues
        .map((l) => [l.league.externalId, l.team?.id ?? null] as const)
        .sort((a, b) => a[0] - b[0])
        .map(([id, team]) => [id, team === null ? null : team === next.teams[1]?.id ? 'perugia' : 'altra']),
    ).toEqual([
      [988, 'altra'],
      [999, 'altra'],
      [1004, 'perugia'],
    ]);
    // Once more: nothing changes.
    await server.app.advanceSeasons();
    expect((await clubOf(server)).leagues.map((l) => l.league.externalId).sort()).toEqual([1004, 988, 999].sort());
  });

  it('keeps the competition of the old season while the new one has not the team of the club', async () => {
    const server = await start();
    await clubWithCups(server);
    await readyLeague(server, 1004, 2026, 'Supercoppa A1', [[6866, 'Itas Trentino']]);
    await server.app.advanceSeasons();
    const ids = (await clubOf(server)).leagues.map((l) => l.league.externalId).sort((a, b) => a - b);
    expect(ids).toEqual([978, 988, 999]);
  });
});
