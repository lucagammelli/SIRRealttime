import { generateMatch, planPlayback, renderDvw } from '@arenalive/dvw-simulator';
import type { SimulationResponse, StartSimulationRequest } from '@arenalive/shared';
import { SIMULATION_RETENTION_MS, SimulationResponseSchema } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matches, shareTokens } from '../src/db/index.js';
import { LiveHub } from '../src/hub.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import { insertShareToken } from '../src/shareCodes.js';
import type { SimulationTimers } from '../src/simulation/service.js';
import { SIMULATION_MAX_ACTIVE } from '../src/simulation/service.js';
import { setBreakSeconds } from '../src/simulation/breaks.js';
import { generatedMatch } from '../src/simulation/source.js';
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

const START = new Date('2026-10-17T10:00:00.000Z');

/** Timers of the simulations fired by hand: `advance` moves the clock of the server and runs what is due. */
class FakeTimers implements SimulationTimers {
  private pending: { id: number; fn: () => void; at: number }[] = [];
  private next = 1;
  now = START.getTime();
  server: TestServer | null = null;

  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.push({ id, fn, at: this.now + Math.max(0, ms) });
    return id;
  }

  clear(handle: unknown): void {
    this.pending = this.pending.filter((t) => t.id !== handle);
  }

  get count(): number {
    return this.pending.length;
  }

  private setNow(at: number): void {
    this.now = at;
    this.server?.setNow(new Date(at));
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = this.pending.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.pending = this.pending.filter((t) => t !== due);
      this.setNow(Math.max(this.now, due.at));
      due.fn();
      await this.flush();
    }
    this.setNow(target);
  }

  async flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await this.server?.app.simulations.idle();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

let server: TestServer;
let timers: FakeTimers;
let admin: string;

const DURATION = { kind: 'duration', setSeconds: 20, breakSeconds: 10 } as const;
const GENERATED: StartSimulationRequest = {
  source: { kind: 'generated', sets: 3, seed: 4, clubTeams: false },
  pace: DURATION,
};

beforeEach(async () => {
  timers = new FakeTimers();
  server = await startServer({}, {}, { simulationTimers: timers });
  timers.server = server;
  server.setNow(START);
  admin = await login(server.app, ADMIN);
});
afterEach(() => server.close());

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string = admin, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN },
    ...(method === 'POST' ? { payload: payload ?? {} } : {}),
  });

async function simulation(cookie: string = admin): Promise<SimulationResponse> {
  const res = await call('GET', '/api/admin/simulation', cookie);
  expect(res.statusCode).toBe(200);
  return SimulationResponseSchema.parse(res.json());
}

async function start(body: unknown = GENERATED, cookie: string = admin): Promise<SimulationResponse> {
  const res = await call('POST', '/api/admin/simulation', cookie, body);
  expect(res.statusCode, res.body).toBe(201);
  return SimulationResponseSchema.parse(res.json());
}

const command = (name: string, cookie: string = admin) => call('POST', `/api/admin/simulation/${name}`, cookie);

/** State seen by the public link of the simulation (short code). */
async function publicState(code: string) {
  const res = await server.app.inject({ url: `/api/public/${code}/state` });
  return {
    status: res.statusCode,
    body: res.statusCode === 200 ? res.json<{ type: string; matchId?: string }>() : null,
  };
}

const upload = (text: string | Buffer, fileName = 'partita.dvw'): StartSimulationRequest => ({
  source: { kind: 'upload', fileName, data: Buffer.from(text).toString('base64') },
  pace: DURATION,
});

