import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMatch } from '@arenalive/dvw-simulator';
import type {
  DisplayConfigFile,
  DisplayHeartbeatResponse,
  DisplaySocketMessage,
  DisplaySummary,
} from '@arenalive/shared';
import { DISPLAY_LIMIT, DisplayConfigFileSchema, DisplaySummarySchema } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFixtures, displays } from '../src/db/index.js';
import { displayTargetOf, isForeignKeyViolation } from '../src/displays.js';
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
  VIEWER,
} from './helpers.js';

const HOST_B = 'b.player.test';
const ADMIN_B = { email: 'admin-b@player.test', password: 'password-admin-b' };
const WIFI_PASSWORD = 'password-wifi-segreta';

let server: TestServer;
let admin: string;
let viewer: string;
let adminB: string;
let tenantB: string;
let baseUrl: string;
let downloadDir: string;

beforeAll(async () => {
  downloadDir = mkdtempSync(join(tmpdir(), 'sir-player-'));
  server = await startServer({}, { PLAYER_DOWNLOAD_DIR: downloadDir });
  admin = await login(server.app, ADMIN);
  viewer = await login(server.app, VIEWER);
  tenantB = await createTenant(server, 'player-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  adminB = await login(server.app, ADMIN_B, HOST_B);
  baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await server.close();
  rmSync(downloadDir, { recursive: true, force: true });
});

const api = (cookie: string) => ({
  create: (name: string) =>
    server.app.inject({ method: 'POST', url: '/api/admin/displays', headers: { cookie }, payload: { name } }),
  list: () => server.app.inject({ url: '/api/admin/displays', headers: { cookie } }),
  patch: (id: string, payload: Record<string, unknown>) =>
    server.app.inject({ method: 'PATCH', url: `/api/admin/displays/${id}`, headers: { cookie }, payload }),
  revoke: (id: string) =>
    server.app.inject({ method: 'DELETE', url: `/api/admin/displays/${id}`, headers: { cookie } }),
  command: (id: string, command: string) =>
    server.app.inject({
      method: 'POST',
      url: `/api/admin/displays/${id}/command`,
      headers: { cookie },
      payload: { command },
    }),
  config: (id: string, payload: Record<string, unknown> = {}) =>
    server.app.inject({ method: 'POST', url: `/api/admin/displays/${id}/config`, headers: { cookie }, payload }),
});

async function newDisplay(name = 'Maxischermo', cookie = admin): Promise<DisplaySummary> {
  const res = await api(cookie).create(name);
  expect(res.statusCode).toBe(201);
  return DisplaySummarySchema.parse(res.json());
}

/** Downloads the configuration of a player and returns the file. */
async function configOf(id: string, cookie = admin, payload: Record<string, unknown> = {}): Promise<DisplayConfigFile> {
  const res = await api(cookie).config(id, payload);
  expect(res.statusCode).toBe(200);
  return DisplayConfigFileSchema.parse(res.json());
}

const heartbeat = (token: string, body: Record<string, unknown> = { version: '1.0.0', uptimeS: 10 }) =>
  server.app.inject({
    method: 'POST',
    url: '/api/displays/heartbeat',
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });

const rowOf = async (id: string) => {
  const [row] = await server.database.db.select().from(displays).where(eq(displays.id, id));
  if (!row) throw new Error('display missing');
  return row;
};

describe('players in the reserved area', () => {
  it('creates a player without token that shows nothing, listed for the viewer without IP', async () => {
    const created = await newDisplay('Tribuna');
    expect(created).toMatchObject({ name: 'Tribuna', target: { kind: 'none' }, configured: false, revoked: false });
    const { token } = await configOf(created.id);
    await heartbeat(token);
    const asAdmin = (await api(admin).list()).json<DisplaySummary[]>().find((d) => d.id === created.id);
    expect(asAdmin?.lastIp).toBe('127.0.0.1');
    const asViewer = (await api(viewer).list()).json<DisplaySummary[]>().find((d) => d.id === created.id);
    expect(asViewer).toMatchObject({ configured: true, lastIp: null, version: '1.0.0' });
    expect((await api(viewer).create('x')).statusCode).toBe(403);
    expect((await api(viewer).command(created.id, 'reload')).statusCode).toBe(403);
  });

  it('keeps every client to its own players', async () => {
    const mine = await newDisplay();
    expect((await api(adminB).list()).json<DisplaySummary[]>().some((d) => d.id === mine.id)).toBe(false);
    expect((await api(adminB).patch(mine.id, { name: 'altro' })).statusCode).toBe(404);
    expect((await api(adminB).command(mine.id, 'reboot')).statusCode).toBe(404);
    expect((await api(adminB).config(mine.id)).statusCode).toBe(404);
    expect((await api(adminB).revoke(mine.id)).statusCode).toBe(404);
    expect((await rowOf(mine.id)).revoked).toBe(false);
  });

  it('changes name and target, refusing a match of another client', async () => {
    const d = await newDisplay();
    const res = await api(admin).patch(d.id, { name: 'Curva', target: { kind: 'channel' } });
    expect(res.json()).toMatchObject({ name: 'Curva', target: { kind: 'channel' } });
    const agentB = await createAgent(server, false, tenantB);
    const file = fileAt(generateMatch({ seed: 9 }), 10);
    await ingest(server.app, agentB, await requestFor('gara-b', 0, [], file));
    const matchesB = await server.app.inject({ url: '/api/admin/matches', headers: { cookie: adminB } });
    const matchB = matchesB.json<{ id: string }[]>()[0]?.id ?? '';
    expect((await api(admin).patch(d.id, { target: { kind: 'match', matchId: matchB } })).statusCode).toBe(400);
    expect(
      (await api(admin).patch(d.id, { target: { kind: 'fixture', clientFixtureId: crypto.randomUUID() } })).statusCode,
    ).toBe(400);
    expect((await api(admin).patch(d.id, {})).statusCode).toBe(400);
  });

  it('recognizes a foreign key error, also wrapped', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(isForeignKeyViolation(new Error('x', { cause: { code: '23503' } }))).toBe(true);
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
  });

  it('shows the waiting screen when the id of the target is gone', () => {
    expect(displayTargetOf({ targetKind: 'match', matchId: null, clientFixtureId: null })).toEqual({ kind: 'none' });
    expect(displayTargetOf({ targetKind: 'fixture', matchId: null, clientFixtureId: null })).toEqual({ kind: 'none' });
    expect(displayTargetOf({ targetKind: 'channel', matchId: null, clientFixtureId: null })).toEqual({
      kind: 'channel',
    });
  });

  it(`stops at ${DISPLAY_LIMIT} players not revoked per client`, async () => {
    const tenantC = await createTenant(server, 'player-c', ['c.player.test']);
    const adminC = { email: 'admin-c@player.test', password: 'password-admin-c' };
    await createUser(server, adminC, 'admin', tenantC);
    const cookie = await login(server.app, adminC, 'c.player.test');
    const ids: string[] = [];
    for (let i = 0; i < DISPLAY_LIMIT; i++) ids.push((await newDisplay(`p${i}`, cookie)).id);
    const over = await api(cookie).create('troppi');
    expect(over.statusCode).toBe(409);
    await api(cookie).revoke(ids[0] ?? '');
    expect((await api(cookie).create('ancora')).statusCode).toBe(201);
  });
});

