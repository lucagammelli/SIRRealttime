import type { TenantSummary, UserSummary } from '@arenalive/shared';
import { AGENT_QUOTA_MAX, TenantSummarySchema } from '@arenalive/shared';
import { eq, sql } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SESSION_COOKIE } from '../src/context.js';
import { sessions, tenants, users } from '../src/db/index.js';
import { verifyPassword } from '../src/lib/passwords.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import { LAST_ADMIN_MESSAGE, SELF_CHANGE_MESSAGE } from '../src/users.js';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';

const HOST_A = 'a.utenti.test';
const HOST_B = 'b.utenti.test';
const pw = (name: string) => `password-${name}-1234`;
const who = (name: string) => ({ email: `${name}@utenti.test`, password: pw(name) });

let server: TestServer;
let tenantA: string;
let tenantB: string;

function call(host: string, cookie: string | null, options: InjectOptions) {
  return server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });
}

const patch = (host: string, cookie: string, id: string, payload: Record<string, unknown>) =>
  call(host, cookie, { method: 'PATCH', url: `/api/admin/users/${id}`, payload });
const remove = (host: string, cookie: string, id: string) =>
  call(host, cookie, { method: 'DELETE', url: `/api/admin/users/${id}` });
const me = async (host: string, cookie: string) => (await call(host, cookie, { url: '/api/auth/me' })).statusCode;
const tryLogin = (host: string, user: { email: string; password: string }) =>
  call(host, null, { method: 'POST', url: '/api/auth/login', payload: user });

async function idOf(email: string): Promise<string> {
  const [row] = await server.database.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`user ${email} missing`);
  return row.id;
}

/** New user of a client with its id. */
async function newUser(name: string, role: 'admin' | 'viewer', tenantId: string) {
  const user = who(name);
  await createUser(server, user, role, tenantId);
  return { ...user, id: await idOf(user.email) };
}

async function superOn(tenantId: string): Promise<string> {
  const cookie = await login(server.app, SUPERADMIN, HOST_A);
  const res = await call(HOST_A, cookie, { method: 'POST', url: '/api/admin/active-tenant', payload: { tenantId } });
  expect(res.statusCode).toBe(200);
  return cookie;
}

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'utenti-a', [HOST_A]);
  tenantB = await createTenant(server, 'utenti-b', [HOST_B]);
});
afterAll(() => server.close());

