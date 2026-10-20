import { generateMatch } from '@arenalive/dvw-simulator';
import type {
  CalendarResponse,
  ClubFixture,
  ClubTeamsResponse,
  CreateShareTokenResponse,
  LeagueDetailResponse,
  LeagueSummary,
  ScheduleResponse,
  ServerMessage,
} from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leaguesWithClubMatches, refreshClientFixtures } from '../src/club.js';
import { clientFixtures, fixtures, matches } from '../src/db/index.js';
import type { TestServer } from './helpers.js';
import {
  ADMIN,
  createAgent,
  createTenant,
  createUser,
  fileAt,
  ingest,
  login,
  requestFor,
  startServer,
  SUPERADMIN,
  VIEWER,
} from './helpers.js';
import { superLega2026Fetch } from './leagueFixtures.js';

const HOST_B = 'date-b.test';
const ADMIN_B = { email: 'admin-date-b@sir.test', password: 'password-admin-db' };
const BASE_TIME = new Date('2026-10-10T10:00:00.000Z');
// 18:30 in Rome (CEST, UTC+2) of a day with no other match around.
const MOVED = '2026-10-11T16:30:00.000Z';

let server: TestServer;
let cookie: string;
let viewerCookie: string;
let cookieB: string;
let leagueId: string;
let target: ClubFixture;

const call = (options: InjectOptions, who: string | null = cookie, host?: string) =>
  server.app.inject({
    ...options,
    headers: { ...(who ? { cookie: who } : {}), ...(host ? { host } : {}), ...options.headers },
  });
const calendar = async (): Promise<CalendarResponse> => (await call({ url: '/api/admin/calendar' })).json();
const fixture = async (id: string): Promise<ClubFixture> => {
  const found = (await calendar()).fixtures.find((f) => f.id === id);
  if (!found) throw new Error(`fixture ${id} missing`);
  return found;
};
const setDate = (id: string, startsAt: string | null, who = cookie, host?: string) =>
  call({ method: 'PUT', url: `/api/admin/calendar/fixtures/${id}/date`, payload: { startsAt } }, who, host);
const schedule = async (): Promise<ScheduleResponse> =>
  (await call({ url: '/api/public/tenant/schedule' }, null)).json<ScheduleResponse>();
const refresh = () => refreshClientFixtures(server.database.db, 'x'.repeat(32), server.tenantId, BASE_TIME);