describe('arenalive-player.json', () => {
  it('gives the server of the client and a new token at every download, the old one stops working', async () => {
    const d = await newDisplay('Palco');
    const res = await api(admin).config(d.id);
    expect(res.headers['content-disposition']).toBe('attachment; filename="arenalive-player.json"');
    expect(res.headers['cache-control']).toBe('no-store');
    const first = DisplayConfigFileSchema.parse(res.json());
    expect(first).toMatchObject({ version: 1, serverUrl: 'http://portale.test', name: 'Palco' });
    expect(first.wifi).toBeUndefined();
    expect((await rowOf(d.id)).tokenHash).toBe(createHash('sha256').update(first.token).digest('hex'));
    expect((await heartbeat(first.token)).statusCode).toBe(200);
    const second = await configOf(d.id);
    expect(second.token).not.toBe(first.token);
    expect((await heartbeat(first.token)).statusCode).toBe(401);
    expect((await heartbeat(second.token)).statusCode).toBe(200);
  });

  it('uses a hostname of the client', async () => {
    const d = await newDisplay('B', adminB);
    expect((await configOf(d.id, adminB)).serverUrl).toBe(`http://${HOST_B}`);
  });

  it('puts the Wi-Fi in the file only, never in the database', async () => {
    const d = await newDisplay();
    const wifi = { ssid: 'Palestra', password: WIFI_PASSWORD, country: 'IT' };
    const file = await configOf(d.id, admin, { wifi });
    expect(file.wifi).toEqual(wifi);
    const stored = JSON.stringify(await server.database.db.select().from(displays));
    expect(stored).not.toContain(WIFI_PASSWORD);
    expect(stored).not.toContain('Palestra');
    expect((await api(admin).config(d.id, { wifi: { ssid: 'x', password: 'corta', country: 'IT' } })).statusCode).toBe(
      400,
    );
  });

  it('is refused for a revoked player, whose token stops working', async () => {
    const d = await newDisplay();
    const { token } = await configOf(d.id);
    expect((await api(admin).revoke(d.id)).statusCode).toBe(204);
    expect((await heartbeat(token)).statusCode).toBe(401);
    expect((await api(admin).config(d.id)).statusCode).toBe(404);
    expect((await api(admin).patch(d.id, { name: 'x' })).statusCode).toBe(404);
  });
});

