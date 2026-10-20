import type { MeResponse, UserSummary } from '@arenalive/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/context.js';
import type { TestServer } from './helpers.js';
import { ADMIN, login, ORIGIN, startServer, VIEWER } from './helpers.js';

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

describe('login', () => {
  it('logs in with the right password and sets a safe session cookie', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    expect(res.statusCode).toBe(200);
    expect(res.json<MeResponse>()).toMatchObject({ email: ADMIN.email, role: 'admin' });
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('accepts the email in any case', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { ...ADMIN, email: ADMIN.email.toUpperCase() },
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['wrong password', { email: ADMIN.email, password: 'sbagliata-davvero' }],
    ['unknown user', { email: 'nessuno@sir.test', password: 'qualcosa-di-lungo' }],
  ])('rejects a %s with the same answer', async (_name, payload) => {
    const res = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Credenziali non valide' });
    expect(res.cookies).toHaveLength(0);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'email=a',
    });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a foreign Origin on routes that change data', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: ADMIN,
    });
    expect(res.statusCode).toBe(403);
    const ok = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: ADMIN,
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('NUL and control characters', () => {
  it('answers 400, not 500, to a login with NUL in a field', async () => {
    for (const payload of [
      { email: 'admin\u0000@sir.test', password: 'x' },
      { email: ADMIN.email, password: 'x\u0000' },
      { email: ADMIN.email, password: ADMIN.password, extra: '\u0000' },
    ]) {
      const res = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toMatch(/^Richiesta non valida/);
    }
  });

  it('rejects control characters in agent names, link labels and user emails', async () => {
    const cookie = await login(server.app, ADMIN);
    const post = (url: string, payload: object) =>
      server.app.inject({ method: 'POST', url, headers: { cookie }, payload });
    expect((await post('/api/admin/agents', { name: 'any\r\nSet-cookie: Tamper=1' })).statusCode).toBe(400);
    expect((await post('/api/admin/agents', { name: 'pc\u0000' })).statusCode).toBe(400);
    const label = { label: 'Tri\u001bbuna', matchId: null, expiresAt: null };
    expect((await post('/api/admin/share-tokens', label)).statusCode).toBe(400);
    const user = { email: 'nuovo\u007f@sir.test', password: 'password-lunga-1', role: 'viewer' };
    expect((await post('/api/admin/users', user)).statusCode).toBe(400);
    const agents = await server.app.inject({ url: '/api/admin/agents', headers: { cookie } });
    expect(agents.json()).toEqual([]);
  });
});

describe('sessions and roles', () => {
  it.each(['/api/auth/me', '/api/admin/matches', '/api/admin/agents', '/api/admin/share-tokens', '/api/admin/users'])(
    '%s without session → 401',
    async (url) => {
      expect((await server.app.inject({ url })).statusCode).toBe(401);
    },
  );

  it('rejects a forged session cookie', async () => {
    const res = await server.app.inject({
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${'a'.repeat(43)}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets a viewer read, but not the users and the registrations of the agents', async () => {
    const cookie = await login(server.app, VIEWER);
    expect((await server.app.inject({ url: '/api/auth/me', headers: { cookie } })).json<MeResponse>().role).toBe(
      'viewer',
    );
    for (const url of ['/api/admin/matches', '/api/admin/agents', '/api/admin/share-tokens', '/api/admin/calendar']) {
      expect((await server.app.inject({ url, headers: { cookie } })).statusCode).toBe(200);
    }
    for (const url of ['/api/admin/users', '/api/admin/agent-registrations']) {
      expect((await server.app.inject({ url, headers: { cookie } })).statusCode).toBe(403);
    }
    const post = await server.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      headers: { cookie },
      payload: { name: 'x' },
    });
    expect(post.statusCode).toBe(403);
  });

  it('expires the session after SESSION_TTL_HOURS', async () => {
    const cookie = await login(server.app, VIEWER);
    server.setNow(new Date(Date.now() + 13 * 3_600_000));
    try {
      expect((await server.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
    } finally {
      server.setNow(null);
    }
  });

  it('logs out and invalidates the session', async () => {
    const cookie = await login(server.app, ADMIN);
    const out = await server.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie }, payload: {} });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
    expect((await server.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('users', () => {
  it('lets an admin create users that can log in', async () => {
    const cookie = await login(server.app, ADMIN);
    const created = await server.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { email: 'Nuovo@Sir.Test', password: 'una-password-lunga', role: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<UserSummary>()).toMatchObject({ email: 'nuovo@sir.test', role: 'viewer' });
    expect(created.body).not.toContain('password');
    await login(server.app, { email: 'nuovo@sir.test', password: 'una-password-lunga' });
    const again = await server.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { email: 'nuovo@sir.test', password: 'una-password-lunga', role: 'admin' },
    });
    expect(again.statusCode).toBe(409);
    const list = await server.app.inject({ url: '/api/admin/users', headers: { cookie } });
    expect(list.json<UserSummary[]>().map((u) => u.email)).toContain('nuovo@sir.test');
  });

  it('rejects a short password', async () => {
    const cookie = await login(server.app, ADMIN);
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { email: 'corta@sir.test', password: 'corta', role: 'viewer' },
    });
    expect(res.statusCode).toBe(400);
  });
});
