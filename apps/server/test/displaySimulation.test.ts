import type { DisplayConfigFile, DisplaySocketMessage, StartSimulationRequest } from '@arenalive/shared';
import { DisplayConfigFileSchema, DisplaySummarySchema } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matches } from '../src/db/index.js';
import type { AppContext } from '../src/context.js';
import { currentSimulationMatch, freshDisplayTarget } from '../src/displays.js';
import { LiveHub } from '../src/hub.js';
import type { SimulationTimers } from '../src/simulation/service.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, ORIGIN, startServer } from './helpers.js';

/** The replay never goes on by itself: only the first state of every start is sent (enough for a player). */
const stillTimers: SimulationTimers = { set: () => 0, clear: () => undefined };

const HOST_B = 'b.simulazione.test';
const ADMIN_B = { email: 'admin-b@simulazione.test', password: 'password-admin-b' };
const GENERATED: StartSimulationRequest = {
  source: { kind: 'generated', sets: 3, seed: 4, clubTeams: false },
  pace: { kind: 'duration', setSeconds: 20, breakSeconds: 10 },
};

let server: TestServer;
let admin: string;
let adminB: string;
let tenantB: string;
let baseUrl: string;

beforeAll(async () => {
  server = await startServer({}, {}, { simulationTimers: stillTimers });
  admin = await login(server.app, ADMIN);
  tenantB = await createTenant(server, 'simulazione-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  adminB = await login(server.app, ADMIN_B, HOST_B);
  baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => server.close());

const call = (
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  cookie = admin,
  host?: string,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie, origin: host ? `http://${host}` : ORIGIN, ...(host ? { host } : {}) },
    ...(payload !== undefined ? { payload } : {}),
  });

async function newDisplay(target?: unknown): Promise<{ id: string; config: DisplayConfigFile }> {
  const res = await call('POST', '/api/admin/displays', { name: 'Maxischermo' });
  expect(res.statusCode).toBe(201);
  const { id } = DisplaySummarySchema.parse(res.json());
  if (target) expect((await call('PATCH', `/api/admin/displays/${id}`, { target })).statusCode).toBe(200);
  const config = DisplayConfigFileSchema.parse((await call('POST', `/api/admin/displays/${id}/config`, {})).json());
  return { id, config };
}

const startSimulation = async (cookie = admin, host?: string) => {
  const res = await call('POST', '/api/admin/simulation', GENERATED, cookie, host);
  expect(res.statusCode, res.body).toBe(201);
};
const deleteSimulation = async (cookie = admin, host?: string) => {
  const res = await call('DELETE', '/api/admin/simulation', undefined, cookie, host);
  expect([204, 404]).toContain(res.statusCode);
};

/** Opens `/ws/display` with the token of a player and collects what it gets. */
async function connect(token: string) {
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
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('connection refused')));
  });
  ws.send(JSON.stringify({ type: 'auth', token }));
  return { ws, next, messages };
}

const simulatedMatchOf = async (tenantId: string) => {
  const [row] = await server.database.db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.tenantId, tenantId))
    .limit(10);
  return row?.id ?? null;
};

