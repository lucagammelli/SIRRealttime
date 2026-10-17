import { Writable } from 'node:stream';
import { generateMatch } from '@sir/dvw-simulator';
import type {
  AgentRegistrationSummary,
  AgentSummary,
  CreateRegistrationResponse,
  RegistrationStatusResponse,
} from '@sir/shared';
import {
  AgentRegistrationSummarySchema,
  CreateRegistrationResponseSchema,
  RegistrationStatusResponseSchema,
} from '@sir/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, loggerOptions } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { agentRegistrations, users } from '../src/db/index.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import { hashPassword } from '../src/lib/passwords.js';
import { MAX_PENDING_REGISTRATIONS, REGISTRATION_TTL_MS } from '../src/routes/registration.js';
import type { TestServer } from './helpers.js';
import { ADMIN, fileAt, ingest, login, ORIGIN, requestFor, startServer, VIEWER } from './helpers.js';

let server: TestServer;
let adminCookie: string;
// Fixed fake clock for the whole file: tests never depend on the real date (sessions are created and checked on it).
const BASE_TIME = new Date('2026-10-15T10:00:00.000Z');

beforeAll(async () => {
  server = await startServer();
  server.setNow(BASE_TIME);
  adminCookie = await login(server.app, ADMIN);
});
afterAll(() => server.close());
beforeEach(async () => {
  await server.database.db.delete(agentRegistrations);
});
afterEach(() => server.setNow(BASE_TIME));

async function register(name = 'PC DataVolley palestra'): Promise<CreateRegistrationResponse> {
  const res = await server.app.inject({ method: 'POST', url: '/api/agents/registrations', payload: { name } });
  expect(res.statusCode).toBe(201);
  return CreateRegistrationResponseSchema.parse(res.json());
}

function statusRes(secret: string): Promise<LightMyRequestResponse> {
  return server.app.inject({
    method: 'POST',
    url: '/api/agents/registrations/status',
    headers: { authorization: `Bearer ${secret}` },
    payload: {},
  });
}

async function status(secret: string): Promise<RegistrationStatusResponse> {
  const res = await statusRes(secret);
  expect(res.statusCode).toBe(200);
  return RegistrationStatusResponseSchema.parse(res.json());
}

function decide(id: string, action: 'approve' | 'reject', cookie = adminCookie): Promise<LightMyRequestResponse> {
  return server.app.inject({
    method: 'POST',
    url: `/api/admin/agent-registrations/${id}/${action}`,
    headers: { cookie },
    payload: {},
  });
}

async function pendingList(): Promise<AgentRegistrationSummary[]> {
  const res = await server.app.inject({ url: '/api/admin/agent-registrations', headers: { cookie: adminCookie } });
  expect(res.statusCode).toBe(200);
  return res.json<unknown[]>().map((r) => AgentRegistrationSummarySchema.parse(r));
}