describe('heartbeat and commands', () => {
  it('refuses a missing or wrong token and saves what the device reports', async () => {
    expect((await server.app.inject({ method: 'POST', url: '/api/displays/heartbeat', payload: {} })).statusCode).toBe(
      401,
    );
    expect((await heartbeat('Z'.repeat(43))).statusCode).toBe(401);
    const d = await newDisplay();
    const { token } = await configOf(d.id);
    expect((await heartbeat(token, { version: '1.0.0' })).statusCode).toBe(400);
    const res = await heartbeat(token, { version: '1.1.0', resolution: '1920x1080', uptimeS: 60 });
    expect(res.json()).toEqual({ command: null, commandSeq: 0 });
    expect(await rowOf(d.id)).toMatchObject({ version: '1.1.0', resolution: '1920x1080', lastIp: '127.0.0.1' });
    expect((await rowOf(d.id)).lastSeenAt).toBeInstanceOf(Date);
  });

  it('gives the pending command until the device confirms it, a newer one replaces it', async () => {
    const d = await newDisplay();
    const { token } = await configOf(d.id);
    expect((await api(admin).command(d.id, 'spegni')).statusCode).toBe(400);
    expect((await api(admin).command(d.id, 'screenOff')).json()).toMatchObject({ command: 'screenOff', commandSeq: 1 });
    expect((await heartbeat(token)).json()).toEqual({ command: 'screenOff', commandSeq: 1 });
    expect((await heartbeat(token)).json()).toEqual({ command: 'screenOff', commandSeq: 1 });
    await api(admin).command(d.id, 'reboot');
    // The confirmation of the older command does not clear the newer one.
    const body = { version: '1.0.0', uptimeS: 5, ackSeq: 1 };
    expect((await heartbeat(token, body)).json()).toEqual({ command: 'reboot', commandSeq: 2 });
    expect((await heartbeat(token, { ...body, ackSeq: 2 })).json()).toEqual({ command: null, commandSeq: 2 });
  });

  it('blocks an IP after too many wrong tokens', async () => {
    const strict = await startServer({ displayInvalid: 2 });
    try {
      const wrong = () =>
        strict.app.inject({
          method: 'POST',
          url: '/api/displays/heartbeat',
          headers: { authorization: `Bearer ${'Q'.repeat(43)}` },
          payload: { version: '1.0.0', uptimeS: 1 },
        });
      expect((await wrong()).statusCode).toBe(401);
      expect((await wrong()).statusCode).toBe(401);
      const blocked = await wrong();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    } finally {
      await strict.close();
    }
  });
});

