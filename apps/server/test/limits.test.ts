import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { generateMatch } from '@arenalive/dvw-simulator';
import { HealthResponseSchema, INGEST_MAX_WIRE_BYTES } from '@arenalive/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { ADMIN, createAgent, fileAt, ingest, login, requestFor, startServer } from './helpers.js';

/** The root package.json is the only source of the version. */
const rootVersion = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

let server: TestServer;
let token: string;
beforeAll(async () => {
  server = await startServer({ login: 3 });
  token = await createAgent(server);
});
afterAll(() => server.close());

const post = (payload: Buffer, headers: Record<string, string> = {}) =>
  server.app.inject({
    method: 'POST',
    url: '/api/ingest',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    payload,
  });

describe('ingest limits', () => {
  it('rejects a body over the wire limit with 413', async () => {
    const res = await post(Buffer.alloc(INGEST_MAX_WIRE_BYTES + 10, 0x20));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'Richiesta troppo grande' });
  });

  it('rejects a gzip body that expands over the decoded limit with 413', async () => {
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
    expect(bomb.length).toBeLessThan(INGEST_MAX_WIRE_BYTES);
    const res = await post(bomb, { 'content-encoding': 'gzip' });
    expect(res.statusCode).toBe(413);
  });

  it('rejects an invalid gzip body with 400 and an unknown encoding with 415', async () => {
    expect((await post(Buffer.from('non gzip'), { 'content-encoding': 'gzip' })).statusCode).toBe(400);
    expect((await post(Buffer.from('{}'), { 'content-encoding': 'br' })).statusCode).toBe(415);
  });

  it('rejects malformed JSON and a body that breaks the schema with 400 and no details', async () => {
    const bad = await post(Buffer.from('{"protocol":'));
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'Richiesta non valida' });
    const body = await requestFor('gara-limiti', 0, [], fileAt(generateMatch({ seed: 1 }), 5));
    const res = await ingest(server.app, token, { ...body, protocol: 2, lines: ['x'.repeat(2001)] });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/^Richiesta non valida: /);
    expect(res.body).not.toContain('stack');
  });

  it('rejects NUL in a scout line, in the header and in an unknown field with 400', async () => {
    const body = await requestFor('gara-nul', 0, [], fileAt(generateMatch({ seed: 2 }), 5));
    for (const bad of [
      { ...body, lines: [...body.lines.slice(0, 4), 'x\u0000'] },
      { ...body, header: `${body.header ?? ''}\u0000` },
      { ...body, extra: '\u0000' },
    ]) {
      const res = await ingest(server.app, token, bad);
      expect(res.statusCode).toBe(400);
    }
    expect((await ingest(server.app, token, body)).statusCode).toBe(200);
  });

  it('rejects a non JSON content type with 415', async () => {
    expect((await post(Buffer.from('x'), { 'content-type': 'text/plain' })).statusCode).toBe(415);
  });
});

describe('rate limit', () => {
  it('limits the login attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: 'sbagliata-davvero' },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429]);
  });
});

describe('rate limit before authentication', () => {
  let strict: TestServer;
  beforeAll(async () => {
    strict = await startServer({ ingest: 3, public: 3, publicWs: 3, publicInvalid: 3, admin: 3 });
  });
  afterAll(() => strict.close());

  const codesOf = async (count: number, run: () => Promise<{ statusCode: number }>): Promise<number[]> => {
    const codes: number[] = [];
    for (let i = 0; i < count; i++) codes.push((await run()).statusCode);
    return codes;
  };

  it('counts the ingest requests with a wrong token and answers 429', async () => {
    const codes = await codesOf(5, () => ingest(strict.app, 'x'.repeat(43), {}));
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it('counts the public requests with an unknown token, on HTTP and WebSocket together', async () => {
    const codes = await codesOf(4, () => strict.app.inject({ url: `/api/public/${'A'.repeat(43)}/state` }));
    expect(codes).toEqual([404, 404, 404, 429]);
    const ws = await strict.app.inject({ url: `/ws/public/${'A'.repeat(43)}` });
    expect(ws.statusCode).toBe(429);
    expect(Number(ws.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts the admin requests rejected by the Origin check and without session', async () => {
    const cookie = await login(strict.app, ADMIN);
    const foreign = () =>
      strict.app.inject({
        method: 'POST',
        url: '/api/admin/agents',
        headers: { cookie, origin: 'https://evil.example' },
        payload: { name: 'x' },
      });
    expect(await codesOf(4, foreign)).toEqual([403, 403, 403, 429]);
    const anonymous = () => strict.app.inject({ url: '/api/admin/matches' });
    expect(await codesOf(4, anonymous)).toEqual([401, 401, 401, 429]);
  });
});

describe('lines per match', () => {
  let small: TestServer;
  let agent: string;
  beforeAll(async () => {
    small = await startServer({}, { MATCH_MAX_LINES: '10' });
    agent = await createAgent(small);
  });
  afterAll(() => small.close());

  it('answers 413 with a clear message over MATCH_MAX_LINES, with append and snapshot', async () => {
    const m = generateMatch({ seed: 3 });
    const ten = fileAt(m, 10);
    expect((await ingest(small.app, agent, await requestFor('gara-lunga', 0, [], ten))).statusCode).toBe(200);
    const more = await requestFor('gara-lunga', 1, ten.scoutLines, fileAt(m, 11));
    const append = await ingest(small.app, agent, more);
    expect(append.statusCode).toBe(413);
    expect(append.json()).toEqual({ error: 'Troppe righe per una partita (massimo 10)' });
    const snapshot = await ingest(small.app, agent, await requestFor('gara-lunga', 2, ['diversa'], fileAt(m, 12)));
    expect(snapshot.statusCode).toBe(413);
    const again = await ingest(small.app, agent, await requestFor('gara-lunga', 3, ten.scoutLines, ten));
    expect(again.json()).toMatchObject({ status: 'ok', lineCount: 10 });
  });
});

describe('misc', () => {
  it('answers the health check without authentication', async () => {
    const res = await server.app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.strict().parse(res.json());
    expect(body.version).toBe(rootVersion);
  });

  it('answers 404 with a generic body and sets the security headers', async () => {
    const res = await server.app.inject({ url: '/api/nulla' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Non trovato' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
