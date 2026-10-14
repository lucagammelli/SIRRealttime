import { generateMatch } from '@sir/dvw-simulator';
import type { CreateShareTokenResponse, IngestRequest, ServerMessage, ShareTokenSummary } from '@sir/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { ADMIN, createAgent, fileAt, ingest, login, ORIGIN, requestFor, startServer } from './helpers.js';

let server: TestServer;
let cookie: string;
let agent: string;
let baseUrl: string;
const sent = new Map<string, { lines: string[]; seq: number }>();

/** Sends the simulated match `matchKey` up to `upTo` rows; returns the match id. */
async function send(matchKey: string, seed: number, upTo: number): Promise<string> {
  const prev = sent.get(matchKey) ?? { lines: [], seq: 0 };
  const file = fileAt(generateMatch({ seed }), upTo);
  const body: IngestRequest = await requestFor(matchKey, prev.seq, prev.lines, file);
  const res = await ingest(server.app, agent, body);
  expect(res.json()).toMatchObject({ status: 'ok' });
  sent.set(matchKey, { lines: file.scoutLines, seq: prev.seq + 1 });
  const list = await server.app.inject({ url: '/api/admin/matches', headers: { cookie } });
  const m = list.json<{ id: string; matchKey: string }[]>().find((x) => x.matchKey === matchKey);
  if (!m) throw new Error('match missing');
  return m.id;
}

async function share(matchId: string | null, expiresAt: string | null = null): Promise<CreateShareTokenResponse> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/admin/share-tokens',
    headers: { cookie },
    payload: { label: 'Tribuna', matchId, expiresAt },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CreateShareTokenResponse>();
}

const stateOf = async (token: string) => server.app.inject({ url: `/api/public/${token}/state` });

beforeAll(async () => {
  server = await startServer();
  cookie = await login(server.app, ADMIN);
  agent = await createAgent(server);
  baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => server.close());

describe('share tokens', () => {
  let matchA: string;

  it('answers noMatch on a live link while no match exists', async () => {
    const live = await share(null);
    const res = await stateOf(live.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: 'noMatch' });
  });

  it('creates a link with the public URL and serves the match state', async () => {
    matchA = await send('gara-a', 1, 60);
    const created = await share(matchA);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.url).toBe(`${ORIGIN}/live/${created.token}`);
    const res = await stateOf(created.token);
    expect(res.statusCode).toBe(200);
    const body = res.json<ServerMessage>();
    expect(body).toMatchObject({ type: 'state', matchId: matchA, version: 1 });
    const list = await server.app.inject({ url: '/api/admin/share-tokens', headers: { cookie } });
    expect(list.body).not.toContain(created.token);
    expect(list.json<ShareTokenSummary[]>().some((s) => s.id === created.id)).toBe(true);
  });

  it('allows CORS only for CORS_ORIGIN, never echoing another origin', async () => {
    const created = await share(matchA);
    const ok = await server.app.inject({ url: `/api/public/${created.token}/state`, headers: { origin: ORIGIN } });
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    const evil = await server.app.inject({
      url: `/api/public/${created.token}/state`,
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('answers 404 without details for unknown, malformed and revoked tokens', async () => {
    const created = await share(matchA);
    const del = await server.app.inject({
      method: 'DELETE',
      url: `/api/admin/share-tokens/${created.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    for (const token of [created.token, 'A'.repeat(43), 'corto']) {
      const res = await stateOf(token);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Non trovato' });
    }
  });

  it('answers 404 after the expiry', async () => {
    const created = await share(matchA, new Date(Date.now() + 60_000).toISOString());
    expect((await stateOf(created.token)).statusCode).toBe(200);
    server.setNow(new Date(Date.now() + 120_000));
    try {
      expect((await stateOf(created.token)).statusCode).toBe(404);
    } finally {
      server.setNow(null);
    }
  });

  it('rejects an expiry in the past and an unknown match', async () => {
    const past = await server.app.inject({
      method: 'POST',
      url: '/api/admin/share-tokens',
      headers: { cookie },
      payload: { label: 'x', matchId: null, expiresAt: '2020-01-01T00:00:00Z' },
    });
    expect(past.statusCode).toBe(400);
    const unknown = await server.app.inject({
      method: 'POST',
      url: '/api/admin/share-tokens',
      headers: { cookie },
      payload: { label: 'x', matchId: '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c', expiresAt: null },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('follows the current live match with a live link, while a fixed link stays on its match', async () => {
    const live = await share(null);
    const fixed = await share(matchA);
    expect((await stateOf(live.token)).json()).toMatchObject({ type: 'state', matchId: matchA });
    const matchB = await send('gara-b', 2, 30);
    expect((await stateOf(live.token)).json()).toMatchObject({ type: 'state', matchId: matchB });
    expect((await stateOf(fixed.token)).json()).toMatchObject({ type: 'state', matchId: matchA });
  });
});

describe('public WebSocket', () => {
  /** Opens a socket and collects its messages. */
  async function connect(token: string) {
    const messages: ServerMessage[] = [];
    const waiters: (() => void)[] = [];
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/public/${token}`);
    ws.addEventListener('message', (e: MessageEvent) => {
      messages.push(JSON.parse(String(e.data)) as ServerMessage);
      waiters.splice(0).forEach((w) => w());
    });
    const next = async (count: number): Promise<ServerMessage> => {
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
    return { ws, next, closed };
  }

  it('receives the state when it connects and after every ingest', async () => {
    const matchC = await send('gara-c', 3, 20);
    const live = await share(null);
    const client = await connect(live.token);
    expect(await client.next(1)).toMatchObject({ type: 'state', matchId: matchC, version: 1 });
    await send('gara-c', 3, 45);
    const second = await client.next(2);
    expect(second).toMatchObject({ type: 'state', matchId: matchC, version: 2 });
    const viaHttp = (await stateOf(live.token)).json<ServerMessage>();
    expect(second).toEqual(viaHttp);
    client.ws.close();
  });

  it('does not receive updates of another match on a fixed link', async () => {
    const matchD = await send('gara-d', 4, 10);
    const fixed = await share(matchD);
    const client = await connect(fixed.token);
    expect(await client.next(1)).toMatchObject({ type: 'state', matchId: matchD });
    await send('gara-e', 5, 10);
    await send('gara-d', 4, 12);
    expect(await client.next(2)).toMatchObject({ type: 'state', matchId: matchD, version: 2 });
    client.ws.close();
  });

  it('refuses the connection with an invalid token and closes it on revocation', async () => {
    await expect(connect('B'.repeat(43))).rejects.toThrow();
    const live = await share(null);
    const client = await connect(live.token);
    await client.next(1);
    await server.app.inject({ method: 'DELETE', url: `/api/admin/share-tokens/${live.id}`, headers: { cookie } });
    expect(await client.closed).toBe(4404);
  });

  it('closes the connection with 4404 when the token expires', async () => {
    const expiring = await share(null, new Date(Date.now() + 60_000).toISOString());
    const client = await connect(expiring.token);
    await client.next(1);
    server.setNow(new Date(Date.now() + 120_000));
    try {
      await send('gara-c', 3, 50);
      expect(await client.closed).toBe(4404);
    } finally {
      server.setNow(null);
    }
  });
});