describe('users of a client', () => {
  it('lists the users without passwords and with their state', async () => {
    const admin = await newUser('lista-admin', 'admin', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    const res = await call(HOST_A, cookie, { url: '/api/admin/users' });
    const list = res.json<UserSummary[]>();
    expect(list.find((u) => u.id === admin.id)).toEqual({
      id: admin.id,
      email: admin.email,
      role: 'admin',
      createdAt: expect.any(String) as string,
      disabled: false,
      invite: null,
    });
    expect(res.body).not.toContain('password');
    expect(res.body).not.toContain('$argon2');
  });

  it('changes the role and closes the sessions of the user', async () => {
    const admin = await newUser('ruolo-admin', 'admin', tenantA);
    const other = await newUser('ruolo-altro', 'viewer', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    const otherCookie = await login(server.app, other, HOST_A);
    const res = await patch(HOST_A, cookie, other.id, { role: 'admin' });
    expect(res.statusCode).toBe(200);
    expect(res.json<UserSummary>()).toMatchObject({ role: 'admin', disabled: false });
    expect(await me(HOST_A, otherCookie)).toBe(401);
    // With a new login the user has the new role.
    const again = await login(server.app, other, HOST_A);
    expect((await call(HOST_A, again, { url: '/api/admin/users' })).statusCode).toBe(200);
    // The same role again changes nothing and closes nothing.
    expect((await patch(HOST_A, cookie, other.id, { role: 'admin' })).statusCode).toBe(200);
    expect(await me(HOST_A, again)).toBe(200);
  });

  it('sets a new password: the old one stops working and the sessions are closed', async () => {
    const admin = await newUser('pw-admin', 'admin', tenantA);
    const other = await newUser('pw-altro', 'viewer', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    const otherCookie = await login(server.app, other, HOST_A);
    expect((await patch(HOST_A, cookie, other.id, { password: 'corta' })).statusCode).toBe(400);
    const res = await patch(HOST_A, cookie, other.id, { password: 'nuova-password-123' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('nuova-password-123');
    expect(await me(HOST_A, otherCookie)).toBe(401);
    expect((await tryLogin(HOST_A, other)).statusCode).toBe(401);
    expect((await tryLogin(HOST_A, { email: other.email, password: 'nuova-password-123' })).statusCode).toBe(200);
    const [row] = await server.database.db.select().from(users).where(eq(users.id, other.id));
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(row?.passwordHash, 'nuova-password-123')).toBe(true);
  });

  it('lets a user change its own password keeping only the session in use', async () => {
    const admin = await newUser('pw-io', 'admin', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    const elsewhere = await login(server.app, admin, HOST_A);
    expect((await patch(HOST_A, cookie, admin.id, { password: 'la-mia-nuova-password' })).statusCode).toBe(200);
    expect(await me(HOST_A, cookie)).toBe(200);
    expect(await me(HOST_A, elsewhere)).toBe(401);
  });

  it('disables a user: no more sessions, no login, no admin WebSocket; then enables it again', async () => {
    const admin = await newUser('dis-admin', 'admin', tenantA);
    const other = await newUser('dis-altro', 'admin', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    const otherCookie = await login(server.app, other, HOST_A);
    const ws = await server.app.injectWS('/ws/admin', { headers: { host: HOST_A, cookie: otherCookie } });
    const closed = new Promise<number>((resolve) => ws.on('close', (code: number) => resolve(code)));
    const res = await patch(HOST_A, cookie, other.id, { disabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json<UserSummary>().disabled).toBe(true);
    expect(await closed).toBeGreaterThan(0);
    expect(await me(HOST_A, otherCookie)).toBe(401);
    // The right password of a disabled user gets the same answer of a wrong one.
    const refused = await tryLogin(HOST_A, other);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual((await tryLogin(HOST_A, { ...other, password: 'sbagliata-123456' })).json());
    expect(await server.database.db.select().from(sessions).where(eq(sessions.userId, other.id))).toEqual([]);
    // A session that survived somehow is refused too.
    const token = generateToken();
    await server.database.db
      .insert(sessions)
      .values({ tokenHash: hashToken(token), userId: other.id, expiresAt: new Date(Date.now() + 3_600_000) });
    expect(await me(HOST_A, `${SESSION_COOKIE}=${token}`)).toBe(401);
    expect((await patch(HOST_A, cookie, other.id, { disabled: false })).json<UserSummary>().disabled).toBe(false);
    expect((await tryLogin(HOST_A, other)).statusCode).toBe(200);
  });

  it('deletes a user and its sessions', async () => {
    const admin = await newUser('del-admin', 'admin', tenantA);
    const other = await newUser('del-altro', 'viewer', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    const otherCookie = await login(server.app, other, HOST_A);
    expect((await remove(HOST_A, cookie, other.id)).statusCode).toBe(204);
    expect(await me(HOST_A, otherCookie)).toBe(401);
    expect((await tryLogin(HOST_A, other)).statusCode).toBe(401);
    expect((await remove(HOST_A, cookie, other.id)).statusCode).toBe(404);
  });

  it('never lets a user take away its own role, disable or delete itself', async () => {
    const admin = await newUser('io-admin', 'admin', tenantA);
    await newUser('io-secondo', 'admin', tenantA);
    const cookie = await login(server.app, admin, HOST_A);
    for (const res of [
      await patch(HOST_A, cookie, admin.id, { role: 'viewer' }),
      await patch(HOST_A, cookie, admin.id, { disabled: true }),
      await remove(HOST_A, cookie, admin.id),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: SELF_CHANGE_MESSAGE });
    }
    expect(await me(HOST_A, cookie)).toBe(200);
  });
});

describe('isolation and roles', () => {
  it('answers 404 for a user of another client or the superadmin', async () => {
    const adminB = await newUser('iso-admin-b', 'admin', tenantB);
    const userA = await newUser('iso-utente-a', 'viewer', tenantA);
    const cookieB = await login(server.app, adminB, HOST_B);
    expect((await patch(HOST_B, cookieB, userA.id, { role: 'admin' })).statusCode).toBe(404);
    expect((await patch(HOST_B, cookieB, userA.id, { disabled: true })).statusCode).toBe(404);
    expect((await remove(HOST_B, cookieB, userA.id)).statusCode).toBe(404);
    const superId = await idOf(SUPERADMIN.email);
    expect((await patch(HOST_B, cookieB, superId, { password: 'nuova-password-123' })).statusCode).toBe(404);
    expect((await remove(HOST_B, cookieB, superId)).statusCode).toBe(404);
    const [row] = await server.database.db.select().from(users).where(eq(users.id, userA.id));
    expect(row).toMatchObject({ role: 'viewer', disabled: false });
    const listB = (await call(HOST_B, cookieB, { url: '/api/admin/users' })).json<UserSummary[]>();
    expect(listB.every((u) => u.id !== userA.id)).toBe(true);
  });

  it('refuses the changes to a viewer (403)', async () => {
    const viewer = await newUser('ruoli-viewer', 'viewer', tenantA);
    const target = await newUser('ruoli-target', 'viewer', tenantA);
    const cookie = await login(server.app, viewer, HOST_A);
    expect((await call(HOST_A, cookie, { url: '/api/admin/users' })).statusCode).toBe(403);
    expect((await patch(HOST_A, cookie, target.id, { role: 'admin' })).statusCode).toBe(403);
    expect((await remove(HOST_A, cookie, target.id)).statusCode).toBe(403);
  });
});

describe('at least one active admin per client', () => {
  it('keeps the last active admin even when two admins demote each other at the same time', async () => {
    const tenant = await createTenant(server, 'gara-admin', ['gara.utenti.test']);
    const host = 'gara.utenti.test';
    const one = await newUser('gara-uno', 'admin', tenant);
    const two = await newUser('gara-due', 'admin', tenant);
    const cookieOne = await login(server.app, one, host);
    const cookieTwo = await login(server.app, two, host);
    const answers = await Promise.all([
      patch(host, cookieOne, two.id, { role: 'viewer' }),
      patch(host, cookieTwo, one.id, { disabled: true }),
    ]);
    expect(answers.filter((r) => r.statusCode === 200)).toHaveLength(1);
    // The other one is refused: by the rule of the last admin, or because its session was just closed.
    for (const r of answers.filter((a) => a.statusCode !== 200)) {
      expect([401, 409]).toContain(r.statusCode);
      if (r.statusCode === 409) expect(r.json()).toMatchObject({ error: LAST_ADMIN_MESSAGE });
    }
    const rows = await server.database.db.select().from(users).where(eq(users.tenantId, tenant));
    expect(rows.filter((u) => u.role === 'admin' && !u.disabled)).toHaveLength(1);
  });

  it('lets the superadmin leave a client without an active admin', async () => {
    const tenant = await createTenant(server, 'senza-admin', ['senza.utenti.test']);
    const only = await newUser('senza-unico', 'admin', tenant);
    const cookie = await superOn(tenant);
    expect((await patch(HOST_A, cookie, only.id, { role: 'viewer' })).statusCode).toBe(200);
    expect((await patch(HOST_A, cookie, only.id, { role: 'admin', disabled: true })).statusCode).toBe(200);
    expect((await remove(HOST_A, cookie, only.id)).statusCode).toBe(204);
    const list = (await call(HOST_A, cookie, { url: '/api/admin/users' })).json<UserSummary[]>();
    expect(list).toEqual([]);
  });
});

describe('clients created with their first user', () => {
  it('creates the client and its first admin together, and counts the users', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    const res = await call(HOST_A, cookie, {
      method: 'POST',
      url: '/api/admin/tenants',
      payload: {
        slug: 'nuovo-club',
        name: 'Nuovo club',
        hostnames: ['nuovo.utenti.test'],
        firstUser: { email: 'Capo@Nuovo.Test', password: 'password-del-capo' },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<TenantSummary>();
    expect(created.userCount).toBe(1);
    expect(res.body).not.toContain('password-del-capo');
    const capo = await login(
      server.app,
      { email: 'capo@nuovo.test', password: 'password-del-capo' },
      'nuovo.utenti.test',
    );
    const list = (await call('nuovo.utenti.test', capo, { url: '/api/admin/users' })).json<UserSummary[]>();
    expect(list).toEqual([expect.objectContaining({ email: 'capo@nuovo.test', role: 'admin', disabled: false })]);
    const all = (await call(HOST_A, cookie, { url: '/api/admin/tenants' })).json<TenantSummary[]>();
    expect(all.find((t) => t.id === created.id)?.userCount).toBe(1);
    expect(all.find((t) => t.id === tenantB)?.userCount).toBeGreaterThan(0);
  });

  it('creates no client when the email of the first user is taken', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    const taken = await newUser('gia-presa', 'viewer', tenantA);
    const res = await call(HOST_A, cookie, {
      method: 'POST',
      url: '/api/admin/tenants',
      payload: {
        slug: 'club-doppio',
        name: 'Club doppio',
        hostnames: [],
        firstUser: { email: taken.email, password: 'password-qualsiasi' },
      },
    });
    expect(res.statusCode).toBe(409);
    const all = (await call(HOST_A, cookie, { url: '/api/admin/tenants' })).json<TenantSummary[]>();
    expect(all.some((t) => t.slug === 'club-doppio')).toBe(false);
  });

  it('keeps the list of clients readable with a quota out of the limits', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    // As in a database before the migration 0008 (the check refuses the value now).
    await server.database.db.execute(sql`alter table tenants drop constraint tenants_agent_quota_check`);
    await server.database.db.update(tenants).set({ agentQuota: 378 }).where(eq(tenants.id, tenantB));
    const res = await call(HOST_A, cookie, { url: '/api/admin/tenants' });
    const list = z.array(TenantSummarySchema).parse(res.json());
    expect(list.find((t) => t.id === tenantB)?.agentQuota).toBe(AGENT_QUOTA_MAX);
  });
});
