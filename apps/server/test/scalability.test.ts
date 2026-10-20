import { gunzipSync } from 'node:zlib';
import { generateMatch } from '@arenalive/dvw-simulator';
import type { CreateShareTokenResponse, JsonValue, ServerMessage } from '@arenalive/shared';
import { applyPatch } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { shareTokens, tenants } from '../src/db/index.js';
import type { TestServer } from './helpers.js';
import {
  ADMIN,
  SUPERADMIN,
  createAgent,
  createTenant,
  fileAt,
  ingest,
  login,
  requestFor,
  startServer,
} from './helpers.js';

interface Received {
  binary: boolean;
  message: ServerMessage;
}

/** Live socket through `injectWS`, decoding text and gzip frames. */
async function open(server: TestServer, path: string, headers: Record<string, string> = {}) {
  const received: Received[] = [];
  const ws: WebSocket = await server.app.injectWS(
    path,
    { headers },
    {
      onInit: (socket) => {
        socket.on('message', (data: Buffer, binary: boolean) => {
          const text = (binary ? gunzipSync(data) : data).toString('utf8');
          received.push({ binary, message: JSON.parse(text) as ServerMessage });
        });
      },
    },
  );
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  return { ws, received, closed };
}

/** Feeds the simulated match `matchKey` to the server, step by step. */
function feeder(server: TestServer, agent: string, matchKey: string, seed: number) {
  const match = generateMatch({ seed });
  let prev: string[] = [];
  let seq = 0;
  return async (upTo: number): Promise<void> => {
    const file = fileAt(match, upTo);
    const res = await ingest(server.app, agent, await requestFor(matchKey, seq, prev, file));
    expect(res.json()).toMatchObject({ status: 'ok' });
    prev = file.scoutLines;
    seq++;
  };
}

async function createShare(server: TestServer, cookie: string): Promise<CreateShareTokenResponse> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/admin/share-tokens',
    headers: { cookie },
    payload: { label: 'Tribuna', matchId: null, expiresAt: null },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CreateShareTokenResponse>();
}

/** What a client shows after the messages it received (full states and patches, in order). */
function shown(received: Received[]): JsonValue | null {
  let state: JsonValue | null = null;
  let version = -1;
  for (const { message } of received) {
    if (message.type === 'state') {
      state = message.state as unknown as JsonValue;
      version = message.version;
    } else if (message.type === 'patch') {
      if (state === null || message.baseVersion !== version) throw new Error('patch senza la sua base');
      state = applyPatch(state, message.ops);
      version = message.version;
    }
  }
  return state;
}

describe('live updates: patches, gzip and resync', () => {
  let server: TestServer;
  let cookie: string;
  let feed: (upTo: number) => Promise<void>;
  let token: string;
  beforeAll(async () => {
    server = await startServer();
    cookie = await login(server.app, ADMIN);
    feed = feeder(server, await createAgent(server), 'gara-patch', 11);
    await feed(30);
    token = (await createShare(server, cookie)).token;
  });
  afterAll(() => server.close());

  const httpState = async (): Promise<JsonValue> =>
    (await server.app.inject({ url: `/api/public/${token}/state` })).json<{ state: JsonValue }>().state;

  it('sends patches after the first full state; applied in order they give the state of the server', async () => {
    const client = await open(server, `/ws/public/${token}`);
    await expect.poll(() => client.received.length).toBe(1);
    for (const upTo of [40, 55, 70]) await feed(upTo);
    await expect.poll(() => client.received.length).toBe(4);
    // A step that changes more than half of the state (e.g. a new set) may come in full.
    const types = client.received.map((r) => r.message.type);
    expect(types[0]).toBe('state');
    expect(types.filter((t) => t === 'patch').length).toBeGreaterThanOrEqual(2);
    expect(client.received.every((r) => !r.binary)).toBe(true);
    expect(shown(client.received)).toEqual(await httpState());
    client.ws.terminate();
  });

  it('sends gzip binary frames to a client that asks enc=gzip, text frames to the others', async () => {
    const zipped = await open(server, `/ws/public/${token}?enc=gzip`);
    const plain = await open(server, `/ws/public/${token}?enc=other`);
    await expect.poll(() => zipped.received.length + plain.received.length).toBe(2);
    await feed(80);
    await expect.poll(() => zipped.received.length + plain.received.length).toBe(4);
    expect(zipped.received.map((r) => r.binary)).toEqual([true, true]);
    expect(plain.received.map((r) => r.binary)).toEqual([false, false]);
    expect(zipped.received.map((r) => r.message)).toEqual(plain.received.map((r) => r.message));
    expect(shown(zipped.received)).toEqual(await httpState());
    zipped.ws.terminate();
    plain.ws.terminate();
  });

  it('answers resync with the full state and ignores other messages', async () => {
    const client = await open(server, `/ws/public/${token}`);
    await expect.poll(() => client.received.length).toBe(1);
    client.ws.send('non json');
    client.ws.send(JSON.stringify({ type: 'qualcosa' }));
    client.ws.send(JSON.stringify({ type: 'resync' }));
    await expect.poll(() => client.received.length).toBe(2);
    expect(client.received.map((r) => r.message.type)).toEqual(['state', 'state']);
    // After a resync the next update is a patch of that state again.
    await feed(90);
    await expect.poll(() => client.received.length).toBe(3);
    expect(client.received[2]?.message.type).toBe('patch');
    expect(shown(client.received)).toEqual(await httpState());
    client.ws.terminate();
  });
});