describe('player on «Simulazione»', () => {
  it('shows the waiting screen without a simulation, then follows it at once, then waits again', async () => {
    await deleteSimulation();
    const { id, config } = await newDisplay({ kind: 'simulation' });
    const listed = DisplaySummarySchema.array().parse(
      (await server.app.inject({ url: '/api/admin/displays', headers: { cookie: admin } })).json(),
    );
    expect(listed.find((d) => d.id === id)?.target).toEqual({ kind: 'simulation' });
    const client = await connect(config.token);
    expect(await client.next(1)).toMatchObject({ type: 'standby' });

    await startSimulation();
    const matchId = await currentSimulationMatch(server.database.db, server.tenantId);
    expect(matchId).not.toBeNull();
    const state = await client.next(2);
    expect(state).toMatchObject({ type: 'state', matchId, simulated: true });

    // A resync gives the state of the simulation again.
    client.ws.send(JSON.stringify({ type: 'resync' }));
    expect(await client.next(3)).toMatchObject({ type: 'state', matchId });

    await deleteSimulation();
    expect(await client.next(4)).toMatchObject({ type: 'standby' });
    client.ws.close();
  });

  it('opens on the simulation already running, and follows the same match when it starts again', async () => {
    await startSimulation();
    const matchId = await currentSimulationMatch(server.database.db, server.tenantId);
    const { config } = await newDisplay({ kind: 'simulation' });
    const client = await connect(config.token);
    expect(await client.next(1)).toMatchObject({ type: 'state', matchId, simulated: true });
    expect((await call('POST', '/api/admin/simulation/stop', {})).statusCode).toBe(200);
    await startSimulation();
    expect(await currentSimulationMatch(server.database.db, server.tenantId)).toBe(matchId);
    expect(await client.next(2)).toMatchObject({ type: 'state', matchId });
    expect((await call('POST', '/api/admin/simulation/stop', {})).statusCode).toBe(200);
    await deleteSimulation();
    expect(await client.next(client.messages.length + 1)).toMatchObject({ type: 'standby' });
    client.ws.close();
  });

  it('never shows the simulation of another client, and the channel never shows a simulation', async () => {
    await deleteSimulation();
    const mine = await newDisplay({ kind: 'simulation' });
    const channel = await newDisplay({ kind: 'channel' });
    const onSimulation = await connect(mine.config.token);
    const onChannel = await connect(channel.config.token);
    expect(await onSimulation.next(1)).toMatchObject({ type: 'standby' });
    const first = await onChannel.next(1);
    expect(first.type).not.toBe('state');

    await startSimulation(adminB, HOST_B);
    const other = await currentSimulationMatch(server.database.db, tenantB);
    expect(other).not.toBeNull();
    expect(await currentSimulationMatch(server.database.db, server.tenantId)).toBeNull();

    await startSimulation();
    const own = await currentSimulationMatch(server.database.db, server.tenantId);
    expect(await onSimulation.next(2)).toMatchObject({ type: 'state', matchId: own });
    expect(onSimulation.messages.some((m) => m.type === 'state' && m.matchId === other)).toBe(false);
    // The channel stays as it was: no simulated state, of this client or of the other one.
    onChannel.ws.send(JSON.stringify({ type: 'resync' }));
    const again = await onChannel.next(2);
    expect(again.type === 'state' && again.simulated === true).toBe(false);
    expect(onChannel.messages.some((m) => m.type === 'state' && m.simulated === true)).toBe(false);

    await deleteSimulation(adminB, HOST_B);
    expect(await simulatedMatchOf(tenantB)).toBeNull();
    expect(onSimulation.messages.at(-1)).toMatchObject({ type: 'state', matchId: own });
    await deleteSimulation();
    onSimulation.ws.close();
    onChannel.ws.close();
  });

  it('cannot be set to a fixed simulated match', async () => {
    await startSimulation();
    const matchId = await currentSimulationMatch(server.database.db, server.tenantId);
    const { id } = await newDisplay();
    expect((await call('PATCH', `/api/admin/displays/${id}`, { target: { kind: 'match', matchId } })).statusCode).toBe(
      400,
    );
    expect(
      (await call('PATCH', `/api/admin/displays/${id}`, { target: { kind: 'simulation', matchId } })).statusCode,
    ).toBe(400);
    expect((await call('PATCH', `/api/admin/displays/${id}`, { target: { kind: 'simulation' } })).statusCode).toBe(200);
    await deleteSimulation();
  });

  it('always follows the target saved by the admin, and only the newest of two reads', async () => {
    await startSimulation();
    const matchId = await currentSimulationMatch(server.database.db, server.tenantId);
    const { id } = await newDisplay({ kind: 'simulation' });
    // Only hub and database are read.
    const ctx = { hub: new LiveHub(), db: server.database.db } as unknown as AppContext;
    expect(await freshDisplayTarget(ctx, id)).toEqual({ kind: 'match', tenantId: server.tenantId, matchId });
    // The admin moves the player meanwhile: a refresh started with the old row («Simulazione») gives the saved one.
    expect((await call('PATCH', `/api/admin/displays/${id}`, { target: { kind: 'none' } })).statusCode).toBe(200);
    expect(await freshDisplayTarget(ctx, id)).toEqual({ kind: 'standby', tenantId: server.tenantId, displayId: id });
    // Two reads at once: the older one is dropped whatever finishes first.
    const older = freshDisplayTarget(ctx, id);
    const newer = freshDisplayTarget(ctx, id);
    expect(await older).toBeNull();
    expect(await newer).toMatchObject({ kind: 'standby' });
    expect((await call('DELETE', `/api/admin/displays/${id}`)).statusCode).toBe(204);
    expect(await freshDisplayTarget(ctx, id)).toBeNull();
    await deleteSimulation();
  });
});