describe('update of the software', () => {
  it('offers nothing until a .deb is published, then only to an older version', async () => {
    const d = await newDisplay();
    const { token } = await configOf(d.id);
    const update = () =>
      server.app.inject({ url: '/api/displays/update', headers: { authorization: `Bearer ${token}` } });
    expect((await heartbeat(token)).json<DisplayHeartbeatResponse>().update).toBeUndefined();
    expect((await update()).statusCode).toBe(404);
    expect(
      (await server.app.inject({ url: '/api/displays/update', headers: { authorization: 'Bearer x' } })).statusCode,
    ).toBe(401);

    const deb = randomBytes(5000);
    const sha256 = createHash('sha256').update(deb).digest('hex');
    await writeFile(join(downloadDir, 'arenalive-player.deb'), deb);
    // A manifest that does not describe the file: nothing on offer.
    const manifest = { version: '1.2.0', builtAt: '2026-10-20T10:00:00.000Z', sha256: 'f'.repeat(64) };
    await writeFile(join(downloadDir, 'arenalive-player.json'), JSON.stringify(manifest));
    expect((await heartbeat(token)).json<DisplayHeartbeatResponse>().update).toBeUndefined();
    await writeFile(join(downloadDir, 'arenalive-player.json'), JSON.stringify({ ...manifest, sha256 }));

    expect((await heartbeat(token)).json<DisplayHeartbeatResponse>().update).toEqual({
      version: '1.2.0',
      sha256,
      size: deb.length,
    });
    const same = await heartbeat(token, { version: '1.2.0', uptimeS: 1 });
    expect(same.json<DisplayHeartbeatResponse>().update).toBeUndefined();
    const res = await update();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="arenalive-player-1.2.0.deb"');
    expect(res.rawPayload.equals(deb)).toBe(true);
  });
});

