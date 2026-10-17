import { generateMatch } from '@sir/dvw-simulator';
import type {
  AssetSummary,
  CalendarResponse,
  ClubFixture,
  ClubResponse,
  ClubTeamsResponse,
  LeagueDetailResponse,
  LeagueSummary,
  ScheduleResponse,
  ServerMessage,
  UpdateClubProfileRequest,
} from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matches } from '../src/db/index.js';
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
import { png } from './imageFixtures.js';
import { superLega2026Fetch } from './leagueFixtures.js';

const HOST_B = 'cal-b.test';
const ADMIN_B = { email: 'admin-cal-b@sir.test', password: 'password-admin-cb' };
const BASE_TIME = new Date('2026-10-10T10:00:00.000Z');

let server: TestServer;
let cookie: string;
let viewerCookie: string;
let cookieB: string;
let agent: string;
let manualId: string;

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
const schedule = async (): Promise<ScheduleResponse> =>
  (await call({ url: '/api/public/tenant/schedule' }, null)).json<ScheduleResponse>();
const publicState = async (code: string) => {
  const res = await call({ url: `/api/public/${code}/state` }, null);
  return { status: res.statusCode, body: res.statusCode === 200 ? res.json<ServerMessage>() : null };
};
const upload = async (kind: 'logo' | 'sponsor', width: number, who = cookie, host?: string) =>
  (
    await call(
      { method: 'POST', url: '/api/admin/assets', payload: { kind, data: png(width, width).toString('base64') } },
      who,
      host,
    )
  ).json<AssetSummary>();
const settings = (id: string, payload: Record<string, unknown>, who = cookie) =>
  call({ method: 'PATCH', url: `/api/admin/calendar/fixtures/${id}/settings`, payload }, who);
const putProfile = async (change: Partial<UpdateClubProfileRequest['profile']> & { logoMark?: string | null }) => {
  const club = (await call({ url: '/api/admin/club' })).json<ClubResponse>();
  const { logoMark, ...profile } = change;
  return call({
    method: 'PUT',
    url: '/api/admin/club/profile',
    payload: {
      displayName: club.displayName,
      logoMark: logoMark === undefined ? club.logoMark : logoMark,
      ourTeam: club.ourTeam,
      profile: { ...club.profile, ...profile },
    },
  });
};

const FRIENDLY = {
  kind: 'friendly',
  startsAt: '2026-10-12T16:00:00.000Z',
  opponent: 'Suntory Sunbirds Osaka',
  opponentLogo: null,
  ourSide: 'home',
  venue: 'PalaBarton',
  venueCity: 'Perugia',
};

let seq = 0;
async function send(matchKey: string, options: { home: string; away: string; start: string }, upTo: number) {
  const match = generateMatch({ seed: 5, homeName: options.home, awayName: options.away, startTime: options.start });
  seq++;
  const res = await ingest(server.app, agent, await requestFor(matchKey, seq, [], fileAt(match, upTo)));
  expect(res.json()).toMatchObject({ status: 'ok' });
  const [row] = await server.database.db.select().from(matches).where(eq(matches.matchKey, matchKey));
  if (!row) throw new Error('match missing');
  return row;
}

