import { parseDvw } from '@sir/dvw-parser';
import { applyCorrection, generateMatch, renderDvw } from '@sir/dvw-simulator';
import type { GeneratedMatch } from '@sir/dvw-simulator';
import type { IngestResponse, MatchDetail, ServerMessage } from '@sir/shared';
import { hashScoutLines } from '@sir/shared';
import { computeMatchState } from '@sir/volley-stats';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matches, scoutLines } from '../src/db/index.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createAgent, fileAt, ingest, login, ORIGIN, requestFor, startServer } from './helpers.js';

const expectedState = (match: GeneratedMatch, upTo: number): unknown =>
  JSON.parse(JSON.stringify(computeMatchState(parseDvw(renderDvw(match, upTo))))) as unknown;

let server: TestServer;
let token: string;
let cookie: string;

beforeAll(async () => {
  server = await startServer();
  token = await createAgent(server);
  cookie = await login(server.app, ADMIN);
});
afterAll(() => server.close());

async function detail(id: string): Promise<MatchDetail> {
  const res = await server.app.inject({ url: `/api/admin/matches/${id}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json<MatchDetail>();
}

async function matchRow(matchKey: string) {
  const [row] = await server.database.db.select().from(matches).where(eq(matches.matchKey, matchKey));
  if (!row) throw new Error('match missing');
  return row;
}

/** Sends the whole match in progressive appends; returns the lines the server holds and the next seq. */
async function sendProgressively(matchKey: string, match: GeneratedMatch, steps: number[]) {
  let prev: string[] = [];
  let seq = 0;
  for (const upTo of steps) {
    const file = fileAt(match, upTo);
    const body = await requestFor(matchKey, seq, prev, file);
    expect(body.kind).toBe('append');
    const res = await ingest(server.app, token, body);
    expect(res.statusCode).toBe(200);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok', seq, lineCount: upTo });
    prev = file.scoutLines;
    seq++;
  }
  return { prev, seq };
}

describe('POST /api/ingest', () => {
  const match = generateMatch({ seed: 11, sets: 5 });
  const total = match.lines.length;
  const steps = [0, 1, 25, 26, 140, Math.floor(total / 2), total - 3, total];

  it('rebuilds the whole match sent in progressive appends', async () => {
    await sendProgressively('gara-intera', match, steps);
    const row = await matchRow('gara-intera');
    expect(row.lineCount).toBe(total);
    expect(row.live).toBe(true);
    expect(row.version).toBe(steps.length);
    const d = await detail(row.id);
    expect(d.state).toEqual(expectedState(match, total));
    expect(d.status).toBe('finished');
    const stored = await server.database.db.select().from(scoutLines).where(eq(scoutLines.matchId, row.id));
    expect(stored).toHaveLength(total);
  });

  it('answers duplicate to a seq already seen, without changes', async () => {
    const before = await matchRow('gara-intera');
    const file = fileAt(match, total);
    const body = await requestFor('gara-intera', 3, file.scoutLines, file);
    const res = await ingest(server.app, token, body);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'duplicate', seq: steps.length - 1, lineCount: total });
    expect((await matchRow('gara-intera')).version).toBe(before.version);
  });

  it('answers needSnapshot to an append with a wrong fromIndex', async () => {
    const m = generateMatch({ seed: 12 });
    const { prev, seq } = await sendProgressively('gara-salto', m, [0, 30]);
    const file = fileAt(m, 50);
    const body = {
      ...(await requestFor('gara-salto', seq, prev, file)),
      fromIndex: 31,
      lines: file.scoutLines.slice(31),
    };
    const res = await ingest(server.app, token, body);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'needSnapshot', seq: seq - 1, lineCount: 30 });
    expect(res.json<IngestResponse>().contentHash).toBe(await hashScoutLines(prev));
  });

  it('answers needSnapshot to a wrong hash and changes nothing', async () => {
    const m = generateMatch({ seed: 13 });
    const { prev, seq } = await sendProgressively('gara-hash', m, [0, 40]);
    const before = await matchRow('gara-hash');
    const body = await requestFor('gara-hash', seq, prev, fileAt(m, 60));
    const res = await ingest(server.app, token, { ...body, contentHash: 'f'.repeat(64) });
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'needSnapshot', lineCount: 40 });
    const after = await matchRow('gara-hash');
    expect(after).toEqual(before);
    const stored = await server.database.db.select().from(scoutLines).where(eq(scoutLines.matchId, before.id));
    expect(stored).toHaveLength(40);
    // The same seq is still usable after the rejection.
    const ok = await ingest(server.app, token, body);
    expect(ok.json<IngestResponse>()).toMatchObject({ status: 'ok', lineCount: 60 });
  });

  it('asks for a snapshot when a new match starts without header', async () => {
    const m = generateMatch({ seed: 14 });
    const body = await requestFor('gara-senza-header', 0, [], fileAt(m, 10));
    const { header: _header, ...noHeader } = body;
    const res = await ingest(server.app, token, noHeader);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'needSnapshot', seq: -1, lineCount: 0 });
    const rows = await server.database.db.select().from(matches).where(eq(matches.matchKey, 'gara-senza-header'));
    expect(rows).toHaveLength(0);
  });

  it('applies a snapshot after the correction of a past line', async () => {
    const m = generateMatch({ seed: 15, sets: 4 });
    const n = m.lines.length;
    const { prev, seq } = await sendProgressively('gara-correzione', m, [0, 100, n]);
    const corrected = applyCorrection(m, 50, 99, n);
    const file = fileAt(corrected, n);
    const body = await requestFor('gara-correzione', seq, prev, file);
    expect(body.kind).toBe('snapshot');
    const res = await ingest(server.app, token, body);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok', lineCount: n });
    const row = await matchRow('gara-correzione');
    expect(row.contentHash).toBe(await hashScoutLines(file.scoutLines));
    expect((await detail(row.id)).state).toEqual(expectedState(corrected, n));
    const stored = await server.database.db
      .select({ text: scoutLines.text })
      .from(scoutLines)
      .where(eq(scoutLines.matchId, row.id))
      .orderBy(scoutLines.idx);
    expect(stored.map((r) => r.text)).toEqual(file.scoutLines);
  });

  it('applies a snapshot that removes lines', async () => {
    const m = generateMatch({ seed: 16 });
    const { seq } = await sendProgressively('gara-taglio', m, [0, 80]);
    const file = fileAt(m, 60);
    const body = await requestFor('gara-taglio', seq, fileAt(m, 80).scoutLines, file);
    expect(body.kind).toBe('snapshot');
    const res = await ingest(server.app, token, body);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok', lineCount: 60 });
    expect((await detail((await matchRow('gara-taglio')).id)).state).toEqual(expectedState(m, 60));
  });

  it('accepts a gzip body', async () => {
    const m = generateMatch({ seed: 17 });
    const body = await requestFor('gara-gzip', 0, [], fileAt(m, m.lines.length));
    const res = await ingest(server.app, token, body, { gzip: true });
    expect(res.statusCode).toBe(200);
    expect(res.json<IngestResponse>()).toMatchObject({ status: 'ok', lineCount: m.lines.length });
  });

  it('keeps a single live match and the public live state follows it', async () => {
    const live = await server.database.db.select().from(matches).where(eq(matches.live, true));
    expect(live.map((r) => r.matchKey)).toEqual(['gara-gzip']);
  });

  it('serves the same state from the admin WebSocket', async () => {
    let resolveFirst: (m: ServerMessage) => void = () => undefined;
    const received = new Promise<ServerMessage>((resolve) => {
      resolveFirst = resolve;
    });
    const ws = await server.app.injectWS(
      '/ws/admin',
      { headers: { cookie } },
      {
        onInit: (s) => s.once('message', (data: Buffer) => resolveFirst(JSON.parse(data.toString()) as ServerMessage)),
      },
    );
    const first = await received;
    ws.terminate();
    expect(first.type).toBe('state');
    if (first.type === 'state') expect(first.matchId).toBe((await matchRow('gara-gzip')).id);
  });
});

describe('admin WebSocket', () => {
  it('refuses a foreign Origin and a missing session', async () => {
    await expect(
      server.app.injectWS('/ws/admin', { headers: { cookie, origin: 'https://evil.example' } }),
    ).rejects.toThrow();
    await expect(server.app.injectWS('/ws/admin')).rejects.toThrow();
  });

  it('is closed with 4401 when its session logs out', async () => {
    const own = await login(server.app, ADMIN);
    const other = await server.app.injectWS('/ws/admin', { headers: { cookie } });
    const ws = await server.app.injectWS('/ws/admin', { headers: { cookie: own, origin: ORIGIN } });
    const closed = new Promise<number>((resolve) => ws.once('close', (code: number) => resolve(code)));
    let otherClosed = false;
    other.once('close', () => {
      otherClosed = true;
    });
    const out = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: own },
      payload: {},
    });
    expect(out.statusCode).toBe(204);
    expect(await closed).toBe(4401);
    expect(otherClosed).toBe(false);
    other.terminate();
  });
});

describe('agent authentication', () => {
  it('rejects a missing token', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/api/ingest', payload: {} });
    expect(res.statusCode).toBe(401);
  });
  it('rejects an unknown token', async () => {
    expect((await ingest(server.app, 'x'.repeat(43), {})).statusCode).toBe(401);
  });
  it('rejects a revoked token', async () => {
    const revoked = await createAgent(server, true);
    expect((await ingest(server.app, revoked, {})).statusCode).toBe(401);
  });
  it('rejects a token revoked from the admin API', async () => {
    const created = await server.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      headers: { cookie },
      payload: { name: 'PC palestra' },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json<{ id: string; token: string }>();
    const m = generateMatch({ seed: 18 });
    const body = await requestFor('gara-agente', 0, [], fileAt(m, 5));
    expect((await ingest(server.app, agent.token, body)).statusCode).toBe(200);
    const list = await server.app.inject({ url: '/api/admin/agents', headers: { cookie } });
    const listed = list.json<{ id: string; lastSeenAt: string | null }[]>().find((a) => a.id === agent.id);
    expect(listed?.lastSeenAt).not.toBeNull();
    expect(JSON.stringify(list.json())).not.toContain(agent.token);
    const del = await server.app.inject({
      method: 'DELETE',
      url: `/api/admin/agents/${agent.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    expect((await ingest(server.app, agent.token, { ...body, seq: 1 })).statusCode).toBe(401);
  });
});