describe('socket of the page /schermo', () => {
  /** Opens `/ws/display`, sends `first` (the auth message) and collects the messages. */
  async function connect(first: unknown) {
    const messages: DisplaySocketMessage[] = [];
    const waiters: (() => void)[] = [];
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/display`);
    ws.addEventListener('message', (e: MessageEvent) => {
      messages.push(JSON.parse(String(e.data)) as DisplaySocketMessage);
      waiters.splice(0).forEach((w) => w());
    });
    const next = async (count: number): Promise<DisplaySocketMessage> => {
      while (messages.length < count) await new Promise<void>((r) => waiters.push(r));
      const m = messages[count - 1];
      if (!m) throw new Error('no message');
      return m;
    };
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('connection refused')));
    });
    ws.send(typeof first === 'string' ? first : JSON.stringify(first));
    return { ws, next, closed, messages };
  }

  it('closes a socket without a valid first message or with a wrong token', async () => {
    expect(await (await connect('non json')).closed).toBe(4401);
    expect(await (await connect({ type: 'resync' })).closed).toBe(4401);
    expect(await (await connect({ type: 'auth', token: 'W'.repeat(43) })).closed).toBe(4404);
    // A player of another client on this hostname: as a wrong token.
    const other = await newDisplay('B', adminB);
    const { token } = await configOf(other.id, adminB);
    expect(await (await connect({ type: 'auth', token })).closed).toBe(4404);
  });

  it('shows the waiting screen, then what the admin chooses, at once', async () => {
    const d = await newDisplay('Ingresso');
    const { token } = await configOf(d.id);
    const client = await connect({ type: 'auth', token });
    const standby = await client.next(1);
    expect(standby).toMatchObject({ type: 'standby', displayName: 'Ingresso' });
    expect(standby.type === 'standby' && standby.tenantName.length > 0).toBe(true);

    const agent = await createAgent(server);
    const file = fileAt(generateMatch({ seed: 4 }), 20);
    await ingest(server.app, agent, await requestFor('gara-schermo', 0, [], file));
    const list = await server.app.inject({ url: '/api/admin/matches', headers: { cookie: admin } });
    const matchId = list.json<{ id: string; matchKey: string }[]>().find((m) => m.matchKey === 'gara-schermo')?.id;
    if (!matchId) throw new Error('match missing');

    await api(admin).patch(d.id, { target: { kind: 'match', matchId } });
    expect(await client.next(2)).toMatchObject({ type: 'state', matchId });
    // The next ingest of that match reaches the player.
    const more = fileAt(generateMatch({ seed: 4 }), 30);
    await ingest(server.app, agent, await requestFor('gara-schermo', 1, file.scoutLines, more));
    expect(await client.next(3)).toMatchObject({ matchId, version: 2 });

    await api(admin).patch(d.id, { target: { kind: 'none' } });
    expect(await client.next(4)).toMatchObject({ type: 'standby', displayName: 'Ingresso' });
    await api(admin).patch(d.id, { name: 'Ingresso nord' });
    expect(await client.next(5)).toMatchObject({ type: 'standby', displayName: 'Ingresso nord' });
    // The channel of the club: the match being played.
    await api(admin).patch(d.id, { target: { kind: 'channel' } });
    expect(await client.next(6)).toMatchObject({ type: 'state', matchId });
    client.ws.close();
  });

  it('ends on the last target chosen when it changes twice in a row', async () => {
    const d = await newDisplay('Doppio');
    const { token } = await configOf(d.id);
    const client = await connect({ type: 'auth', token });
    await client.next(1);
    await Promise.all([
      api(admin).patch(d.id, { target: { kind: 'channel' } }),
      api(admin).patch(d.id, { target: { kind: 'none' } }),
    ]);
    const final = (await rowOf(d.id)).targetKind;
    await expect
      .poll(() => {
        const last = client.messages.at(-1);
        return client.messages.length > 1 && (final === 'none' ? last?.type === 'standby' : last?.type !== 'standby');
      })
      .toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const last = client.messages.at(-1);
    expect(final === 'none' ? last?.type === 'standby' : last?.type !== 'standby').toBe(true);
    client.ws.close();
  });

  it('goes back to the waiting screen when its match of the calendar is deleted', async () => {
    const [fixture] = await server.database.db
      .insert(clientFixtures)
      .values({
        tenantId: server.tenantId,
        fixtureExternalId: 'manual-player',
        origin: 'manual',
        ourSide: 'home',
        homeName: 'Noi',
        awayName: 'Loro',
        roundLabel: 'Amichevole',
        status: 'scheduled',
        startsAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: clientFixtures.id });
    if (!fixture) throw new Error('fixture missing');
    const d = await newDisplay();
    await api(admin).patch(d.id, { target: { kind: 'fixture', clientFixtureId: fixture.id } });
    const { token } = await configOf(d.id);
    const client = await connect({ type: 'auth', token });
    expect((await client.next(1)).type).not.toBe('standby');
    const del = await server.app.inject({
      method: 'DELETE',
      url: `/api/admin/calendar/fixtures/${fixture.id}`,
      headers: { cookie: admin },
    });
    expect(del.statusCode).toBe(204);
    expect(await client.next(2)).toMatchObject({ type: 'standby' });
    expect((await api(admin).list()).json<DisplaySummary[]>().find((x) => x.id === d.id)?.target).toEqual({
      kind: 'none',
    });
    client.ws.close();
  });

  it('sends a reload at once and takes its confirmation', async () => {
    const d = await newDisplay();
    const { token } = await configOf(d.id);
    const client = await connect({ type: 'auth', token });
    await client.next(1);
    await api(admin).command(d.id, 'reboot');
    await api(admin).command(d.id, 'reload');
    expect(await client.next(2)).toEqual({ type: 'command', command: 'reload', commandSeq: 2 });
    expect(client.messages).toHaveLength(2);
    client.ws.send(JSON.stringify({ type: 'ack', commandSeq: 2 }));
    await expect.poll(async () => (await rowOf(d.id)).command).toBeNull();
    client.ws.close();
  });

  it('closes the page of a revoked player and of a token replaced by a new download', async () => {
    const d = await newDisplay();
    const first = await configOf(d.id);
    const client = await connect({ type: 'auth', token: first.token });
    await client.next(1);
    const second = await configOf(d.id);
    expect(await client.closed).toBe(4404);
    const again = await connect({ type: 'auth', token: second.token });
    await again.next(1);
    await api(admin).revoke(d.id);
    expect(await again.closed).toBe(4404);
  });
});