describe('public limits', () => {
  it('limits the open WebSockets per IP with 503 and Retry-After, on the socket and the HTTP check', async () => {
    const server = await startServer({}, { WS_MAX_PER_IP: '2' });
    try {
      const cookie = await login(server.app, ADMIN);
      const { token } = await createShare(server, cookie);
      // Real sockets from 127.0.0.1, the address of `inject` below.
      const base = (await server.app.listen({ port: 0, host: '127.0.0.1' })).replace('http', 'ws');
      const sockets = [0, 1].map(() => new globalThis.WebSocket(`${base}/ws/public/${token}`));
      await Promise.all(sockets.map((ws) => new Promise((resolve) => ws.addEventListener('message', resolve))));
      const full = await server.app.inject({ url: `/ws/public/${token}` });
      expect(full.statusCode).toBe(503);
      expect(full.headers['retry-after']).toBe('20');
      expect(full.json()).toEqual({ error: 'Troppi spettatori collegati, riprova tra poco' });
      expect((await server.app.inject({ url: `/api/public/${token}/state` })).statusCode).toBe(503);
      // Another IP still gets in.
      expect(
        (await server.app.inject({ url: `/api/public/${token}/state`, remoteAddress: '10.9.9.9' })).statusCode,
      ).toBe(200);
      sockets[0]?.close();
      await expect
        .poll(async () => (await server.app.inject({ url: `/api/public/${token}/state` })).statusCode)
        .toBe(200);
      sockets[1]?.close();
    } finally {
      await server.close();
    }
  });

  it('limits the open WebSockets in total', async () => {
    const server = await startServer({}, { WS_MAX_TOTAL: '1' });
    try {
      const cookie = await login(server.app, ADMIN);
      const { token } = await createShare(server, cookie);
      const a = await open(server, `/ws/public/${token}`);
      const full = await server.app.inject({ url: `/ws/public/${token}`, remoteAddress: '10.1.2.3' });
      expect(full.statusCode).toBe(503);
      // Admin sockets are not counted.
      const admin = await open(server, '/ws/admin', { cookie });
      await expect.poll(() => admin.received.length).toBe(1);
      a.ws.terminate();
      admin.ws.terminate();
    } finally {
      await server.close();
    }
  });

  it('counts only the wrong tokens: many valid requests pass, wrong ones block the IP until the minute ends', async () => {
    const server = await startServer({ publicInvalid: 2 });
    try {
      const cookie = await login(server.app, ADMIN);
      const { token } = await createShare(server, cookie);
      const get = (t: string, ip = '10.0.0.7') =>
        server.app.inject({ url: `/api/public/${t}/state`, remoteAddress: ip });
      for (let i = 0; i < 20; i++) expect((await get(token)).statusCode).toBe(200);
      expect((await get('W'.repeat(43))).statusCode).toBe(404);
      expect((await get('W'.repeat(43))).statusCode).toBe(404);
      const blocked = await get(token);
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect((await server.app.inject({ url: `/ws/public/${token}`, remoteAddress: '10.0.0.7' })).statusCode).toBe(429);
      // Another IP is not affected; after the minute the first one may try again.
      expect((await get(token, '10.0.0.8')).statusCode).toBe(200);
      server.setNow(new Date(Date.now() + 61_000));
      expect((await get(token)).statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});

describe('lookup caches', () => {
  let server: TestServer;
  let cookie: string;
  beforeAll(async () => {
    server = await startServer();
    cookie = await login(server.app, ADMIN);
    await feeder(server, await createAgent(server), 'gara-cache', 12)(20);
  });
  afterAll(() => server.close());

  it('keeps a share token 30 s, but a revocation closes its sockets and refuses it at once', async () => {
    const link = await createShare(server, cookie);
    const url = `/api/public/${link.token}/state`;
    expect((await server.app.inject({ url })).statusCode).toBe(200);
    // Changed behind the server's back: the cached token stays valid until its 30 s are over.
    await server.database.db.update(shareTokens).set({ revoked: true }).where(eq(shareTokens.id, link.id));
    expect((await server.app.inject({ url })).statusCode).toBe(200);
    server.setNow(new Date(Date.now() + 31_000));
    try {
      expect((await server.app.inject({ url })).statusCode).toBe(404);
    } finally {
      server.setNow(null);
    }

    const other = await createShare(server, cookie);
    const client = await open(server, `/ws/public/${other.token}`);
    await expect.poll(() => client.received.length).toBe(1);
    const res = await server.app.inject({
      method: 'DELETE',
      url: `/api/admin/share-tokens/${other.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await client.closed).toBe(4404);
    expect((await server.app.inject({ url: `/api/public/${other.token}/state` })).statusCode).toBe(404);
  });

  it('keeps the client of a hostname 30 s, and forgets it at once when a client changes', async () => {
    const id = await createTenant(server, 'club-c', ['c.sir.test']);
    const link = await createShare(server, cookie);
    const onC = () => server.app.inject({ url: `/api/public/${link.token}/state`, headers: { host: 'c.sir.test' } });
    // c.sir.test belongs to club-c: the link of «Predefinito» is not served there.
    expect((await onC()).statusCode).toBe(404);
    // Hostname removed behind the server's back: still club-c until the 30 s are over.
    await server.database.db.update(tenants).set({ hostnames: [] }).where(eq(tenants.id, id));
    expect((await onC()).statusCode).toBe(404);
    server.setNow(new Date(Date.now() + 31_000));
    try {
      expect((await onC()).statusCode).toBe(200);
    } finally {
      server.setNow(null);
    }
    // Changed through the API: effective at the next request.
    const superCookie = await login(server.app, SUPERADMIN);
    const patch = await server.app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${id}`,
      headers: { cookie: superCookie },
      payload: { hostnames: ['c.sir.test'] },
    });
    expect(patch.statusCode).toBe(200);
    expect((await onC()).statusCode).toBe(404);
  });
});