beforeAll(async () => {
  server = await startServer({}, {}, { leagueFetcher: { fetch: superLega2026Fetch() } });
  server.setNow(BASE_TIME);
  const superCookie = await login(server.app, SUPERADMIN);
  cookie = await login(server.app, ADMIN);
  viewerCookie = await login(server.app, VIEWER);
  const tenantB = await createTenant(server, 'cal-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
  agent = await createAgent(server);
  const created = await call(
    { method: 'POST', url: '/api/admin/leagues', payload: { provider: 'legavolley', externalId: 999, season: 2026 } },
    superCookie,
  );
  const leagueId = created.json<LeagueSummary>().id;
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
}, 30_000);
afterAll(() => server.close());

describe('matches added by the client', () => {
  it('adds a friendly match with its link and QR, our team named as in the league', async () => {
    expect(
      (await call({ method: 'POST', url: '/api/admin/calendar/fixtures', payload: FRIENDLY }, viewerCookie)).statusCode,
    ).toBe(403);
    const res = await call({ method: 'POST', url: '/api/admin/calendar/fixtures', payload: FRIENDLY });
    expect(res.statusCode).toBe(201);
    manualId = res.json<{ id: string }>().id;
    const f = await fixture(manualId);
    expect(f).toMatchObject({
      origin: 'manual',
      kind: 'friendly',
      league: null,
      roundLabel: 'Amichevole',
      home: { name: 'Sir Susa Scai Perugia' },
      away: { name: 'Suntory Sunbirds Osaka', logoUrl: null },
      venue: 'PalaBarton',
      broadcasted: true,
      state: 'scheduled',
    });
    expect(f.link?.shortUrl).toContain('/l/');
    const code = f.link?.shortCode ?? '';
    const state = await publicState(code);
    expect(state.body).toMatchObject({ type: 'scheduled', fixture: { away: { name: 'Suntory Sunbirds Osaka' } } });
    // The first match of the club is the friendly one, before the championship.
    expect((await schedule()).fixtures[0]).toMatchObject({ roundLabel: 'Amichevole', shortUrl: f.link?.shortUrl });
    // Another client sees nothing of it.
    expect(
      (await call({ method: 'DELETE', url: `/api/admin/calendar/fixtures/${manualId}` }, cookieB, HOST_B)).statusCode,
    ).toBe(404);
  });

  it('refuses logos that are not images «logo» of the client, and wrong data', async () => {
    const sponsor = await upload('sponsor', 41);
    const foreign = await upload('logo', 42, cookieB, HOST_B);
    for (const opponentLogo of [sponsor.id, foreign.id]) {
      const res = await call({
        method: 'POST',
        url: '/api/admin/calendar/fixtures',
        payload: { ...FRIENDLY, opponentLogo },
      });
      expect(res.statusCode).toBe(400);
    }
    const bad = await call({
      method: 'POST',
      url: '/api/admin/calendar/fixtures',
      payload: { ...FRIENDLY, startsAt: 'domani' },
    });
    expect(bad.statusCode).toBe(400);
    const notImage = await call({
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'logo', data: Buffer.from('<html>no</html>').toString('base64') },
    });
    expect(notImage.statusCode).toBe(422);
  });

  it('links the .dvw of that match by itself, like the downloaded ones', async () => {
    server.setNow(new Date('2026-10-12T16:10:00.000Z'));
    cookie = await login(server.app, ADMIN);
    const row = await send(
      'amichevole-suntory',
      { home: 'Sir Susa Scai Perugia_Amichevoli', away: 'SUNTORY SUNBIRDS OSAKA', start: '2026-10-12T16:00:00Z' },
      20,
    );
    expect(row).toMatchObject({ clientFixtureId: manualId, fixtureLink: 'auto', live: true });
    expect((await fixture(manualId)).state).toBe('live');
  });

  it('changes and deletes only the matches added by hand; the downloaded ones can be hidden', async () => {
    const list = await calendar();
    const downloaded = list.fixtures.find((f) => f.origin === 'league');
    if (!downloaded) throw new Error('no downloaded match');
    const put = (id: string) =>
      call({
        method: 'PUT',
        url: `/api/admin/calendar/fixtures/${id}`,
        payload: { ...FRIENDLY, venue: 'Pala Evangelisti' },
      });
    expect((await put(downloaded.id)).statusCode).toBe(400);
    expect((await call({ method: 'DELETE', url: `/api/admin/calendar/fixtures/${downloaded.id}` })).statusCode).toBe(
      400,
    );
    expect((await put(manualId)).statusCode).toBe(204);
    expect((await fixture(manualId)).venue).toBe('Pala Evangelisti');
    expect((await settings(manualId, { hidden: true })).statusCode).toBe(400);
    // Hidden: out of «Prossima partita» and its link is not active; shown again it works.
    expect((await settings(downloaded.id, { hidden: true })).statusCode).toBe(204);
    expect((await fixture(downloaded.id)).hidden).toBe(true);
    expect((await publicState(downloaded.link?.shortCode ?? '')).status).toBe(404);
    expect((await schedule()).fixtures.some((f) => f.shortUrl === downloaded.link?.shortUrl)).toBe(false);
    expect((await settings(downloaded.id, { hidden: false })).statusCode).toBe(204);
    expect((await publicState(downloaded.link?.shortCode ?? '')).status).toBe(200);
  });

  it('deletes a match added by hand with its link; its .dvw goes back to the ones to confirm', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/admin/calendar/fixtures',
      payload: { ...FRIENDLY, kind: 'cup', startsAt: '2026-10-14T18:00:00.000Z', opponent: 'Coppa Test' },
    });
    const id = res.json<{ id: string }>().id;
    const code = (await fixture(id)).link?.shortCode ?? '';
    expect((await publicState(code)).status).toBe(200);
    expect((await call({ method: 'DELETE', url: `/api/admin/calendar/fixtures/${id}` })).statusCode).toBe(204);
    expect((await publicState(code)).status).toBe(404);
    expect((await calendar()).fixtures.some((f) => f.id === id)).toBe(false);
    // The friendly with its live .dvw: deleted, the .dvw stays (live) to be confirmed.
    expect((await call({ method: 'DELETE', url: `/api/admin/calendar/fixtures/${manualId}` })).statusCode).toBe(204);
    const [row] = await server.database.db.select().from(matches).where(eq(matches.matchKey, 'amichevole-suntory'));
    expect(row).toMatchObject({ clientFixtureId: null, fixtureLink: 'pending', live: true });
    expect((await calendar()).pending.map((p) => p.id)).toContain(row?.id);
  });
});