describe('concurrent ingests on the same match', () => {
  /** Lines stored for the match, checked to be one row per index 0..n-1. */
  async function storedLines(matchKey: string): Promise<string[]> {
    const row = await matchRow(matchKey);
    const rows = await server.database.db
      .select({ idx: scoutLines.idx, text: scoutLines.text })
      .from(scoutLines)
      .where(eq(scoutLines.matchId, row.id));
    const sorted = [...rows].sort((a, b) => a.idx - b.idx);
    expect(sorted.map((r) => r.idx)).toEqual(sorted.map((_r, i) => i));
    return sorted.map((r) => r.text);
  }

  it('keeps a coherent state with appends and snapshots sent together', async () => {
    const m = generateMatch({ seed: 21 });
    const [f10, f20, f30] = [fileAt(m, 10), fileAt(m, 20), fileAt(m, 30)];
    const bodies = [
      await requestFor('gara-concorrente', 0, [], f10),
      await requestFor('gara-concorrente', 1, f10.scoutLines, f20),
      await requestFor('gara-concorrente', 2, ['diversa'], f30),
      await requestFor('gara-concorrente', 3, f30.scoutLines, fileAt(m, 40)),
    ];
    expect(bodies.map((b) => b.kind)).toEqual(['append', 'append', 'snapshot', 'append']);
    const responses = await Promise.all(bodies.map((b) => ingest(server.app, token, b)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);

    const row = await matchRow('gara-concorrente');
    const lines = await storedLines('gara-concorrente');
    expect(lines.length).toBe(row.lineCount);
    expect(row.contentHash).toBe(await hashScoutLines(lines));
    expect(lines).toEqual(fileAt(m, lines.length).scoutLines);
    expect(JSON.parse(JSON.stringify(row.state))).toEqual(expectedState(m, lines.length));
    const accepted = responses.map((r) => r.json<IngestResponse>()).filter((r) => r.status === 'ok');
    expect(row.version).toBe(new Set(accepted.map((r) => r.seq)).size);
  });

  it('accepts the same request sent many times together only once', async () => {
    const m = generateMatch({ seed: 22 });
    const body = await requestFor('gara-doppia', 0, [], fileAt(m, 15));
    const responses = await Promise.all(Array.from({ length: 6 }, () => ingest(server.app, token, body)));
    const statuses = responses.map((r) => r.json<IngestResponse>().status).sort();
    expect(statuses).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'ok']);
    expect(await storedLines('gara-doppia')).toEqual(fileAt(m, 15).scoutLines);
    expect((await matchRow('gara-doppia')).version).toBe(1);
  });
});
