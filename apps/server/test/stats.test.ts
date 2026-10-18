import { generateMatch } from '@sir/dvw-simulator';
import type { CreateShareTokenResponse, HelloMessage, IngestRequest } from '@sir/shared';
import { StatsCurveSchema, StatsNowSchema, StatsOverviewSchema } from '@sir/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { matches, pageViews, viewDaily, viewerPeaks } from '../src/db/index.js';
import { writeBatch } from '../src/stats/store.js';
import type { TestServer } from './helpers.js';
import {
  ADMIN,
  createAgent,
  createTenant,
  createUser,
  fileAt,
  ingest,
  login,
  ORIGIN,
  requestFor,
  startServer,
  SUPERADMIN,
  VIEWER,
} from './helpers.js';

const T0 = new Date('2026-10-17T10:00:00.000Z');
const VISIT = 'abcdefghijklmnop1234';

let server: TestServer;
let admin: string;
let baseUrl: string;
let agent: string;
let seq = 0;
const sockets: WebSocket[] = [];

const hello = (over: Partial<HelloMessage> = {}): HelloMessage => ({
  type: 'hello',
  visit: VISIT,
  device: 'phone',
  source: 'qr',
  app: false,
  ...over,
});

const get = (url: string, cookie = admin, host?: string) =>
  server.app.inject({ url, headers: { cookie, ...(host ? { host } : {}) } });

async function matchWithState(key = `gara-${seq++}`): Promise<string> {
  const file = fileAt(generateMatch({ seed: 3 }), 30);
  const body: IngestRequest = await requestFor(key, 0, [], file);
  expect((await ingest(server.app, agent, body)).statusCode).toBe(200);
  const [row] = await server.database.db.select({ id: matches.id }).from(matches).where(eq(matches.matchKey, key));
  if (!row) throw new Error('match missing');
  return row.id;
}

async function link(matchId: string | null, label = 'Tribuna'): Promise<CreateShareTokenResponse> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/admin/share-tokens',
    headers: { cookie: admin, origin: ORIGIN },
    payload: { label, matchId, expiresAt: null },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CreateShareTokenResponse>();
}