describe('coverage of the club and broadcast of one match', () => {
  it('defaults to «casa e trasferta»; «solo partite in casa» makes the away matches not broadcast', async () => {
    expect((await call({ url: '/api/admin/club' })).json<ClubResponse>().profile).toEqual({
      series: null,
      coverage: 'homeAndAway',
      teamLogos: 'all',
    });
    const away = (await calendar()).fixtures.find((f) => f.origin === 'league' && f.ourSide === 'away');
    if (!away) throw new Error('no away match');
    expect((await publicState(away.link?.shortCode ?? '')).status).toBe(200);
    expect((await putProfile({ coverage: 'homeOnly', series: 'SuperLega' })).statusCode).toBe(200);
    const after = await fixture(away.id);
    expect(after).toMatchObject({ broadcasted: false, broadcast: 'auto' });
    expect((await publicState(away.link?.shortCode ?? '')).status).toBe(404);
    expect((await schedule()).fixtures.every((f) => f.ourSide === 'home')).toBe(true);
    // A .dvw of that day is never linked to it.
    const row = await send(
      'trasferta-cuneo',
      { home: 'Cuneo Volley', away: 'Sir Safety Perugia', start: '2026-10-18T16:00:00Z' },
      5,
    );
    expect(row.clientFixtureId).toBeNull();
    expect(row.fixtureCandidates?.some((c) => c.clientFixtureId === away.id) ?? false).toBe(false);
    // «Trasmessa» wins over the coverage; «Non trasmessa» too on a home match.
    expect((await settings(away.id, { broadcast: 'on' })).statusCode).toBe(204);
    expect((await fixture(away.id)).broadcasted).toBe(true);
    // Broadcast again: the .dvw waiting for a confirmation is linked to it at once.
    const [relinked] = await server.database.db.select().from(matches).where(eq(matches.id, row.id));
    expect(relinked).toMatchObject({ clientFixtureId: away.id, fixtureLink: 'auto' });
    expect((await publicState(away.link?.shortCode ?? '')).status).toBe(200);
    const home = (await calendar()).fixtures.find((f) => f.origin === 'league' && f.ourSide === 'home');
    if (!home) throw new Error('no home match');
    expect((await settings(home.id, { broadcast: 'off' })).statusCode).toBe(204);
    expect((await fixture(home.id)).broadcasted).toBe(false);
    expect((await settings(home.id, { broadcast: 'auto' })).statusCode).toBe(204);
    expect((await settings(away.id, { broadcast: 'auto' })).statusCode).toBe(204);
    expect((await putProfile({ coverage: 'homeAndAway' })).statusCode).toBe(200);
  });
});

