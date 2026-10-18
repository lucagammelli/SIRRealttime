import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { ADMIN, login, startServer, SUPERADMIN, VIEWER } from './helpers.js';

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

const NEW_PASSWORD = 'una-password-nuova-lunga';
const change = (cookie: string | null, payload: unknown) =>
  server.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    payload: payload as Record<string, unknown>,
    ...(cookie ? { headers: { cookie } } : {}),
  });
const tryLogin = (user: { email: string; password: string }) =>
  server.app.inject({ method: 'POST', url: '/api/auth/login', payload: user });

describe('«Il mio account»: cambio della propria password', () => {
  it('lets the superadmin change its password with no client entered', async () => {
    const cookie = await login(server.app, SUPERADMIN);
    const other = await login(server.app, SUPERADMIN);
    const me = await server.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ role: 'superadmin', tenant: null });
    const res = await change(cookie, { currentPassword: SUPERADMIN.password, newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(200);
    // The session in use stays, the others are closed.
    expect((await server.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    expect((await server.app.inject({ url: '/api/auth/me', headers: { cookie: other } })).statusCode).toBe(401);
    expect((await tryLogin(SUPERADMIN)).statusCode).toBe(401);
    expect((await tryLogin({ email: SUPERADMIN.email, password: NEW_PASSWORD })).statusCode).toBe(200);
  });

  it('lets a viewer change its own password', async () => {
    const cookie = await login(server.app, VIEWER);
    const res = await change(cookie, { currentPassword: VIEWER.password, newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(200);
    expect((await tryLogin({ email: VIEWER.email, password: NEW_PASSWORD })).statusCode).toBe(200);
  });

  it('refuses a wrong current password, a short new one and a request with no session', async () => {
    const cookie = await login(server.app, ADMIN);
    expect((await change(cookie, { currentPassword: 'sbagliata-davvero', newPassword: NEW_PASSWORD })).statusCode).toBe(
      400,
    );
    expect((await change(cookie, { currentPassword: ADMIN.password, newPassword: 'corta' })).statusCode).toBe(400);
    expect((await change(null, { currentPassword: ADMIN.password, newPassword: NEW_PASSWORD })).statusCode).toBe(401);
    expect((await tryLogin(ADMIN)).statusCode).toBe(200);
  });
});
