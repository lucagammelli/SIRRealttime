import { generateMatch } from '@arenalive/dvw-simulator';
import type { IngestResponse, ServerMessage } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matches } from '../src/db/index.js';
import { finishedAtField } from '../src/state.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createAgent, fileAt, ingest, login, requestFor, startServer } from './helpers.js';

let server: TestServer;
let token: string;
let cookie: string;

beforeAll(async () => {
  server = await startServer();
  token = await createAgent(server);
  cookie = await login(server.app, ADMIN);
});
afterAll(() => server.close());

const KEY = 'gara-fine';
const match = generateMatch({ seed: 21, sets: 3 });
const total = match.lines.length;
let seq = 0;
let prev: string[] = [];

async function send(upTo: number, at: string): Promise<void> {
  server.setNow(new Date(at));
  const file = fileAt(match, upTo);
  const res = await ingest(server.app, token, await requestFor(KEY, seq, prev, file));
  expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok', lineCount: upTo });
  prev = file.scoutLines;
  seq++;
}

async function row() {
  const [r] = await server.database.db.select().from(matches).where(eq(matches.matchKey, KEY));
  if (!r) throw new Error('match missing');
  return r;
}

/** First message of the admin WebSocket: the live state, as the hub holds it. */
async function liveMessage(): Promise<ServerMessage> {
  let resolveFirst: (m: ServerMessage) => void = () => undefined;
  const received = new Promise<ServerMessage>((resolve) => {
    resolveFirst = resolve;
  });
  const ws = await server.app.injectWS(
    '/ws/admin',
    { headers: { cookie } },
    { onInit: (s) => s.once('message', (data: Buffer) => resolveFirst(JSON.parse(data.toString()) as ServerMessage)) },
  );
  const first = await received;
  ws.terminate();
  return first;
}

describe('finished_at of a match', () => {
  it('is null while the match is played', async () => {
    await send(total - 3, '2026-10-23T18:00:00.000Z');
    const r = await row();
    expect(r.state?.status).not.toBe('finished');
    expect(r.finishedAt).toBeNull();
    expect(await liveMessage()).not.toHaveProperty('finishedAt');
  });

  it('is set when the match ends, and sent as finishedAt', async () => {
    await send(total, '2026-10-23T19:00:00.000Z');
    const r = await row();
    expect(r.state?.status).toBe('finished');
    expect(r.finishedAt?.toISOString()).toBe('2026-10-23T19:00:00.000Z');
    expect(await liveMessage()).toMatchObject({ type: 'state', finishedAt: '2026-10-23T19:00:00.000Z' });
  });

  it('is kept by a later change that leaves the match finished', async () => {
    server.setNow(new Date('2026-10-23T19:10:00.000Z'));
    const file = { ...fileAt(match, total), header: `${fileAt(match, total).header}\r\n` };
    const res = await ingest(server.app, token, await requestFor(KEY, seq++, prev, file));
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok' });
    const r = await row();
    expect(r.updatedAt.toISOString()).toBe('2026-10-23T19:10:00.000Z');
    expect(r.finishedAt?.toISOString()).toBe('2026-10-23T19:00:00.000Z');
  });

  it('is cleared when a correction takes the match out of finished, and set again at the new end', async () => {
    await send(total - 3, '2026-10-23T19:20:00.000Z');
    expect((await row()).finishedAt).toBeNull();
    expect(await liveMessage()).not.toHaveProperty('finishedAt');
    await send(total, '2026-10-23T19:30:00.000Z');
    expect((await row()).finishedAt?.toISOString()).toBe('2026-10-23T19:30:00.000Z');
  });

  it('for a match finished before the column existed, keeps its last update as the end', async () => {
    const before = await row();
    await server.database.db.update(matches).set({ finishedAt: null }).where(eq(matches.id, before.id));
    server.setNow(new Date('2026-10-23T20:00:00.000Z'));
    const file = { ...fileAt(match, total), header: `${fileAt(match, total).header}\r\n` };
    const res = await ingest(server.app, token, await requestFor(KEY, seq++, prev, file));
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok' });
    expect((await row()).finishedAt?.toISOString()).toBe(before.updatedAt.toISOString());
  });
});

describe('finishedAtField', () => {
  const updated = new Date('2026-10-23T21:00:00.000Z');
  it('gives the end only for a finished state, the last update when the end is unknown', () => {
    const end = new Date('2026-10-23T20:30:00.000Z');
    expect(finishedAtField({ status: 'finished' }, end, updated)).toEqual({ finishedAt: end.toISOString() });
    expect(finishedAtField({ status: 'finished' }, null, updated)).toEqual({ finishedAt: updated.toISOString() });
    expect(finishedAtField({ status: 'inProgress' } as never, end, updated)).toEqual({});
  });
});