describe('agent registration', () => {
  it('creates a pending request with a secret, a pairing code and a 24 h expiry', async () => {
    const now = BASE_TIME;
    server.setNow(now);
    const reg = await register();
    expect(reg.pairingCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(reg.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reg.expiresAt).toBe(new Date(now.getTime() + REGISTRATION_TTL_MS).toISOString());
    expect(await status(reg.secret)).toEqual({ status: 'pending', expiresAt: reg.expiresAt });

    const [row] = await server.database.db.select().from(agentRegistrations);
    expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(reg.secret);

    const list = await pendingList();
    expect(list).toEqual([
      {
        id: reg.registrationId,
        name: 'PC DataVolley palestra',
        pairingCode: reg.pairingCode,
        ip: '127.0.0.1',
        createdAt: now.toISOString(),
        expiresAt: reg.expiresAt,
        status: 'pending',
      },
    ]);
  });

  it('delivers the token once after the approval, and the token works for the ingest', async () => {
    const reg = await register('PC scout');
    const approved = await decide(reg.registrationId, 'approve');
    expect(approved.statusCode).toBe(200);
    expect(approved.json<AgentRegistrationSummary>().status).toBe('approved');
    expect(approved.body).not.toContain(reg.secret);
    expect(await pendingList()).toEqual([]);

    const first = await status(reg.secret);
    if (first.status !== 'approved') throw new Error(`expected approved, got ${first.status}`);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await status(reg.secret)).toEqual({ status: 'consumed' });
    expect(await status(reg.secret)).toEqual({ status: 'consumed' });

    const agents = await server.app.inject({ url: '/api/admin/agents', headers: { cookie: adminCookie } });
    const agent = agents.json<AgentSummary[]>().find((a) => a.id === first.agentId);
    expect(agent).toMatchObject({ name: 'PC scout', revoked: false });
    expect(agents.body).not.toContain(first.token);

    const [row] = await server.database.db.select().from(agentRegistrations);
    expect(row).toMatchObject({ status: 'consumed', agentId: first.agentId });

    const body = await requestFor('gara-registrata', 0, [], fileAt(generateMatch({ seed: 7 }), 10));
    const res = await ingest(server.app, first.token, body);
    expect(res.statusCode).toBe(200);
  });

  it('gives the token to only one of two concurrent queries', async () => {
    const reg = await register();
    expect((await decide(reg.registrationId, 'approve')).statusCode).toBe(200);
    const answers = await Promise.all([status(reg.secret), status(reg.secret), status(reg.secret)]);
    expect(answers.filter((a) => a.status === 'approved')).toHaveLength(1);
    expect(answers.filter((a) => a.status === 'consumed')).toHaveLength(2);
  });

  it('reports a rejection and does not create an agent', async () => {
    const reg = await register('PC sconosciuto');
    const rejected = await decide(reg.registrationId, 'reject');
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json<AgentRegistrationSummary>().status).toBe('rejected');
    expect(await status(reg.secret)).toEqual({ status: 'rejected' });
    expect((await decide(reg.registrationId, 'approve')).statusCode).toBe(404);
    expect(await status(reg.secret)).toEqual({ status: 'rejected' });
    const agents = await server.app.inject({ url: '/api/admin/agents', headers: { cookie: adminCookie } });
    expect(agents.json<AgentSummary[]>().some((a) => a.name === 'PC sconosciuto')).toBe(false);
  });

  it('expires a pending request after 24 h: no longer listed nor approvable', async () => {
    const start = BASE_TIME;
    server.setNow(start);
    const reg = await register();
    server.setNow(new Date(start.getTime() + REGISTRATION_TTL_MS));
    adminCookie = await login(server.app, ADMIN); // the earlier session expired with the clock
    expect(await status(reg.secret)).toEqual({ status: 'expired' });
    expect(await pendingList()).toEqual([]);
    expect((await decide(reg.registrationId, 'approve')).statusCode).toBe(404);
    expect((await decide(reg.registrationId, 'reject')).statusCode).toBe(404);
  });

  it('expires an approved request not collected within 24 h, without delivering the token', async () => {
    const start = BASE_TIME;
    server.setNow(start);
    const reg = await register('PC in ritardo');
    expect((await decide(reg.registrationId, 'approve')).statusCode).toBe(200);
    server.setNow(new Date(start.getTime() + REGISTRATION_TTL_MS + 1));
    adminCookie = await login(server.app, ADMIN);
    expect(await status(reg.secret)).toEqual({ status: 'expired' });
    const agents = await server.app.inject({ url: '/api/admin/agents', headers: { cookie: adminCookie } });
    expect(agents.json<AgentSummary[]>().some((a) => a.name === 'PC in ritardo')).toBe(false);
  });

  it('answers 401 to a wrong, missing or malformed secret', async () => {
    const reg = await register();
    expect((await statusRes('b'.repeat(43))).statusCode).toBe(401);
    expect((await statusRes(`${reg.secret}x`)).statusCode).toBe(401);
    expect((await statusRes('corto')).statusCode).toBe(401);
    const none = await server.app.inject({
      method: 'POST',
      url: '/api/agents/registrations/status',
      payload: {},
    });
    expect(none.statusCode).toBe(401);
    expect(none.json()).toEqual({ error: 'Non autorizzato' });
  });

  it('does not accept the registration secret as an agent token', async () => {
    const reg = await register();
    const body = await requestFor('gara-segreto', 0, [], fileAt(generateMatch({ seed: 8 }), 5));
    expect((await ingest(server.app, reg.secret, body)).statusCode).toBe(401);
  });

  it(`refuses a new request over ${MAX_PENDING_REGISTRATIONS} pending ones with 429`, async () => {
    const regs: CreateRegistrationResponse[] = [];
    for (let i = 0; i < MAX_PENDING_REGISTRATIONS; i++) regs.push(await register(`PC ${i}`));
    const over = await server.app.inject({
      method: 'POST',
      url: '/api/agents/registrations',
      payload: { name: 'PC in più' },
    });
    expect(over.statusCode).toBe(429);
    expect(over.json<{ error: string }>().error).toMatch(/in attesa/);
    expect(await pendingList()).toHaveLength(MAX_PENDING_REGISTRATIONS);

    const first = regs[0];
    if (!first) throw new Error('no registration');
    expect((await decide(first.registrationId, 'reject')).statusCode).toBe(200);
    await register('PC dopo il rifiuto');
  });

  it('rejects invalid names, control characters and non JSON bodies', async () => {
    for (const payload of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: 'pc\r\nSet-Cookie: x=1' },
      { name: 'pc\u001b[31m' },
      { name: 'pc\u0000' },
      { name: 42 },
    ]) {
      const res = await server.app.inject({ method: 'POST', url: '/api/agents/registrations', payload });
      expect(res.statusCode).toBe(400);
    }
    const text = await server.app.inject({
      method: 'POST',
      url: '/api/agents/registrations',
      headers: { 'content-type': 'text/plain' },
      payload: 'name=pc',
    });
    expect(text.statusCode).toBe(415);
    expect(await pendingList()).toEqual([]);
  });

  it('rejects a foreign Origin and accepts the portal one', async () => {
    const evil = await server.app.inject({
      method: 'POST',
      url: '/api/agents/registrations',
      headers: { origin: 'https://evil.example' },
      payload: { name: 'pc' },
    });
    expect(evil.statusCode).toBe(403);
    const ok = await server.app.inject({
      method: 'POST',
      url: '/api/agents/registrations',
      headers: { origin: ORIGIN },
      payload: { name: 'pc' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('answers 404 to an unknown id and 400 to a malformed one', async () => {
    expect((await decide('6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', 'approve')).statusCode).toBe(404);
    expect((await decide('non-un-uuid', 'reject')).statusCode).toBe(400);
  });
});

describe('admin routes of the registrations', () => {
  it('are for admins only: anonymous 401, viewer 403', async () => {
    const reg = await register();
    const viewer = await login(server.app, VIEWER);
    const list = (cookie?: string) =>
      server.app.inject({ url: '/api/admin/agent-registrations', headers: cookie ? { cookie } : {} });
    expect((await list()).statusCode).toBe(401);
    expect((await list(viewer)).statusCode).toBe(403);
    for (const action of ['approve', 'reject'] as const) {
      const anon = await server.app.inject({
        method: 'POST',
        url: `/api/admin/agent-registrations/${reg.registrationId}/${action}`,
        payload: {},
      });
      expect(anon.statusCode).toBe(401);
      expect((await decide(reg.registrationId, action, viewer)).statusCode).toBe(403);
    }
    expect(await status(reg.secret)).toEqual({ status: 'pending', expiresAt: reg.expiresAt });
  });

  it('lists only pending requests, most recent first', async () => {
    server.setNow(BASE_TIME);
    const a = await register('PC A');
    server.setNow(new Date('2026-10-15T10:01:00.000Z'));
    const b = await register('PC B');
    server.setNow(new Date('2026-10-15T10:02:00.000Z'));
    const c = await register('PC C');
    expect((await decide(b.registrationId, 'reject')).statusCode).toBe(200);
    expect((await pendingList()).map((r) => r.id)).toEqual([c.registrationId, a.registrationId]);
  });
});

describe('rate limit of the registration', () => {
  it('limits the requests per minute and per IP', async () => {
    const limited = await startServer({ register: 2 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/agents/registrations',
          payload: { name: `PC ${i}` },
        });
        codes.push(res.statusCode);
      }
      expect(codes).toEqual([201, 201, 429]);
    } finally {
      await limited.close();
    }
  });

  it('limits the status queries too', async () => {
    const limited = await startServer({ ingest: 2 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/agents/registrations/status',
          headers: { authorization: `Bearer ${'c'.repeat(43)}` },
          payload: {},
        });
        codes.push(res.statusCode);
      }
      expect(codes).toEqual([401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('logs', () => {
  it('never contain the secret or the token', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const database = createPgliteDatabase();
    await database.migrate();
    await database.db
      .insert(users)
      // A superadmin without client: it works on the client of the hostname («Predefinito», the default).
      .values({ email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password), role: 'superadmin' });
    const options = loggerOptions('info');
    if (typeof options !== 'object') throw new Error('logger options expected');
    const app = await buildApp({
      config: loadConfig({ DATABASE_URL: 'pglite:memory', CORS_ORIGIN: ORIGIN, COOKIE_SECURE: 'false' }),
      db: database.db,
      logger: { ...options, stream },
    });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/agents/registrations', payload: { name: 'pc' } });
      const reg = CreateRegistrationResponseSchema.parse(created.json());
      const cookie = await login(app, ADMIN);
      await app.inject({
        method: 'POST',
        url: `/api/admin/agent-registrations/${reg.registrationId}/approve`,
        headers: { cookie },
        payload: {},
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/agents/registrations/status',
        headers: { authorization: `Bearer ${reg.secret}` },
        payload: {},
      });
      const answer = RegistrationStatusResponseSchema.parse(res.json());
      if (answer.status !== 'approved') throw new Error('not approved');
      const all = lines.join('');
      expect(all).toContain('agente registrato: token consegnato');
      expect(all).not.toContain(reg.secret);
      expect(all).not.toContain(answer.token);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