/** Opens a public socket (waits for the first message), optionally sends `hello`. */
async function open(token: string, msg: unknown = hello()): Promise<WebSocket> {
  const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/public/${token}`);
  sockets.push(ws);
  const first = new Promise<void>((resolve) => ws.addEventListener('message', () => resolve(), { once: true }));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('connection refused')));
  });
  await first;
  if (msg !== null) ws.send(JSON.stringify(msg));
  return ws;
}

async function viewers(cookie = admin): Promise<number> {
  return StatsNowSchema.parse((await get('/api/admin/stats/now', cookie)).json()).viewers;
}

/** Waits until the server counts `n` spectators connected (the `hello` is processed after the message arrives). */
async function waitViewers(n: number, cookie = admin): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await viewers(cookie)) === n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`viewers never reached ${n}`);
}

/** Closes a socket and waits until the server has seen it close (`left`: spectators still connected). */
async function closeSocket(ws: WebSocket, left = 0): Promise<void> {
  await new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve());
    ws.close();
  });
  await waitViewers(left);
}

beforeAll(async () => {
  server = await startServer({}, {}, { startAt: T0 });
  baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
  admin = await login(server.app, ADMIN);
  agent = await createAgent(server);
});
afterAll(() => server.close());
afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN)
      await new Promise<void>((r) => {
        ws.addEventListener('close', () => r());
        ws.close();
      });
  }
  await new Promise((r) => setTimeout(r, 20));
  server.setNow(T0);
  await server.app.stats.flush(true);
  await server.database.db.delete(pageViews);
  await server.database.db.delete(viewerPeaks);
  await server.database.db.delete(viewDaily);
});

describe('collecting visits', () => {
  it('records one visit with its duration, device, source and app, and nothing personal', async () => {
    const m = await matchWithState();
    const l = await link(m);
    server.setNow(T0);
    const ws = await open(l.token, hello({ device: 'tv', source: 'link', app: true }));
    await waitViewers(1);
    server.setNow(new Date(T0.getTime() + 125_000));
    await closeSocket(ws);
    server.setNow(new Date(T0.getTime() + 200_000));
    await server.app.stats.flush();
    const rows = await server.database.db.select().from(pageViews);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: server.tenantId,
      shareTokenId: l.id,
      matchId: m,
      seconds: 125,
      device: 'tv',
      source: 'link',
      app: true,
      day: '2026-10-17',
    });
    // No IP, user agent or visit id anywhere in the row.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'app',
        'clientFixtureId',
        'day',
        'device',
        'endedAt',
        'id',
        'matchId',
        'seconds',
        'shareTokenId',
        'source',
        'startedAt',
        'tenantId',
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain('127.0.0.1');
    expect(JSON.stringify(rows)).not.toContain(VISIT);
  });

  it('a reconnection within 30 seconds with the same id is the same visit; later it is a new one', async () => {
    const l = await link(await matchWithState());
    server.setNow(T0);
    const first = await open(l.token);
    await waitViewers(1);
    server.setNow(new Date(T0.getTime() + 60_000));
    await closeSocket(first);
    server.setNow(new Date(T0.getTime() + 80_000));
    const second = await open(l.token);
    await waitViewers(1);
    server.setNow(new Date(T0.getTime() + 100_000));
    await closeSocket(second);
    // More than 30 s after the end: written as one visit of 100 s.
    server.setNow(new Date(T0.getTime() + 140_000));
    await server.app.stats.flush();
    let rows = await server.database.db.select().from(pageViews);
    expect(rows.map((r) => r.seconds)).toEqual([100]);
    // Same id after more than 30 s: another visit.
    const third = await open(l.token);
    await waitViewers(1);
    server.setNow(new Date(T0.getTime() + 160_000));
    await closeSocket(third);
    server.setNow(new Date(T0.getTime() + 200_000));
    await server.app.stats.flush();
    rows = await server.database.db.select().from(pageViews);
    expect(rows).toHaveLength(2);
  });

  it('counts one visit per WebSocket connection, ignores a second or invalid hello', async () => {
    const l = await link(await matchWithState());
    const ws = await open(l.token);
    ws.send(JSON.stringify(hello({ visit: 'zzzzzzzzzzzzzzzzzzzz' })));
    ws.send(JSON.stringify({ ...hello(), device: 'fridge' }));
    ws.send(JSON.stringify({ ...hello({ visit: 'short' }) }));
    ws.send(JSON.stringify({ ...hello(), extra: 1 }));
    await waitViewers(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(await viewers()).toBe(1);
    server.setNow(new Date(T0.getTime() + 10_000));
    await closeSocket(ws);
    server.setNow(new Date(T0.getTime() + 60_000));
    await server.app.stats.flush();
    expect(await server.database.db.select().from(pageViews)).toHaveLength(1);
  });

  it('a socket that never says hello is not a visit, and a visit under 3 seconds is not recorded', async () => {
    const l = await link(await matchWithState());
    const silent = await open(l.token, null);
    await new Promise((r) => setTimeout(r, 30));
    expect(await viewers()).toBe(0);
    await closeSocket(silent);
    const quick = await open(l.token);
    await waitViewers(1);
    await closeSocket(quick);
    server.setNow(new Date(T0.getTime() + 60_000));
    await server.app.stats.flush();
    expect(await server.database.db.select().from(pageViews)).toHaveLength(0);
  });

  it('never records a simulated match', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/admin/simulation',
      headers: { cookie: admin, origin: ORIGIN },
      payload: {
        source: { kind: 'generated', sets: 3, seed: 4, clubTeams: false },
        pace: { kind: 'duration', setSeconds: 600, breakSeconds: 600 },
      },
    });
    expect(res.statusCode).toBe(201);
    const code = res.json<{ simulation: { link: { shortCode: string } } }>().simulation.link.shortCode;
    const ws = await open(code);
    await new Promise((r) => setTimeout(r, 50));
    expect(await viewers()).toBe(0);
    server.setNow(new Date(T0.getTime() + 20_000));
    await server.app.stats.tick();
    await closeSocket(ws);
    server.setNow(new Date(T0.getTime() + 100_000));
    await server.app.stats.flush();
    expect(await server.database.db.select().from(pageViews)).toHaveLength(0);
    expect(await server.database.db.select().from(viewerPeaks)).toHaveLength(0);
    await server.app.inject({
      method: 'DELETE',
      url: '/api/admin/simulation',
      headers: { cookie: admin, origin: ORIGIN },
    });
  });
});

describe('writing', () => {
  const visit = (id: string, matchId: string | null) => ({
    id,
    tenantId: '',
    shareTokenId: '00000000-0000-4000-8000-000000000000',
    clientFixtureId: null,
    matchId,
    startedAt: T0,
    endedAt: new Date(T0.getTime() + 60_000),
    seconds: 60,
    device: 'phone' as const,
    source: 'link' as const,
    app: false,
    day: '2026-10-17',
  });

  it('is one transaction and a retry never writes a visit twice', async () => {
    const m = await matchWithState();
    const db = server.database.db;
    const bad = { tenantId: server.tenantId, matchId: m, minute: T0, viewers: 0, day: '2026-10-17' };
    const batch = {
      visits: [
        visit('11111111-1111-4111-8111-111111111111', null),
        visit('22222222-2222-4222-8222-222222222222', null),
      ].map((v) => ({ ...v, tenantId: server.tenantId })),
      // A peak the database refuses (viewers must be > 0): the batch fails after the visits were inserted.
      peaks: [bad],
    };
    await expect(writeBatch(db, batch)).rejects.toThrow();
    expect(await db.select().from(pageViews)).toHaveLength(0);
    const fixed = { ...batch, peaks: [{ ...bad, viewers: 3 }] };
    await writeBatch(db, fixed);
    await writeBatch(db, fixed);
    expect(await db.select().from(pageViews)).toHaveLength(2);
    expect(await db.select().from(viewerPeaks)).toHaveLength(1);
  });

  it('peaks of a deleted match do not end up in the row before the start', async () => {
    await server.database.db.insert(viewDaily).values({
      tenantId: server.tenantId,
      day: '2026-06-01',
      shareTokenId: null,
      matchId: null,
      visits: 0,
      qrVisits: 0,
      appVisits: 0,
      tvVisits: 0,
      tabletVisits: 0,
      phoneVisits: 0,
      seconds: 0,
      peak: 9,
    });
    const overview = StatsOverviewSchema.parse((await get('/api/admin/stats?from=2026-05-01&to=2026-10-31')).json());
    expect(overview.matches).toEqual([]);
    expect(overview.totals.peak).toBe(0);
  });

  it('a hello after the link was revoked opens no visit', async () => {
    const l = await link(await matchWithState());
    const ws = await open(l.token, null);
    await server.app.inject({
      method: 'DELETE',
      url: `/api/admin/share-tokens/${l.id}`,
      headers: { cookie: admin, origin: ORIGIN },
    });
    ws.send(JSON.stringify(hello()));
    await new Promise((r) => setTimeout(r, 100));
    expect(await viewers()).toBe(0);
    server.setNow(new Date(T0.getTime() + 100_000));
    await server.app.stats.flush(true);
    expect(await server.database.db.select().from(pageViews)).toHaveLength(0);
  });
});

describe('peaks and API', () => {
  it('samples the spectators of a match and serves overview, now and curve', async () => {
    const m = await matchWithState();
    const l = await link(m, 'Link tribuna');
    const base = new Date(T0.getTime() + 1_800_000);
    server.setNow(base);
    const a = await open(l.token, hello({ visit: 'aaaaaaaaaaaaaaaaaaaa', source: 'qr', device: 'phone' }));
    const b = await open(l.token, hello({ visit: 'bbbbbbbbbbbbbbbbbbbb', source: 'link', device: 'tablet' }));
    await waitViewers(2);
    const now = StatsNowSchema.parse((await get('/api/admin/stats/now')).json());
    expect(now.matches[0]).toMatchObject({ matchId: m, viewers: 2 });
    expect(now.links[0]).toEqual({ label: 'Link tribuna', viewers: 2 });
    await server.app.stats.tick();
    server.setNow(new Date(base.getTime() + 61_000));
    await closeSocket(b, 1);
    await server.app.stats.tick();
    server.setNow(new Date(base.getTime() + 300_000));
    await closeSocket(a);
    server.setNow(new Date(base.getTime() + 400_000));
    await server.app.stats.flush();

    // Viewer can read.
    const viewer = await login(server.app, VIEWER);
    const res = await get('/api/admin/stats?from=2026-10-01&to=2026-10-31', viewer);
    expect(res.statusCode).toBe(200);
    const overview = StatsOverviewSchema.parse(res.json());
    expect(overview.totals).toMatchObject({ visits: 2, qrVisits: 1, appVisits: 0, peak: 2 });
    expect(overview.totals.peakAt).toBe('2026-10-17T10:30:00.000Z');
    expect(overview.devices).toEqual({ tv: 0, tablet: 1, phone: 1 });
    expect(overview.matches[0]).toMatchObject({ matchId: m, visits: 2, peak: 2 });
    expect(overview.links[0]).toMatchObject({
      shareTokenId: l.id,
      label: 'Link tribuna',
      kind: 'match',
      visits: 2,
      qrVisits: 1,
    });
    expect(overview.daily).toEqual([expect.objectContaining({ day: '2026-10-17', visits: 2, peak: 2 })]);

    const curve = StatsCurveSchema.parse((await get(`/api/admin/stats/matches/${m}/curve`)).json());
    expect(curve.points.map((p) => p.viewers)).toEqual([2, 1]);
  });

  it('validates the period and requires a session', async () => {
    expect((await get('/api/admin/stats?from=2026-13-01')).statusCode).toBe(400);
    expect((await get('/api/admin/stats?from=2026-10-20&to=2026-10-01')).statusCode).toBe(400);
    expect((await get('/api/admin/stats?from=2020-01-01&to=2026-10-01')).statusCode).toBe(400);
    expect((await get('/api/admin/stats?x=1')).statusCode).toBe(400);
    expect((await get('/api/admin/stats/matches/not-a-uuid/curve')).statusCode).toBe(400);
    expect((await server.app.inject({ url: '/api/admin/stats' })).statusCode).toBe(401);
    expect((await server.app.inject({ url: '/api/admin/stats/now' })).statusCode).toBe(401);
    const sup = await login(server.app, SUPERADMIN);
    expect((await get('/api/admin/stats', sup)).statusCode).toBe(409);
  });

  it('keeps the clients apart', async () => {
    const m = await matchWithState();
    const l = await link(m);
    const ws = await open(l.token);
    await waitViewers(1);
    server.setNow(new Date(T0.getTime() + 30_000));
    await server.app.stats.tick();
    await closeSocket(ws);
    server.setNow(new Date(T0.getTime() + 100_000));
    await server.app.stats.flush();

    const other = await createTenant(server, 'altro', ['altro.test']);
    await createUser(server, { email: 'altro@sir.test', password: 'password-altro-1' }, 'admin', other);
    const cookie = await login(server.app, { email: 'altro@sir.test', password: 'password-altro-1' }, 'altro.test');
    const overview = StatsOverviewSchema.parse(
      (await get('/api/admin/stats?from=2026-10-01&to=2026-10-31', cookie, 'altro.test')).json(),
    );
    expect(overview.totals.visits).toBe(0);
    expect(overview.matches).toEqual([]);
    expect(await viewers(cookie)).toBe(0);
    expect((await get(`/api/admin/stats/matches/${m}/curve`, cookie, 'altro.test')).statusCode).toBe(404);
  });
});

describe('retention', () => {
  it('cleans up on its own hourly timer, with LEAGUE_SYNC=off (no scheduler)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const own = await startServer({}, { LEAGUE_SYNC: 'off' }, { startAt: T0 });
    try {
      await own.app.ready();
      const db = own.database.db;
      await db.insert(pageViews).values({
        tenantId: own.tenantId,
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: new Date('2026-01-01T10:05:00Z'),
        seconds: 300,
        device: 'phone',
        source: 'qr',
        app: false,
        day: '2026-01-01',
      });
      own.setNow(new Date(T0.getTime() + 86_400_000));
      await vi.advanceTimersByTimeAsync(3_600_000 + 100);
      for (let i = 0; i < 50 && (await db.select().from(pageViews)).length > 0; i++)
        await new Promise((r) => setImmediate(r));
      expect(await db.select().from(pageViews)).toHaveLength(0);
      expect(await db.select().from(viewDaily)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      await own.close();
    }
  });

  it('turns the detail older than 90 days into daily totals, once, and keeps the recent days', async () => {
    const m = await matchWithState();
    const l = await link(m);
    const db = server.database.db;
    const row = (day: string, seconds: number, source: 'qr' | 'link') => ({
      tenantId: server.tenantId,
      shareTokenId: l.id,
      matchId: m,
      startedAt: new Date(`${day}T10:00:00Z`),
      endedAt: new Date(`${day}T10:10:00Z`),
      seconds,
      device: 'phone',
      source,
      app: false,
      day,
    });
    await db
      .insert(pageViews)
      .values([row('2026-06-01', 100, 'qr'), row('2026-06-01', 300, 'link'), row('2026-10-10', 50, 'qr')]);
    await db.insert(viewerPeaks).values([
      {
        tenantId: server.tenantId,
        matchId: m,
        minute: new Date('2026-06-01T10:03:00Z'),
        viewers: 7,
        day: '2026-06-01',
      },
      {
        tenantId: server.tenantId,
        matchId: m,
        minute: new Date('2026-10-10T10:03:00Z'),
        viewers: 3,
        day: '2026-10-10',
      },
    ]);
    server.setNow(new Date(T0.getTime() + 86_400_000));
    await server.app.stats.housekeeping();
    server.setNow(T0);
    expect((await db.select().from(pageViews)).map((r) => r.day)).toEqual(['2026-10-10']);
    expect((await db.select().from(viewerPeaks)).map((r) => r.day)).toEqual(['2026-10-10']);
    const daily = await db.select().from(viewDaily);
    expect(daily).toHaveLength(2);
    // The totals of the old day are still in the overview (visits, seconds, qr and the peak, without its hour).
    const res = await get('/api/admin/stats?from=2026-05-01&to=2026-10-31');
    expect(res.statusCode, res.body).toBe(200);
    const overview = StatsOverviewSchema.parse(res.json());
    expect(overview.totals).toMatchObject({ visits: 3, qrVisits: 2, totalSeconds: 450, peak: 7 });
    expect(overview.daily.map((d) => [d.day, d.visits, d.peak])).toEqual([
      ['2026-06-01', 2, 7],
      ['2026-10-10', 1, 3],
    ]);
    // A second run on the same day does nothing more.
    await server.app.stats.housekeeping();
    expect(await db.select().from(viewDaily)).toHaveLength(2);
  });
});