describe('simulation of a match', () => {
  it('is for the admins of the client: a viewer gets 403, a superadmin needs a client', async () => {
    await createUser(server, { email: 'v2@sir.test', password: VIEWER.password }, 'viewer', server.tenantId);
    const viewer = await login(server.app, VIEWER);
    expect((await call('GET', '/api/admin/simulation', viewer)).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/simulation', viewer, GENERATED)).statusCode).toBe(403);
    expect((await command('pause', viewer)).statusCode).toBe(403);
    expect((await call('DELETE', '/api/admin/simulation', viewer)).statusCode).toBe(403);
    const superadmin = await login(server.app, SUPERADMIN);
    // A superadmin works only on a client chosen (409 without one).
    expect((await call('GET', '/api/admin/simulation', superadmin)).statusCode).toBe(409);
    expect((await call('GET', '/api/admin/simulation')).statusCode).toBe(200);
  });

  it('checks session and role before reading the body of a start (an upload is up to 2.8 MB)', async () => {
    // Over the body limit: a 401/403 instead of a 413 means the body was never read.
    const payload = JSON.stringify({ source: { kind: 'upload', fileName: 'a.dvw', data: 'A'.repeat(4_000_000) } });
    const post = (cookie?: string) =>
      server.app.inject({
        method: 'POST',
        url: '/api/admin/simulation',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
        payload,
      });
    expect((await post()).statusCode).toBe(401);
    expect((await post(await login(server.app, VIEWER))).statusCode).toBe(403);
    expect((await post(admin)).statusCode).toBe(413);
  });

  it('plays a generated match with the duration chosen: pause, resume, stop, restart', async () => {
    const started = (await start()).simulation;
    expect(started).toMatchObject({ status: 'running', source: 'Partita casuale (3 set, seme 4)' });
    // The lines of the start (lineups, all at the same time) go at once.
    const first = started?.linesSent ?? 0;
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThan(10);
    expect(started?.link?.shortUrl).toBe(`${ORIGIN}/l/${started?.link?.shortCode}`);
    expect(started?.totalMs).toBe(3 * 20_000 + 2 * 10_000);
    expect(started?.remainingMs).toBe(80_000);

    await timers.advance(10_000);
    const half = (await simulation()).simulation;
    expect(half?.linesSent).toBeGreaterThan(50);
    expect(half?.set).toBe(1);
    expect(half?.remainingMs).toBe(70_000);

    expect((await command('pause')).statusCode).toBe(200);
    const paused = (await simulation()).simulation;
    await timers.advance(60_000);
    expect((await simulation()).simulation).toMatchObject({
      status: 'paused',
      linesSent: paused?.linesSent,
      remainingMs: 70_000,
    });
    expect(timers.count).toBe(0);
    expect((await command('pause')).statusCode).toBe(409);

    expect((await command('resume')).statusCode).toBe(200);
    await timers.advance(25_000);
    const second = (await simulation()).simulation;
    expect(second?.set).toBe(2);
    expect(second?.setsWon.home ?? 0 + (second?.setsWon.away ?? 0)).toBeGreaterThanOrEqual(0);
    expect((second?.setsWon.home ?? 0) + (second?.setsWon.away ?? 0)).toBe(1);

    expect((await command('stop')).statusCode).toBe(200);
    const stopped = (await simulation()).simulation;
    expect(stopped).toMatchObject({ status: 'stopped', remainingMs: 0 });
    expect(stopped?.deleteAt).toBe(new Date(timers.now + SIMULATION_RETENTION_MS).toISOString());
    await timers.advance(60_000);
    expect((await simulation()).simulation?.linesSent).toBe(stopped?.linesSent);

    expect((await command('restart')).statusCode).toBe(200);
    expect((await simulation()).simulation).toMatchObject({ status: 'running', linesSent: first, set: 1 });
    expect((await simulation()).simulation?.link).toEqual(started?.link);
    await timers.advance(5_000);
    expect((await simulation()).simulation?.linesSent).toBeGreaterThan(10);
  });

  it('ends by itself with the whole match, the same one for the same seed', async () => {
    await start();
    await timers.advance(81_000);
    const done = (await simulation()).simulation;
    const match = generateMatch({ seed: 4, sets: 3 });
    expect(done).toMatchObject({ status: 'finished', linesSent: match.lines.length, linesTotal: match.lines.length });
    const won = match.sets.filter((s) => s.home > s.away).length;
    expect(done?.setsWon).toEqual({ home: won, away: 3 - won });
    expect(timers.count).toBe(0);
    expect((await command('stop')).statusCode).toBe(409);
  });

  it('follows the real rhythm of the lines with a speed', async () => {
    const body = { source: { kind: 'generated', sets: 5, seed: 14 }, pace: { kind: 'speed', speed: 10 } };
    const sim = (await start(body)).simulation;
    // The default «Fine set» pause of the client keeps the next set away for its whole length.
    const plan = planPlayback(
      generatedMatch({ sets: 5, seed: 14 }).timing,
      { kind: 'speed', speed: 10 },
      { minBreakSeconds: (set) => setBreakSeconds({}, set) },
    );
    expect(sim).toMatchObject({ source: 'Partita casuale (5 set, seme 14)', totalMs: plan.totalMs, status: 'running' });
    expect(sim?.homeName).toBe('Pallavolo Città');
    await timers.advance(20_000);
    const due = plan.offsetsMs.filter((ms) => ms <= 20_000).length;
    const now = (await simulation()).simulation;
    expect(now).toMatchObject({ status: 'running', elapsedMs: 20_000, remainingMs: plan.totalMs - 20_000 });
    // Every line due is sent, at most SIMULATION_MIN_SEND_MS later.
    expect(now?.linesSent).toBeGreaterThanOrEqual(plan.offsetsMs.filter((ms) => ms <= 19_750).length);
    expect(now?.linesSent).toBeLessThanOrEqual(due);
  });

  it('with a speed, the break between sets is the «Fine set» pause of the client, 20 s when it is off', () => {
    expect(setBreakSeconds({}, 1)).toBe(89);
    const own = {
      setBreakBySet: {
        '2': { enabled: true, delaySeconds: 2, slides: [{ id: 'a', type: 'setSummary', seconds: 15 }] },
      },
    };
    expect(setBreakSeconds(own, 2)).toBe(17);
    expect(setBreakSeconds(own, 1)).toBe(89);
    expect(setBreakSeconds({ setBreak: { enabled: false } }, 1)).toBe(20);
    expect(setBreakSeconds(null, 1)).toBe(89);
  });

  it('with a speed, no point of the next set comes before the end of the «Fine set» pause', async () => {
    const body = { source: { kind: 'generated', sets: 3, seed: 5 }, pace: { kind: 'speed', speed: 10 } };
    const timing = generatedMatch({ sets: 3, seed: 5 }).timing;
    const plan = planPlayback(
      timing,
      { kind: 'speed', speed: 10 },
      { minBreakSeconds: (set) => setBreakSeconds({}, set) },
    );
    await start(body);
    const end = timing.findIndex((l) => l.kind === 'setEnd');
    expect((plan.offsetsMs[end + 1] ?? 0) - (plan.offsetsMs[end] ?? 0)).toBeGreaterThanOrEqual(89_000);
    expect((await simulation()).simulation?.totalMs).toBe(plan.totalMs);
  });

  it('uses the teams of the club with a generated match: ours and the opponent of the next match', async () => {
    const fixture = await call('POST', '/api/admin/calendar/fixtures', admin, {
      kind: 'friendly',
      startsAt: '2030-01-12T16:00:00.000Z',
      opponent: 'Suntory Sunbirds Osaka',
      opponentLogo: null,
      ourSide: 'away',
      venue: 'Arena',
      venueCity: 'Osaka',
    });
    expect(fixture.statusCode).toBe(201);
    const before = await simulation();
    expect(before.clubTeams?.home).toBe('Suntory Sunbirds Osaka');
    const sim = (await start({ ...GENERATED, source: { kind: 'generated', sets: 4, clubTeams: true } })).simulation;
    expect(sim?.homeName).toBe('Suntory Sunbirds Osaka');
    expect(sim?.awayName).toBe(before.clubTeams?.away);
  });

  it('plays a generated match with the «Andamento della partita» chosen; a value out of its limits is a 400', async () => {
    const profile = { homeStrength: 80, acesPerSet: 3, substitutionsPerSet: 4, timeoutsPerSet: 2 };
    const sim = (await start({ ...GENERATED, source: { kind: 'generated', sets: 4, seed: 21, profile } })).simulation;
    const match = generateMatch({ seed: 21, sets: 4, profile });
    expect(sim?.linesTotal).toBe(match.lines.length);
    expect(sim?.linesTotal).not.toBe(generateMatch({ seed: 21, sets: 4 }).lines.length);
    expect((await command('stop')).statusCode).toBe(200);
    const bad = await call('POST', '/api/admin/simulation', admin, {
      ...GENERATED,
      source: { kind: 'generated', sets: 3, profile: { substitutionsPerSet: 9 } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('is one per client and at most a few in the whole server', async () => {
    await start();
    const again = await call('POST', '/api/admin/simulation', admin, GENERATED);
    expect(again.statusCode).toBe(409);
    for (let i = 1; i < SIMULATION_MAX_ACTIVE; i++) {
      const tenantId = await createTenant(server, `club-${i}`, [`club${i}.test`]);
      await server.app.simulations.start(tenantId, GENERATED);
    }
    const other = await createTenant(server, 'club-pieno', ['pieno.test']);
    await expect(server.app.simulations.start(other, GENERATED)).rejects.toMatchObject({ statusCode: 409 });
    expect((await command('stop')).statusCode).toBe(200);
    await expect(server.app.simulations.start(other, GENERATED)).resolves.toBeDefined();
  });

  it('counts the starts in progress in the limit of the server (two at once: one is refused)', async () => {
    for (let i = 1; i < SIMULATION_MAX_ACTIVE; i++) {
      const tenantId = await createTenant(server, `club-${i}`, [`club${i}.test`]);
      await server.app.simulations.start(tenantId, GENERATED);
    }
    const a = await createTenant(server, 'club-a', ['a.test']);
    const b = await createTenant(server, 'club-b', ['b.test']);
    const results = await Promise.allSettled([
      server.app.simulations.start(a, GENERATED),
      server.app.simulations.start(b, GENERATED),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(server.app.simulations.activeCount()).toBe(SIMULATION_MAX_ACTIVE);
  });

  it('«Elimina» after a restart disconnects the spectators of the link too', async () => {
    const [row] = await server.database.db
      .insert(matches)
      .values({ tenantId: server.tenantId, matchKey: 'simulazione-dopo-riavvio', simulated: true })
      .returning({ id: matches.id });
    const { row: link } = await insertShareToken(server.database.db, 'x'.repeat(40), {
      tenantId: server.tenantId,
      tokenHash: hashToken(generateToken()),
      matchId: row?.id ?? null,
      label: 'Simulazione',
      expiresAt: null,
    });
    const closed = vi.spyOn(LiveHub.prototype, 'closeShareToken');
    expect((await call('DELETE', '/api/admin/simulation')).statusCode).toBe(204);
    expect(closed).toHaveBeenCalledWith(link.id);
    expect(await server.database.db.select().from(shareTokens)).toEqual([]);
    closed.mockRestore();
  });

  it('keeps every client to its own simulation', async () => {
    const otherId = await createTenant(server, 'altro', ['altro.test']);
    const otherAdmin = { email: 'admin@altro.test', password: ADMIN.password };
    await createUser(server, otherAdmin, 'admin', otherId);
    const other = await login(server.app, otherAdmin, 'altro.test');
    const mine = (await start()).simulation;
    const theirs = await server.app.inject({
      url: '/api/admin/simulation',
      headers: { cookie: other, host: 'altro.test' },
    });
    expect(SimulationResponseSchema.parse(theirs.json()).simulation).toBeNull();
    const stop = await server.app.inject({
      method: 'POST',
      url: '/api/admin/simulation/stop',
      headers: { cookie: other, host: 'altro.test', origin: 'http://altro.test' },
      payload: {},
    });
    expect(stop.statusCode).toBe(404);
    expect((await simulation()).simulation?.status).toBe('running');
    // The link of the simulation does not work on the hostnames of another client.
    const code = mine?.link?.shortCode ?? '';
    expect(
      (await server.app.inject({ url: `/api/public/${code}/state`, headers: { host: 'altro.test' } })).statusCode,
    ).toBe(404);
  });

  it('stays out of the live match, the channel, the lists and the calendar', async () => {
    // A manual match of the calendar: the `.dvw` of an agent is looked for in it, the simulation never.
    await call('POST', '/api/admin/calendar/fixtures', admin, {
      kind: 'friendly',
      startsAt: '2025-01-18T18:00:00.000Z',
      opponent: 'Volley Club Lugo',
      opponentLogo: null,
      ourSide: 'away',
      venue: 'Palazzetto',
      venueCity: 'Lugo',
    });
    const channelRes = await call('POST', '/api/admin/share-tokens', admin, {
      label: 'Canale',
      matchId: null,
      expiresAt: null,
    });
    const channel = channelRes.json<{ shortCode: string }>().shortCode;
    expect((await publicState(channel)).body?.type).toBe('noMatch');

    const sim = (await start()).simulation;
    await timers.advance(5_000);
    const code = sim?.link?.shortCode ?? '';
    expect(await publicState(code)).toMatchObject({
      status: 200,
      body: { type: 'state', matchId: sim?.matchId, simulated: true },
    });
    expect((await publicState(channel)).body?.type).toBe('noMatch');

    const [row] = await server.database.db
      .select()
      .from(matches)
      .where(eq(matches.id, sim?.matchId ?? ''));
    expect(row).toMatchObject({
      simulated: true,
      live: false,
      liveSince: null,
      clientFixtureId: null,
      fixtureLink: null,
      agentId: null,
    });

    const list = await call('GET', '/api/admin/matches');
    expect(list.json()).toEqual([]);
    expect((await call('GET', `/api/admin/matches/${sim?.matchId}`)).statusCode).toBe(404);
    const links = (await call('GET', '/api/admin/share-tokens')).json<{ label: string }[]>();
    expect(links.map((l) => l.label)).not.toContain('Simulazione');
    expect(links).toHaveLength(2);
    const fixed = await call('POST', '/api/admin/share-tokens', admin, {
      label: 'x',
      matchId: sim?.matchId,
      expiresAt: null,
    });
    expect(fixed.statusCode).toBe(400);
    const calendar = (await call('GET', '/api/admin/calendar')).json<{ pending: unknown[] }>();
    expect(calendar.pending).toEqual([]);

    // A match of an agent becomes live and takes the channel; the simulation does not touch it.
    const token = await createAgent(server);
    const match = generateMatch({ seed: 2, homeName: 'Pallavolo Città', awayName: 'Volley Club Lugo' });
    const res = await ingest(server.app, token, await requestFor('vera', 1, [], fileAt(match, 30)));
    expect(res.statusCode).toBe(200);
    await timers.advance(10_000);
    const [real] = await server.database.db.select().from(matches).where(eq(matches.matchKey, 'vera'));
    expect(real?.live).toBe(true);
    expect(real?.fixtureLink).not.toBeNull();
    const shown = await publicState(channel);
    expect(shown.body).toMatchObject({ type: 'state', matchId: real?.id });
    expect(shown.body).not.toHaveProperty('simulated');

    // An agent cannot write on the simulated match.
    const intruder = await ingest(server.app, token, await requestFor(row?.matchKey ?? '', 1000, [], fileAt(match, 3)));
    expect(intruder.statusCode).toBe(409);
  });

  it('is deleted with its link 6 hours after its end, or with «Elimina»', async () => {
    const sim = (await start()).simulation;
    const code = sim?.link?.shortCode ?? '';
    await timers.advance(3_000);
    expect((await command('stop')).statusCode).toBe(200);
    await timers.advance(SIMULATION_RETENTION_MS - 1000);
    expect(await server.app.simulations.sweep()).toBe(0);
    expect((await publicState(code)).status).toBe(200);
    await timers.advance(2000);
    expect(await server.app.simulations.sweep()).toBe(1);
    expect((await publicState(code)).status).toBe(404);
    expect((await simulation()).simulation).toBeNull();
    expect(await server.database.db.select().from(shareTokens)).toEqual([]);

    // A simulated match left by a restart (no replay in memory) goes too.
    await server.database.db.insert(matches).values({
      tenantId: server.tenantId,
      matchKey: 'simulazione-vecchia',
      simulated: true,
      updatedAt: new Date(timers.now - SIMULATION_RETENTION_MS - 1),
    });
    const left = (await simulation()).simulation;
    expect(left).toMatchObject({ status: 'stopped', pace: null });
    expect(left?.notice).toContain('riavvio');
    expect(await server.app.simulations.sweep()).toBe(1);

    await start();
    expect((await call('DELETE', '/api/admin/simulation')).statusCode).toBe(204);
    expect((await simulation()).simulation).toBeNull();
    expect(timers.count).toBe(0);
    expect((await call('DELETE', '/api/admin/simulation')).statusCode).toBe(404);
  });

  it('reads an uploaded .dvw as the agent does: Windows-1252, malformed lines kept, bad files refused', async () => {
    const match = generateMatch({ seed: 6, homeName: 'Città di Castello', awayName: 'Lugo' });
    const text = Buffer.from(renderDvw(match, match.lines.length)).toString('latin1');
    // A line DataVolley never wrote: it becomes an `unknown` action, the match goes on.
    const broken = text.replace('[3SCOUT]\r\n', '[3SCOUT]\r\n###riga rotta;;;\r\n');
    const sim = (await start(upload(Buffer.from(broken, 'latin1'), 'mia partita.dvw'))).simulation;
    expect(sim).toMatchObject({
      source: 'File: mia partita.dvw',
      homeName: 'Città di Castello',
      linesTotal: match.lines.length + 1,
    });
    await timers.advance(81_000);
    expect((await simulation()).simulation?.status).toBe('finished');
    expect((await command('stop')).statusCode).toBe(409);

    const refused = async (body: unknown) => (await call('POST', '/api/admin/simulation', admin, body)).statusCode;
    expect(await refused(upload('non è un file di DataVolley'))).toBe(422);
    expect(await refused(upload('[3MATCH]\r\n[3SCOUT]\r\n'))).toBe(422);
    expect(await refused(upload(`[3SCOUT]\r\n${'x'.repeat(3000)}\r\n`))).toBe(422);
    expect(await refused({ ...upload('x'), source: { kind: 'upload', fileName: 'a.dvw', data: '%%%' } })).toBe(400);
    const huge = { source: { kind: 'upload', fileName: 'a.dvw', data: 'A'.repeat(2_900_000) }, pace: DURATION };
    expect(await refused(huge)).toBe(413);
    expect(await refused({ source: { kind: 'example', exampleId: 'tre-set' }, pace: DURATION })).toBe(400);
    expect(await refused({ source: { kind: 'generated', sets: 3 }, pace: { kind: 'speed', speed: 7 } })).toBe(400);
  });

  it('clears its timers when the server closes', async () => {
    await start();
    expect(timers.count).toBe(1);
    await server.app.simulations.close();
    expect(timers.count).toBe(0);
  });
});