beforeAll(async () => {
  server = await startServer({}, {}, { leagueFetcher: { fetch: superLega2026Fetch() } });
  server.setNow(BASE_TIME);
  const superCookie = await login(server.app, SUPERADMIN);
  cookie = await login(server.app, ADMIN);
  viewerCookie = await login(server.app, VIEWER);
  const tenantB = await createTenant(server, 'date-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
  const created = await call(
    { method: 'POST', url: '/api/admin/leagues', payload: { provider: 'legavolley', externalId: 999, season: 2026 } },
    superCookie,
  );
  leagueId = created.json<LeagueSummary>().id;
  await call({ method: 'POST', url: `/api/admin/leagues/${leagueId}/sync`, payload: {} }, superCookie);
  for (let k = 0; ; k++) {
    const sync = (await call({ url: `/api/admin/leagues/${leagueId}` }, superCookie)).json<LeagueDetailResponse>()
      .league.sync;
    if (!sync.running && sync.status === 'ok') break;
    if (k > 1000) throw new Error('update never ended');
    await new Promise((r) => setTimeout(r, 20));
  }
  const teams = (await call({ url: `/api/admin/club/leagues/${leagueId}/teams` })).json<ClubTeamsResponse>().teams;
  const perugia = teams.find((t) => t.name === 'Sir Susa Scai Perugia');
  await call({ method: 'PUT', url: '/api/admin/club', payload: { leagues: [{ leagueId, teamId: perugia?.id }] } });
  const first = (await calendar()).fixtures.find((f) => f.origin === 'league' && f.startsAt);
  if (!first) throw new Error('no downloaded match');
  target = first;
}, 30_000);
afterAll(() => server.close());

describe('date of a downloaded match changed by hand', () => {
  it('shows the new date as the effective one, with the official one beside it', async () => {
    expect(target).toMatchObject({ dateOverridden: false, movedByLeague: false, dateOverriddenAt: null });
    expect((await setDate(target.id, MOVED)).statusCode).toBe(204);
    const after = await fixture(target.id);
    expect(after).toMatchObject({
      startsAt: MOVED,
      officialStartsAt: target.startsAt,
      dateOverridden: true,
      movedByLeague: false,
      dateOverriddenAt: BASE_TIME.toISOString(),
    });
    expect(after.link?.shortCode).toBeTruthy();
  });

  it('uses the effective date in «Prossima partita», in the channel and in the order of the calendar', async () => {
    const next = (await schedule()).fixtures[0];
    expect(next).toMatchObject({ startsAt: MOVED, shortUrl: target.link?.shortUrl });
    const created = await call({
      method: 'POST',
      url: '/api/admin/share-tokens',
      payload: { label: 'Canale', matchId: null, expiresAt: null },
    });
    const token = created.json<CreateShareTokenResponse>().token;
    const state = (await call({ url: `/api/public/${token}/state` }, null)).json<ServerMessage>();
    expect(state).toMatchObject({ type: 'scheduled', fixture: { startsAt: MOVED } });
    expect((await calendar()).fixtures[0]?.id).toBe(target.id);
    // The plan of the match days looks at the effective date.
    const day = (iso: string) =>
      [new Date(Date.parse(iso) - 3_600_000), new Date(Date.parse(iso) + 3_600_000)] as const;
    const [from, to] = day(MOVED);
    expect((await leaguesWithClubMatches(server.database.db, from, to)).has(leagueId)).toBe(true);
    const [oldFrom, oldTo] = day(target.startsAt ?? '');
    expect((await leaguesWithClubMatches(server.database.db, oldFrom, oldTo)).has(leagueId)).toBe(false);
  });

  it('links the .dvw by the effective day', async () => {
    const agent = await createAgent(server);
    const match = generateMatch({
      seed: 5,
      homeName: target.home.name,
      awayName: target.away.name,
      startTime: MOVED,
    });
    const res = await ingest(server.app, agent, await requestFor('data-modificata', 1, [], fileAt(match, 20)));
    expect(res.json()).toMatchObject({ status: 'ok' });
    const [row] = await server.database.db.select().from(matches).where(eq(matches.matchKey, 'data-modificata'));
    expect(row).toMatchObject({ clientFixtureId: target.id, fixtureLink: 'auto' });
  });

  it('is not overwritten by the update of the calendar, which still brings result and state', async () => {
    const [stored] = await server.database.db.select().from(clientFixtures).where(eq(clientFixtures.id, target.id));
    if (!stored?.fixtureId) throw new Error('official match missing');
    const moved = new Date(Date.parse(target.startsAt ?? '') + 7 * 86_400_000);
    await server.database.db
      .update(fixtures)
      .set({ startsAt: moved, status: 'played', homeSets: 3, awaySets: 1 })
      .where(eq(fixtures.id, stored.fixtureId));
    await refresh();
    const after = await fixture(target.id);
    expect(after).toMatchObject({
      startsAt: MOVED,
      officialStartsAt: moved.toISOString(),
      dateOverridden: true,
      movedByLeague: true,
      status: 'played',
      result: { home: 3, away: 1 },
    });
    const [row] = await server.database.db.select().from(clientFixtures).where(eq(clientFixtures.id, target.id));
    expect(row?.overrideStartsAt?.toISOString()).toBe(MOVED);
    expect(row?.overrideOfficialStartsAt?.toISOString()).toBe(target.startsAt);
  });

  it('goes back to the official date and takes the new one from the league again', async () => {
    expect((await setDate(target.id, null)).statusCode).toBe(204);
    const after = await fixture(target.id);
    expect(after).toMatchObject({
      startsAt: new Date(Date.parse(target.startsAt ?? '') + 7 * 86_400_000).toISOString(),
      dateOverridden: false,
      movedByLeague: false,
      dateOverriddenAt: null,
    });
    const [row] = await server.database.db.select().from(clientFixtures).where(eq(clientFixtures.id, target.id));
    expect(row).toMatchObject({ overrideStartsAt: null, overriddenAt: null, overrideOfficialStartsAt: null });
  });
});

describe('same date as the official one', () => {
  it('goes back to the automatic date instead of freezing it', async () => {
    expect((await setDate(target.id, MOVED)).statusCode).toBe(204);
    const official = (await fixture(target.id)).officialStartsAt;
    expect((await setDate(target.id, official)).statusCode).toBe(204);
    expect(await fixture(target.id)).toMatchObject({ dateOverridden: false, movedByLeague: false });
  });
});

describe('who can change the date', () => {
  it('refuses wrong data, a null date on a match added by hand, and accepts a new date for it', async () => {
    expect((await setDate(target.id, 'domani')).statusCode).toBe(400);
    expect(
      (await call({ method: 'PUT', url: `/api/admin/calendar/fixtures/${target.id}/date`, payload: {} })).statusCode,
    ).toBe(400);
    const added = await call({
      method: 'POST',
      url: '/api/admin/calendar/fixtures',
      payload: {
        kind: 'friendly',
        startsAt: '2026-10-12T16:00:00.000Z',
        opponent: 'Amichevole',
        opponentLogo: null,
        ourSide: 'home',
        venue: null,
        venueCity: null,
      },
    });
    const id = added.json<{ id: string }>().id;
    expect((await setDate(id, null)).statusCode).toBe(400);
    expect((await setDate(id, '2026-10-13T16:00:00.000Z')).statusCode).toBe(204);
    expect(await fixture(id)).toMatchObject({ startsAt: '2026-10-13T16:00:00.000Z', dateOverridden: false });
  });

  it('is for the admins of the client only, and never reaches another client', async () => {
    expect((await setDate(target.id, MOVED, viewerCookie)).statusCode).toBe(403);
    expect((await setDate(target.id, MOVED, cookieB, HOST_B)).statusCode).toBe(404);
    expect(
      (
        await call(
          { method: 'PUT', url: `/api/admin/calendar/fixtures/${target.id}/date`, payload: { startsAt: MOVED } },
          null,
        )
      ).statusCode,
    ).toBe(401);
    expect(await fixture(target.id)).toMatchObject({ dateOverridden: false });
  });
});
