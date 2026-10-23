import { generateMatch } from '@arenalive/dvw-simulator';
import type {
  CalendarResponse,
  ClubFixture,
  ClubResponse,
  ClubTeamsResponse,
  LeagueDetailResponse,
  LeagueSummary,
  ServerMessage,
  ShareTokenSummary,
} from '@arenalive/shared';
import { and, eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { relinkPending } from '../src/club.js';
import { clientFixtures, fixtures, matches, shareTokens } from '../src/db/index.js';
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
} from './helpers.js';
import { superLega2026Fetch } from './leagueFixtures.js';

const HOST_B = 'b.test';
const ADMIN_B = { email: 'admin-b@sir.test', password: 'password-admin-b' };

let server: TestServer;
let superCookie: string;
let cookie: string;
let cookieB: string;
let tenantB: string;
let agent1: string;
let agent2: string;
let agentB: string;
let leagueId: string;
let perugiaId: string;

const call = (options: InjectOptions, who: string | null = cookie, host?: string) =>
  server.app.inject({
    ...options,
    headers: { ...(who ? { cookie: who } : {}), ...(host ? { host } : {}), ...options.headers },
  });

const calendar = async (who = cookie, host?: string): Promise<CalendarResponse> => {
  const res = await call({ url: '/api/admin/calendar' }, who, host);
  expect(res.statusCode).toBe(200);
  return res.json<CalendarResponse>();
};

const byExternal = async (externalId: string): Promise<ClubFixture> => {
  const [row] = await server.database.db
    .select({ id: clientFixtures.id })
    .from(clientFixtures)
    .where(and(eq(clientFixtures.tenantId, server.tenantId), eq(clientFixtures.fixtureExternalId, externalId)));
  const found = (await calendar()).fixtures.find((f) => f.id === row?.id);
  if (!found) throw new Error(`fixture ${externalId} missing`);
  return found;
};

const publicState = async (code: string, host?: string) => {
  const res = await call({ url: `/api/public/${code}/state` }, null, host);
  return { status: res.statusCode, body: res.statusCode === 200 ? res.json<ServerMessage>() : null };
};