describe('logos of the teams', () => {
  it('uses the logo of the profile for our team, the league for the others, as «Loghi delle squadre» says', async () => {
    const mark = await upload('logo', 64);
    expect((await putProfile({ logoMark: mark.id })).statusCode).toBe(200);
    const first = (await schedule()).fixtures[0];
    if (!first) throw new Error('no match');
    const ours = first.ourSide === 'home' ? first.home : first.away;
    const theirs = first.ourSide === 'home' ? first.away : first.home;
    expect(ours.logoUrl).toBe(mark.url);
    expect(theirs.logoUrl).toMatch(/^\/api\/public\/team-logos\//);
    const standings = (await schedule()).standings?.rows ?? [];
    expect(standings.find((r) => r.ours)?.logoUrl).toBe(mark.url);
    await putProfile({ teamLogos: 'ours' });
    const onlyOurs = (await schedule()).fixtures[0];
    expect(onlyOurs?.[first.ourSide].logoUrl).toBe(mark.url);
    expect(onlyOurs?.[first.ourSide === 'home' ? 'away' : 'home'].logoUrl).toBeNull();
    expect((await schedule()).standings?.rows.filter((r) => !r.ours).every((r) => r.logoUrl === null)).toBe(true);
    await putProfile({ teamLogos: 'none' });
    const none = (await schedule()).fixtures[0];
    expect([none?.home.logoUrl, none?.away.logoUrl]).toEqual([null, null]);
    // The admin always sees every logo.
    expect((await calendar()).fixtures.find((f) => f.startsAt === first.startsAt)?.[first.ourSide].logoUrl).toBe(
      mark.url,
    );
    await putProfile({ teamLogos: 'all' });
  });

  it('changes the logos of one match, and goes back to the default one', async () => {
    const first = (await calendar()).fixtures.find((f) => f.origin === 'league' && f.state === 'scheduled');
    if (!first) throw new Error('no match');
    const opponentSide = first.ourSide === 'home' ? 'away' : 'home';
    const leagueLogo = first[opponentSide].logoUrl;
    const custom = await upload('logo', 70);
    expect((await settings(first.id, { opponentLogo: custom.id })).statusCode).toBe(204);
    expect((await fixture(first.id)).logos.opponent).toEqual({ id: custom.id, url: custom.url });
    expect((await fixture(first.id))[opponentSide].logoUrl).toBe(custom.url);
    expect((await publicState(first.link?.shortCode ?? '')).body).toMatchObject({
      type: 'scheduled',
      fixture: { [opponentSide]: { logoUrl: custom.url } },
    });
    // The image cannot be deleted while a match uses it.
    expect((await call({ method: 'DELETE', url: `/api/admin/assets/${custom.id}` })).statusCode).toBe(409);
    const foreign = await upload('logo', 71, cookieB, HOST_B);
    expect((await settings(first.id, { ourLogo: foreign.id })).statusCode).toBe(400);
    expect((await settings(first.id, {})).statusCode).toBe(400);
    expect((await settings(first.id, { opponentLogo: null })).statusCode).toBe(204);
    expect((await fixture(first.id))[opponentSide].logoUrl).toBe(leagueLogo);
  });

  it('sends the logos of the two sides of the .dvw in its public state', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/admin/calendar/fixtures',
      payload: { ...FRIENDLY, startsAt: '2026-10-13T16:00:00.000Z', opponent: 'Halkbank Ankara' },
    });
    const id = res.json<{ id: string }>().id;
    const custom = await upload('logo', 72);
    await settings(id, { opponentLogo: custom.id });
    const code = (await fixture(id)).link?.shortCode ?? '';
    server.setNow(new Date('2026-10-13T16:05:00.000Z'));
    cookie = await login(server.app, ADMIN);
    const row = await send(
      'amichevole-halkbank',
      { home: 'Sir Susa Scai Perugia', away: 'Halkbank Ankara', start: '2026-10-13T16:00:00Z' },
      10,
    );
    expect(row.clientFixtureId).toBe(id);
    const club = (await call({ url: '/api/admin/club' })).json<ClubResponse>();
    const state = await publicState(code);
    expect(state.body).toMatchObject({ type: 'state', logos: { home: club.logoUrl, away: custom.url } });
  });
});
