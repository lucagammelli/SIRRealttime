import { generateMatch } from '@arenalive/dvw-simulator';
import type { CalendarResponse, ClubTeamsResponse, LeagueSummary, ScheduleResponse } from '@arenalive/shared';
import { ScheduleResponseSchema } from '@arenalive/shared';
import { and, eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFixtures, matches, shareTokens } from '../src/db/index.js';
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
const BEFORE = new Date('2026-10-10T10:00:00Z');

let server: TestServer;
let cookie: string;
let agent: string;
let leagueId: string;
let perugiaId: string;

const call = (options: InjectOptions, who: string | null = cookie, host?: string) =>
  server.app.inject({
    ...options,
    headers: { ...(who ? { cookie: who } : {}), ...(host ? { host } : {}), ...options.headers },
  });

const schedule = async (host?: string) => {
  const res = await call({ url: '/api/public/tenant/schedule' }, null, host);
  expect(res.statusCode).toBe(200);
  return { res, body: ScheduleResponseSchema.parse(res.json<ScheduleResponse>()) };
};

beforeAll(async () => {
  server = await startServer({}, {}, { leagueFetcher: { fetch: superLega2026Fetch() } });
  const superCookie = await login(server.app, SUPERADMIN);
  cookie = await login(server.app, ADMIN);
  const tenantB = await createTenant(server, 'schedule-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  agent = await createAgent(server);
  const created = await call(
    { method: 'POST', url: '/api/admin/leagues', payload: { provider: 'legavolley', externalId: 999, season: 2026 } },
    superCookie,
  );
  leagueId = created.json<LeagueSummary>().id;
  await call({ method: 'POST', url: `/api/admin/leagues/${leagueId}/sync`, payload: {} }, superCookie);
  for (let k = 0; k < 1000; k++) {
    const detail = (await call({ url: `/api/admin/leagues/${leagueId}` }, superCookie)).json<{
      league: LeagueSummary;
    }>();
    if (!detail.league.sync.running) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const teams = (await call({ url: `/api/admin/club/leagues/${leagueId}/teams` })).json<ClubTeamsResponse>().teams;
  const perugia = teams.find((t) => t.name === 'Sir Susa Scai Perugia');
  if (!perugia) throw new Error('Perugia missing');
  perugiaId = perugia.id;
  server.setNow(BEFORE);
}, 30_000);
afterAll(() => server.close());

describe('public schedule', () => {
  it('is empty and valid for a client without a club, with the cache header', async () => {
    const { res, body } = await schedule();
    expect(body).toEqual({ fixtures: [], standings: null });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('lists the next matches with logo and short link, and the standings with the club marked', async () => {
    const put = await call({
      method: 'PUT',
      url: '/api/admin/club',
      payload: { leagues: [{ leagueId, teamId: perugiaId }] },
    });
    expect(put.statusCode).toBe(200);
    const { body } = await schedule();
    expect(body.fixtures).toHaveLength(3);
    expect(body.fixtures[0]).toMatchObject({
      startsAt: '2026-10-18T16:00:00.000Z',
      home: { name: "Acqua Sant'Anna Cuneo" },
      away: { name: 'Sir Susa Scai Perugia', logoUrl: expect.stringMatching(/^\/api\/public\/team-logos\//) as string },
      ourSide: 'away',
      venue: 'Palasport di Cuneo',
      live: false,
    });
    // The link is the one of the match in «Calendario».
    const calendar = (await call({ url: '/api/admin/calendar' })).json<CalendarResponse>();
    expect(body.fixtures[0]?.shortUrl).toBe(calendar.fixtures[0]?.link?.shortUrl);
    expect(body.fixtures[0]?.shortUrl).toMatch(/\/l\/[A-Z0-9]+$/);
    const times = body.fixtures.map((f) => f.startsAt ?? '');
    expect([...times].sort()).toEqual(times);

    const table = body.standings;
    expect(table?.leagueName).toBe('Regular Season SuperLega');
    expect(table?.updatedAt).toEqual(expect.any(String));
    expect(table?.rows).toHaveLength(12);
    expect(table?.rows.filter((r) => r.ours).map((r) => r.teamName)).toEqual(['Sir Susa Scai Perugia']);
    expect(table?.rows.map((r) => r.position)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(table?.rows.every((r) => r.logoUrl?.startsWith('/api/public/team-logos/'))).toBe(true);
  });

  it('keeps the answer for 60 s and reads again after that', async () => {
    const [first] = (await schedule()).body.fixtures;
    await server.database.db
      .update(clientFixtures)
      .set({ status: 'played' })
      .where(
        and(eq(clientFixtures.tenantId, server.tenantId), eq(clientFixtures.startsAt, new Date(first?.startsAt ?? ''))),
      );
    server.setNow(new Date(BEFORE.getTime() + 30_000));
    expect((await schedule()).body.fixtures[0]?.startsAt).toBe(first?.startsAt);
    server.setNow(new Date(BEFORE.getTime() + 61_000));
    const after = (await schedule()).body;
    expect(after.fixtures[0]?.startsAt).not.toBe(first?.startsAt);
    expect(after.fixtures).toHaveLength(3);
  });

  it('never shows a client the club of another one', async () => {
    const { body } = await schedule(HOST_B);
    expect(body).toEqual({ fixtures: [], standings: null });
  });

  it('flags the match being played, then leaves it out when it ends', async () => {
    server.setNow(new Date('2026-10-25T16:00:00Z'));
    // The cache of the previous test is old by now; the match of the day is flagged live as soon as it starts.
    const match = generateMatch({
      seed: 7,
      homeName: 'Sir Susa Scai Perugia',
      awayName: 'Tinet Prata',
      startTime: '2026-10-25T17:00:00Z',
    });
    const send = async (upTo: number) =>
      ingest(server.app, agent, await requestFor('perugia-prata', 0, [], fileAt(match, upTo)));
    expect((await send(30)).json()).toMatchObject({ status: 'ok' });
    const live = (await schedule()).body.fixtures.find((f) => f.home.name === 'Sir Susa Scai Perugia');
    expect(live).toMatchObject({ away: { name: 'Tinet Prata di Pordenone' }, live: true });
    // The match ends: a snapshot with every row; the next call reads the matches again.
    const end = await ingest(
      server.app,
      agent,
      await requestFor('perugia-prata', 1, fileAt(match, 30).scoutLines, fileAt(match, match.lines.length)),
    );
    expect(end.json()).toMatchObject({ status: 'ok' });
    const names = (await schedule()).body.fixtures.map((f) => f.away.name);
    expect(names).not.toContain('Tinet Prata di Pordenone');
  });
  it('leaves out the match of a finished file with a stale date (made from an old template)', async () => {
    await server.database.db.delete(matches).where(eq(matches.tenantId, server.tenantId));
    server.setNow(new Date('2026-10-25T16:00:00Z'));
    const stale = generateMatch({
      seed: 8,
      homeName: 'Sir Susa Scai Perugia',
      awayName: 'Tinet Prata',
      startTime: '2026-10-14T17:00:00Z',
    });
    const first = await ingest(server.app, agent, await requestFor('perugia-stale', 0, [], fileAt(stale, 30)));
    expect(first.json()).toMatchObject({ status: 'ok' });
    // The file date is far from the match of the calendar: not linked while it is played.
    expect((await schedule()).body.fixtures.map((f) => f.away.name)).toContain('Tinet Prata di Pordenone');
    const end = await ingest(
      server.app,
      agent,
      await requestFor('perugia-stale', 1, fileAt(stale, 30).scoutLines, fileAt(stale, stale.lines.length)),
    );
    expect(end.json()).toMatchObject({ status: 'ok' });
    // Finished: linked by the day it is played, so the match just played is not «next» any more.
    server.setNow(new Date('2026-10-25T16:02:00Z'));
    expect((await schedule()).body.fixtures.map((f) => f.away.name)).not.toContain('Tinet Prata di Pordenone');
  });
  it('does not link to the match of today an old file that arrives already finished', async () => {
    await server.database.db.delete(matches).where(eq(matches.tenantId, server.tenantId));
    server.setNow(new Date('2026-10-25T16:10:00Z'));
    const old = generateMatch({
      seed: 9,
      homeName: 'Sir Susa Scai Perugia',
      awayName: 'Tinet Prata',
      startTime: '2026-10-14T17:00:00Z',
    });
    const sent = await ingest(server.app, agent, await requestFor('perugia-old', 0, [], fileAt(old, old.lines.length)));
    expect(sent.json()).toMatchObject({ status: 'ok' });
    server.setNow(new Date('2026-10-25T16:12:00Z'));
    expect((await schedule()).body.fixtures.map((f) => f.away.name)).toContain('Tinet Prata di Pordenone');
  });
  it('leaves out, in the public schedule of the end-of-match pause, the match just played whatever the file says', async () => {
    await server.database.db.delete(matches).where(eq(matches.tenantId, server.tenantId));
    server.setNow(new Date('2026-10-25T19:30:00Z'));
    // Different names and a stale date: no automatic link is possible, only the time says it is the match of 18:00.
    const other = generateMatch({
      seed: 10,
      homeName: 'Squadra Qualunque',
      awayName: 'Altra Squadra',
      startTime: '2026-09-01T17:00:00Z',
    });
    await ingest(server.app, agent, await requestFor('altro', 0, [], fileAt(other, 30)));
    await ingest(
      server.app,
      agent,
      await requestFor('altro', 1, fileAt(other, 30).scoutLines, fileAt(other, other.lines.length)),
    );
    server.setNow(new Date('2026-10-25T19:32:00Z'));
    expect((await schedule()).body.fixtures.map((f) => f.away.name)).not.toContain('Tinet Prata di Pordenone');
  });
  it('leaves out a revoked link at once and an expired one', async () => {
    server.setNow(new Date('2026-11-01T10:00:00Z'));
    const fresh = await login(server.app, ADMIN);
    const { fixtures } = (await schedule()).body;
    const [a, b] = fixtures;
    if (!a?.shortUrl || !b?.shortUrl) throw new Error('links missing');
    const tokenOf = async (startsAt: string) => {
      const [row] = await server.database.db
        .select({ id: shareTokens.id })
        .from(shareTokens)
        .innerJoin(clientFixtures, eq(clientFixtures.id, shareTokens.clientFixtureId))
        .where(eq(clientFixtures.startsAt, new Date(startsAt)));
      if (!row) throw new Error('token missing');
      return row.id;
    };
    const revoke = await call(
      { method: 'DELETE', url: `/api/admin/share-tokens/${await tokenOf(a.startsAt ?? '')}` },
      fresh,
    );
    expect(revoke.statusCode).toBe(204);
    const afterRevoke = (await schedule()).body.fixtures;
    expect(afterRevoke[0]).toMatchObject({ startsAt: a.startsAt, shortUrl: null });
    expect(afterRevoke[1]?.shortUrl).toBe(b.shortUrl);
    await server.database.db
      .update(shareTokens)
      .set({ expiresAt: new Date('2026-11-01T09:00:00Z') })
      .where(eq(shareTokens.id, await tokenOf(b.startsAt ?? '')));
    server.setNow(new Date('2026-11-01T10:02:00Z'));
    expect((await schedule()).body.fixtures[1]?.shortUrl).toBeNull();
  });
});