/** Waits for the end of the background update of the championship (polling outside a test). */
async function settled(): Promise<void> {
  for (let k = 0; k < 1000; k++) {
    const sync = (await call({ url: `/api/admin/leagues/${leagueId}` }, superCookie)).json<LeagueDetailResponse>()
      .league.sync;
    if (!sync.running) {
      if (sync.status !== 'ok') throw new Error(`update failed: ${sync.message ?? ''}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('update never ended');
}

const sent = new Map<string, { lines: string[]; seq: number }>();

/** Sends a simulated match (teams and start chosen) up to `upTo` rows with an agent; returns its id. */
async function send(
  token: string,
  matchKey: string,
  options: { home: string; away: string; start: string; seed?: number },
  upTo: number,
): Promise<string> {
  const prev = sent.get(matchKey) ?? { lines: [], seq: 0 };
  const match = generateMatch({
    seed: options.seed ?? 7,
    homeName: options.home,
    awayName: options.away,
    startTime: options.start,
  });
  const file = fileAt(match, Math.min(upTo, match.lines.length));
  const res = await ingest(server.app, token, await requestFor(matchKey, prev.seq, prev.lines, file));
  expect(res.json()).toMatchObject({ status: 'ok' });
  sent.set(matchKey, { lines: file.scoutLines, seq: prev.seq + 1 });
  const [row] = await server.database.db.select({ id: matches.id }).from(matches).where(eq(matches.matchKey, matchKey));
  if (!row) throw new Error('match missing');
  return row.id;
}

const matchRow = async (id: string) => {
  const [row] = await server.database.db.select().from(matches).where(eq(matches.id, id));
  if (!row) throw new Error('match missing');
  return row;
};

/** WebSocket of a public link, collecting its messages from the very first one. */
function openSocket(path: string, messages: ServerMessage[]): Promise<WebSocket> {
  return server.app.injectWS(
    path,
    {},
    {
      onInit: (ws) => {
        ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString()) as ServerMessage));
      },
    },
  );
}

const CUNEO_PERUGIA = { home: 'Cuneo Volley', away: 'Sir Safety Perugia', start: '2026-10-18T16:00:00Z' };
const PERUGIA_PRATA = { home: 'Sir Susa Scai Perugia', away: 'Tinet Prata', start: '2026-10-25T17:00:00Z' };
/** Same names and day as the real file of the friendly match with Suntory (08/10/2026). */
const PERUGIA_SUNTORY = {
  home: 'Sir Susa Scai Perugia_Amichevoli',
  away: 'SUNTORY SUNBIRDS OSAKA',
  start: '2026-10-08T16:00:00Z',
};

beforeAll(async () => {
  server = await startServer({}, {}, { leagueFetcher: { fetch: superLega2026Fetch() } });
  superCookie = await login(server.app, SUPERADMIN);
  cookie = await login(server.app, ADMIN);
  tenantB = await createTenant(server, 'club-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
  agent1 = await createAgent(server);
  agent2 = await createAgent(server);
  agentB = await createAgent(server, false, tenantB);
  // The superadmin adds the SuperLega 2026/27 and downloads it.
  const created = await call(
    { method: 'POST', url: '/api/admin/leagues', payload: { provider: 'legavolley', externalId: 999, season: 2026 } },
    superCookie,
  );
  expect(created.statusCode).toBe(201);
  leagueId = created.json<LeagueSummary>().id;
  await call({ method: 'POST', url: `/api/admin/leagues/${leagueId}/sync`, payload: {} }, superCookie);
  await settled();
}, 30_000);
afterAll(() => server.close());

describe('club of a client', () => {
  it('lists the known championships and their teams to an admin, without changing anything', async () => {
    const club = await call({ url: '/api/admin/club' });
    expect(club.statusCode).toBe(200);
    const body = club.json<ClubResponse>();
    expect(body.leagues).toEqual([]);
    expect(body.available).toEqual([expect.objectContaining({ id: leagueId, externalId: 999, season: 2026 })]);
    const teams = (await call({ url: `/api/admin/club/leagues/${leagueId}/teams` })).json<ClubTeamsResponse>().teams;
    expect(teams).toHaveLength(12);
    const perugia = teams.find((t) => t.name === 'Sir Susa Scai Perugia');
    if (!perugia) throw new Error('Perugia missing');
    perugiaId = perugia.id;
    expect(perugia).toMatchObject({
      city: 'Perugia (PG)',
      logoUrl: expect.stringMatching(/^\/api\/public\/team-logos\//) as string,
    });
    // A viewer and an anonymous request get nothing; adding a championship stays for the superadmin.
    expect((await call({ url: '/api/admin/club' }, null)).statusCode).toBe(401);
    const add = await call({
      method: 'POST',
      url: '/api/admin/leagues',
      payload: { provider: 'legavolley', externalId: 1000, season: 2026 },
    });
    expect(add.statusCode).toBe(403);
  });

  it('refuses a championship or a team that does not exist, or a team of another championship', async () => {
    const put = (payload: Record<string, unknown>) => call({ method: 'PUT', url: '/api/admin/club', payload });
    expect((await put({ leagues: [{ leagueId: perugiaId, teamId: null }] })).statusCode).toBe(400);
    expect((await put({ leagues: [{ leagueId, teamId: leagueId }] })).statusCode).toBe(400);
    expect(
      (
        await put({
          leagues: [
            { leagueId, teamId: null },
            { leagueId, teamId: null },
          ],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('copies the matches of the team of the club with a public link each, and sets «nostra squadra»', async () => {
    const res = await call({
      method: 'PUT',
      url: '/api/admin/club',
      payload: { leagues: [{ leagueId, teamId: perugiaId }] },
    });
    expect(res.statusCode).toBe(200);
    const club = res.json<ClubResponse>();
    expect(club.leagues).toEqual([
      expect.objectContaining({
        league: expect.objectContaining({ id: leagueId }) as unknown,
        team: expect.objectContaining({ id: perugiaId }) as unknown,
      }),
    ]);
    expect(club.ourTeam).toEqual({ code: null, name: 'Perugia' });
    const list = await calendar();
    expect(list.fixtures).toHaveLength(22);
    expect(list.fixtures.every((f) => f.link?.shortUrl?.includes('/l/') && f.state === 'scheduled')).toBe(true);
    const first = list.fixtures[0];
    expect(first).toMatchObject({
      startsAt: '2026-10-18T16:00:00.000Z',
      home: { name: "Acqua Sant'Anna Cuneo" },
      away: { name: 'Sir Susa Scai Perugia', logoUrl: expect.any(String) as string },
      ourSide: 'away',
      venue: 'Palasport di Cuneo',
      roundLabel: '1ª Giornata Andata',
      league: { id: leagueId, name: 'Regular Season SuperLega', season: 2026 },
      inCalendar: true,
    });
    const links = (await call({ url: '/api/admin/share-tokens' })).json<ShareTokenSummary[]>();
    expect(links.find((l) => l.clientFixtureId === first?.id)).toMatchObject({
      label: "Acqua Sant'Anna Cuneo – 18/10/2026",
      matchId: null,
    });
  });

  it('is idempotent: saving again and updating the calendar keep the same matches and links', async () => {
    const before = await calendar();
    await call({ method: 'PUT', url: '/api/admin/club', payload: { leagues: [{ leagueId, teamId: perugiaId }] } });
    const sync = await call({ method: 'POST', url: '/api/admin/club/sync', payload: {} });
    expect(sync.statusCode).toBe(202);
    expect(sync.json()).toEqual({ started: 1, busy: 0 });
    await expect
      .poll(async () => (await call({ url: '/api/admin/club' })).json<ClubResponse>().leagues[0]?.league.sync.running, {
        timeout: 20_000,
        interval: 50,
      })
      .toBe(false);
    const after = await calendar();
    expect(after.fixtures.map((f) => [f.id, f.link?.id, f.link?.shortCode])).toEqual(
      before.fixtures.map((f) => [f.id, f.link?.id, f.link?.shortCode]),
    );
    const rows = await server.database.db
      .select({ id: shareTokens.id })
      .from(shareTokens)
      .where(eq(shareTokens.tenantId, server.tenantId));
    expect(rows).toHaveLength(22);
  });

  it('keeps the link of a match no longer in the calendar, marked as such', async () => {
    const n61 = await byExternal('n61');
    await server.database.db
      .delete(fixtures)
      .where(and(eq(fixtures.leagueId, leagueId), eq(fixtures.externalId, 'n61')));
    await call({ method: 'PUT', url: '/api/admin/club', payload: { leagues: [{ leagueId, teamId: perugiaId }] } });
    const removed = await byExternal('n61');
    expect(removed).toMatchObject({ state: 'removed', inCalendar: false, link: { id: n61.link?.id } });
    const code = removed.link?.shortCode ?? '';
    expect(await publicState(code)).toMatchObject({
      status: 200,
      body: { type: 'scheduled', fixture: { inCalendar: false, away: { name: 'Pallavolo Padova' } } },
    });
  });
});

describe('link of a match of the calendar', () => {
  let n5: ClubFixture;
  let matchN5: string;

  it('shows «Prossima partita» before the match, also over WebSocket', async () => {
    n5 = await byExternal('n5');
    expect(await publicState(n5.link?.shortCode ?? '')).toMatchObject({
      status: 200,
      body: {
        type: 'scheduled',
        fixture: {
          startsAt: '2026-10-18T16:00:00.000Z',
          home: { name: "Acqua Sant'Anna Cuneo" },
          ourSide: 'away',
          venue: 'Palasport di Cuneo',
          status: 'scheduled',
          inCalendar: true,
        },
      },
    });
  });

  it('links the .dvw of the day by itself and turns into the live match', async () => {
    const messages: ServerMessage[] = [];
    const ws = await openSocket(`/ws/public/${n5.link?.shortCode ?? ''}`, messages);
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toMatchObject({ type: 'scheduled' });
    matchN5 = await send(agent1, 'cuneo-perugia', CUNEO_PERUGIA, 40);
    expect(await matchRow(matchN5)).toMatchObject({ fixtureLink: 'auto', clientFixtureId: n5.id, live: true });
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[1]).toMatchObject({ type: 'state', matchId: matchN5 });
    ws.terminate();
    expect((await byExternal('n5')).state).toBe('live');
  });

  it('keeps two live matches of two agents of the client on their own links', async () => {
    const n7 = await byExternal('n7');
    const matchN7 = await send(agent2, 'perugia-prata', PERUGIA_PRATA, 30);
    expect(await matchRow(matchN7)).toMatchObject({ fixtureLink: 'auto', clientFixtureId: n7.id, live: true });
    // Both live: one court does not switch the other off.
    expect((await matchRow(matchN5)).live).toBe(true);
    await send(agent1, 'cuneo-perugia', CUNEO_PERUGIA, 60);
    expect((await matchRow(matchN7)).live).toBe(true);
    expect(await publicState(n5.link?.shortCode ?? '')).toMatchObject({ body: { type: 'state', matchId: matchN5 } });
    expect(await publicState(n7.link?.shortCode ?? '')).toMatchObject({ body: { type: 'state', matchId: matchN7 } });
    // The live link of the client follows the match that became live last.
    const live = await call({
      method: 'POST',
      url: '/api/admin/share-tokens',
      payload: { label: 'Segue la live', matchId: null, expiresAt: null },
    });
    expect(await publicState(live.json<{ token: string }>().token)).toMatchObject({
      body: { type: 'state', matchId: matchN7 },
    });
  });

  it('stays on the finished match after the end', async () => {
    await send(agent1, 'cuneo-perugia', CUNEO_PERUGIA, 10_000);
    const finished = await publicState(n5.link?.shortCode ?? '');
    expect(finished.body).toMatchObject({ type: 'state', matchId: matchN5 });
    expect(finished.body?.type === 'state' && finished.body.state.status).toBe('finished');
    expect((await byExternal('n5')).state).toBe('finished');
  });
});

describe('.dvw to confirm', () => {
  let friendly: string;

  it('puts a friendly match out of the calendar among the ones to confirm, with its own links as today', async () => {
    friendly = await send(agent1, 'perugia-suntory', PERUGIA_SUNTORY, 20);
    expect(await matchRow(friendly)).toMatchObject({
      fixtureLink: 'pending',
      clientFixtureId: null,
      fixtureCandidates: [],
      live: true,
    });
    const list = await calendar();
    expect(list.pending).toEqual([
      expect.objectContaining({
        id: friendly,
        homeName: 'Sir Susa Scai Perugia_Amichevoli',
        awayName: 'SUNTORY SUNBIRDS OSAKA',
        date: '2026-10-08',
        candidates: [],
      }),
    ]);
    // The linked matches stay live: the friendly is in the group of the matches without a match of the calendar.
    expect((await matchRow((await byExternal('n7')).match?.id ?? '')).live).toBe(true);
  });

  it('lets the admin choose «nessuna (amichevole)» or a match of the calendar', async () => {
    const none = await call({
      method: 'PUT',
      url: `/api/admin/matches/${friendly}/fixture`,
      payload: { clientFixtureId: null },
    });
    expect(none.statusCode).toBe(204);
    expect(await matchRow(friendly)).toMatchObject({ fixtureLink: 'none', clientFixtureId: null });
    expect((await calendar()).pending).toEqual([]);
    const n15 = await byExternal('n15');
    const messages: ServerMessage[] = [];
    const ws = await openSocket(`/ws/public/${n15.link?.shortCode ?? ''}`, messages);
    await expect.poll(() => messages.length).toBe(1);
    const linked = await call({
      method: 'PUT',
      url: `/api/admin/matches/${friendly}/fixture`,
      payload: { clientFixtureId: n15.id },
    });
    expect(linked.statusCode).toBe(204);
    expect(await matchRow(friendly)).toMatchObject({ fixtureLink: 'manual', clientFixtureId: n15.id });
    // The spectators of that link get the match at once.
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[1]).toMatchObject({ type: 'state', matchId: friendly });
    ws.terminate();
  });
});

describe('confirmation of a live .dvw', () => {
  it('never switches off the .dvw already live on the chosen match of the calendar', async () => {
    const n7 = await byExternal('n7');
    const onAir = n7.match?.id ?? '';
    expect((await matchRow(onAir)).live).toBe(true);
    const second = await send(agent2, 'seconda-amichevole', { ...PERUGIA_SUNTORY, seed: 9 }, 15);
    expect(await matchRow(second)).toMatchObject({ fixtureLink: 'pending', live: true });
    const res = await call({
      method: 'PUT',
      url: `/api/admin/matches/${second}/fixture`,
      payload: { clientFixtureId: n7.id },
    });
    expect(res.statusCode).toBe(204);
    // Linked, but not live: the court on air keeps the link of the match.
    expect(await matchRow(second)).toMatchObject({ fixtureLink: 'manual', clientFixtureId: n7.id, live: false });
    expect((await matchRow(onAir)).live).toBe(true);
    expect(await publicState(n7.link?.shortCode ?? '')).toMatchObject({ body: { type: 'state', matchId: onAir } });
  });

  it('keeps a .dvw unlinked by hand unlinked: new rows and the search of the pending ones leave it alone', async () => {
    const n5 = await byExternal('n5');
    const matchN5 = n5.match?.id ?? '';
    expect(matchN5).not.toBe('');
    const res = await call({
      method: 'PUT',
      url: `/api/admin/matches/${matchN5}/fixture`,
      payload: { clientFixtureId: null },
    });
    expect(res.statusCode).toBe(204);
    expect(await matchRow(matchN5)).toMatchObject({ fixtureLink: 'none', clientFixtureId: null });
    expect((await byExternal('n5')).match).toBeNull();
    await send(agent1, 'cuneo-perugia', CUNEO_PERUGIA, 90);
    await server.database.db.transaction((tx) => relinkPending(tx, server.tenantId));
    expect(await matchRow(matchN5)).toMatchObject({ fixtureLink: 'none', clientFixtureId: null });
    expect((await calendar()).pending).not.toContainEqual(expect.objectContaining({ id: matchN5 }));
    expect((await byExternal('n5')).match).toBeNull();
  });

  it('proposes candidates with the same similarity always in the same order', async () => {
    const [n5] = await server.database.db
      .select()
      .from(clientFixtures)
      .where(and(eq(clientFixtures.tenantId, server.tenantId), eq(clientFixtures.fixtureExternalId, 'n5')));
    if (!n5) throw new Error('n5 missing');
    // A copy of the same match (same day and teams): the link cannot choose between the two.
    const { id: _id, ...copy } = n5;
    const [twin] = await server.database.db
      .insert(clientFixtures)
      .values({ ...copy, fixtureExternalId: 'n5-copia', fixtureId: null })
      .returning({ id: clientFixtures.id });
    const doubtful = await send(agent2, 'cuneo-perugia-bis', { ...CUNEO_PERUGIA, seed: 3 }, 5);
    const row = await matchRow(doubtful);
    expect(row.fixtureLink).toBe('pending');
    expect(row.fixtureCandidates?.map((c) => c.clientFixtureId)).toEqual([n5.id, twin?.id ?? ''].sort());
  });
});

describe('isolation between clients', () => {
  it('shows another client nothing of the club and its calendar', async () => {
    const club = (await call({ url: '/api/admin/club' }, cookieB, HOST_B)).json<ClubResponse>();
    expect(club.leagues).toEqual([]);
    expect(await calendar(cookieB, HOST_B)).toEqual({ fixtures: [], pending: [] });
  });

  it('never links a .dvw of a client to a match of another client', async () => {
    const n19 = await byExternal('n19');
    // The same names and day of a match of the club of the predefined client, sent by an agent of B.
    const matchB = await send(
      agentB,
      'perugia-cisterna',
      { home: 'Perugia', away: 'Cisterna', start: '2026-11-04T19:30:00Z' },
      10,
    );
    expect(await matchRow(matchB)).toMatchObject({ fixtureLink: null, clientFixtureId: null });
    const put = await call(
      { method: 'PUT', url: `/api/admin/matches/${matchB}/fixture`, payload: { clientFixtureId: n19.id } },
      cookieB,
      HOST_B,
    );
    expect(put.statusCode).toBe(400);
    const other = await call(
      { method: 'PUT', url: `/api/admin/matches/${matchB}/fixture`, payload: { clientFixtureId: null } },
      cookie,
    );
    expect(other.statusCode).toBe(404);
    // The link of the match of the calendar works only on the hostnames of its client.
    expect((await publicState(n19.link?.shortCode ?? '', HOST_B)).status).toBe(404);
  });
});
