import { randomBytes } from 'node:crypto';
import type { MailSettings, UserInviteResponse, UserSummary } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { SESSION_COOKIE } from '../src/context.js';
import { mailSettings, userTokens, users } from '../src/db/index.js';
import { activeAdminsBesides } from '../src/users.js';
import { verifyPassword } from '../src/lib/passwords.js';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from '../src/mail/crypto.js';
import type { OutgoingMail, SmtpConnection } from '../src/mail/service.js';
import { smtpFailureMessage } from '../src/mail/service.js';
import { escapeHtml, inviteMail } from '../src/mail/templates.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, startServer, SUPERADMIN, VIEWER } from './helpers.js';

const HOST_A = 'a.posta.test';
const HOST_B = 'b.posta.test';
const KEY = randomBytes(32).toString('base64');
const HOUR = 3_600_000;
const SMTP_PASSWORD = 'segreta-smtp-1234';
const SETTINGS = {
  host: 'smtp.posta.test',
  port: 587,
  security: 'starttls',
  username: 'robot',
  password: SMTP_PASSWORD,
  fromName: 'SIR Realtime',
  fromEmail: 'noreply@posta.test',
};

let server: TestServer;
let tenantA: string;
let tenantB: string;
let sent: OutgoingMail[] = [];
let connections: SmtpConnection[] = [];
let failWith: Error | null = null;
const adminA = { email: 'admin-a@posta.test', password: 'password-admin-a-1' };
const adminB = { email: 'admin-b@posta.test', password: 'password-admin-b-1' };
const viewerA = { email: 'viewer-a@posta.test', password: 'password-viewer-a-1' };

function call(host: string, cookie: string | null, options: InjectOptions) {
  return server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });
}
const post = (host: string, cookie: string | null, url: string, payload: unknown = {}) =>
  call(host, cookie, { method: 'POST', url, payload: payload as Record<string, unknown> });
const body = <T>(res: { json: () => unknown }): T => res.json() as T;

/** Token written in the last mail sent to `to`. */
function tokenIn(to: string, kind: 'invito' | 'reimposta-password'): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  const match = mail && new RegExp(`/admin/${kind}/([A-Za-z0-9_-]+)`).exec(mail.text);
  if (!match?.[1]) throw new Error(`no ${kind} link sent to ${to}`);
  return match[1];
}

async function configureMail(): Promise<void> {
  const cookie = await login(server.app, SUPERADMIN, HOST_A);
  const res = await call(HOST_A, cookie, { method: 'PUT', url: '/api/admin/mail-settings', payload: SETTINGS });
  expect(res.statusCode).toBe(200);
}

async function userId(email: string): Promise<string> {
  const [row] = await server.database.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

beforeAll(async () => {
  server = await startServer(
    {},
    { SETTINGS_ENCRYPTION_KEY: KEY },
    {
      mailTransport: (connection) => {
        connections.push(connection);
        return {
          sendMail: (message) => {
            if (failWith) return Promise.reject(failWith);
            sent.push(message);
            return Promise.resolve({});
          },
        };
      },
    },
  );
  tenantA = await createTenant(server, 'posta-a', [HOST_A]);
  tenantB = await createTenant(server, 'posta-b', [HOST_B]);
  await createUser(server, adminA, 'admin', tenantA);
  await createUser(server, viewerA, 'viewer', tenantA);
  await createUser(server, adminB, 'admin', tenantB);
});
afterAll(() => server.close());
beforeEach(async () => {
  sent = [];
  connections = [];
  failWith = null;
  server.setNow(null);
  await server.database.db.delete(mailSettings);
  await server.database.db.delete(userTokens);
});

describe('encryption of the mail password', () => {
  it('encrypts and decrypts, with a fresh IV each time', () => {
    const key = Buffer.from(KEY, 'base64');
    const a = encryptSecret(key, 'segreto');
    const b = encryptSecret(key, 'segreto');
    expect(a).not.toBe(b);
    expect(a).not.toContain('segreto');
    expect(decryptSecret(key, a)).toBe('segreto');
  });

  it('refuses a wrong key and damaged text', () => {
    const key = Buffer.from(KEY, 'base64');
    const text = encryptSecret(key, 'segreto');
    expect(decryptSecret(randomBytes(32), text)).toBeNull();
    expect(decryptSecret(key, `${text}x`)).toBeNull();
    expect(decryptSecret(key, 'v1.a')).toBeNull();
  });

  it('refuses a shortened authentication tag', () => {
    const key = Buffer.from(KEY, 'base64');
    const [v, iv, tag, data] = encryptSecret(key, 'segreto').split('.');
    const short = Buffer.from(tag ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(decryptSecret(key, [v, iv, short, data].join('.'))).toBeNull();
  });

  it('accepts only a 32-byte key', () => {
    expect(decodeEncryptionKey(KEY)).toHaveLength(32);
    expect(decodeEncryptionKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(decodeEncryptionKey('non una chiave!')).toBeNull();
    expect(() => loadConfig({ DATABASE_URL: 'x', SETTINGS_ENCRYPTION_KEY: 'corta' })).toThrow(ConfigError);
    expect(loadConfig({ DATABASE_URL: 'x' }).settingsEncryptionKey).toBeNull();
  });
});

describe('«Posta» settings', () => {
  it('is for the superadmin only', async () => {
    const admin = await login(server.app, ADMIN);
    const viewer = await login(server.app, VIEWER);
    for (const cookie of [admin, viewer]) {
      expect((await call(HOST_A, cookie, { url: '/api/admin/mail-settings' })).statusCode).toBe(403);
      expect((await post(HOST_A, cookie, '/api/admin/mail-settings/test')).statusCode).toBe(403);
    }
    expect((await call(HOST_A, null, { url: '/api/admin/mail-settings' })).statusCode).toBe(401);
  });

  it('saves the password encrypted and never sends it back', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    const before = body<MailSettings>(await call(HOST_A, cookie, { url: '/api/admin/mail-settings' }));
    expect(before).toMatchObject({ configured: false, passwordSet: false, encryptionAvailable: true });
    const put = await call(HOST_A, cookie, { method: 'PUT', url: '/api/admin/mail-settings', payload: SETTINGS });
    expect(put.statusCode).toBe(200);
    expect(body<MailSettings>(put)).toMatchObject({ host: SETTINGS.host, passwordSet: true, configured: true });
    expect(put.body).not.toContain(SMTP_PASSWORD);
    const get = await call(HOST_A, cookie, { url: '/api/admin/mail-settings' });
    expect(get.body).not.toContain(SMTP_PASSWORD);
    const [row] = await server.database.db.select().from(mailSettings);
    expect(row?.passwordEnc).toBeTruthy();
    expect(row?.passwordEnc).not.toContain(SMTP_PASSWORD);
    expect(decryptSecret(Buffer.from(KEY, 'base64'), row?.passwordEnc ?? '')).toBe(SMTP_PASSWORD);
  });

  it('keeps the password when none is sent, replaces it, clears it', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    const put = (extra: Record<string, unknown>) =>
      call(HOST_A, cookie, {
        method: 'PUT',
        url: '/api/admin/mail-settings',
        payload: { ...SETTINGS, password: undefined, ...extra },
      });
    await call(HOST_A, cookie, { method: 'PUT', url: '/api/admin/mail-settings', payload: SETTINGS });
    expect(body<MailSettings>(await put({ port: 465, security: 'tls' }))).toMatchObject({
      port: 465,
      passwordSet: true,
    });
    await put({ password: 'nuova-password-1' });
    const [row] = await server.database.db.select().from(mailSettings);
    expect(decryptSecret(Buffer.from(KEY, 'base64'), row?.passwordEnc ?? '')).toBe('nuova-password-1');
    expect(body<MailSettings>(await put({ clearPassword: true })).passwordSet).toBe(false);
  });

  it('refuses a password when the encryption key is missing', async () => {
    const other = await startServer();
    try {
      const cookie = await login(other.app, SUPERADMIN);
      const view = await other.app.inject({ url: '/api/admin/mail-settings', headers: { cookie } });
      expect(view.json<MailSettings>().encryptionAvailable).toBe(false);
      const res = await other.app.inject({
        method: 'PUT',
        url: '/api/admin/mail-settings',
        headers: { cookie },
        payload: SETTINGS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.body).toContain('SETTINGS_ENCRYPTION_KEY');
      const noPassword = await other.app.inject({
        method: 'PUT',
        url: '/api/admin/mail-settings',
        headers: { cookie },
        payload: { ...SETTINGS, password: undefined, username: '' },
      });
      expect(noPassword.statusCode).toBe(200);
    } finally {
      await other.close();
    }
  });

  it('validates the body', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    for (const bad of [
      { ...SETTINGS, port: 70000 },
      { ...SETTINGS, security: 'ssl' },
      { ...SETTINGS, fromEmail: 'non-una-mail' },
      { ...SETTINGS, host: '' },
      { ...SETTINGS, extra: 1 },
    ]) {
      expect(
        (await call(HOST_A, cookie, { method: 'PUT', url: '/api/admin/mail-settings', payload: bad })).statusCode,
      ).toBe(400);
    }
  });

  it('sends a test mail to the superadmin and explains a failure without internal details', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    expect(body<{ ok: boolean }>(await post(HOST_A, cookie, '/api/admin/mail-settings/test')).ok).toBe(false);
    await configureMail();
    const ok = await post(HOST_A, cookie, '/api/admin/mail-settings/test');
    expect(body<{ ok: boolean }>(ok).ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(SUPERADMIN.email);
    expect(connections[0]).toMatchObject({ host: SETTINGS.host, password: SMTP_PASSWORD, security: 'starttls' });

    failWith = Object.assign(new Error('535 5.7.8 Authentication failed for robot@10.1.2.3'), { code: 'EAUTH' });
    const bad = await post(HOST_A, cookie, '/api/admin/mail-settings/test');
    const result = body<{ ok: boolean; message: string }>(bad);
    expect(bad.statusCode).toBe(200);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Il server di posta ha rifiutato utente o password.');
    expect(bad.body).not.toContain('10.1.2.3');
    expect(smtpFailureMessage(new Error('boh'))).toContain('Invio non riuscito');
  });
});

describe('mail templates', () => {
  it('escape the names in the HTML', () => {
    const mail = inviteMail(
      { name: 'Club <b>"X"</b> & C', logoUrl: 'https://x.test/l.png' },
      'https://x.test/admin/invito/abc',
    );
    expect(mail.html).not.toContain('<b>');
    expect(mail.html).toContain('Club &#60;b&#62;&#34;X&#34;&#60;/b&#62; &#38; C');
    expect(mail.subject).toBe('Sei stato invitato su Club <b>"X"</b> & C');
    expect(mail.text).toContain('https://x.test/admin/invito/abc');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  });
});

describe('invitations', () => {
  const invite = async (cookie: string, email: string, role = 'viewer') =>
    post(HOST_A, cookie, '/api/admin/users', { email, role });

  it('sends the mail with a one-time link and the new user chooses the first password', async () => {
    await configureMail();
    const cookie = await login(server.app, adminA, HOST_A);
    const res = await invite(cookie, 'Nuovo@Posta.test');
    expect(res.statusCode).toBe(201);
    const created = body<UserInviteResponse>(res);
    expect(created).toMatchObject({
      email: 'nuovo@posta.test',
      invite: 'pending',
      delivery: { mail: 'sent', link: null },
    });
    expect(res.body).not.toMatch(/passwordHash|\/admin\/invito\//);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'nuovo@posta.test', subject: 'Sei stato invitato su POSTA-A' });
    expect(sent[0]?.text).toContain(`http://portale.test/admin/invito/`);
    expect(sent[0]?.html).toContain('POSTA-A');

    // Not stored in clear, and no login while the invitation is pending.
    const token = tokenIn('nuovo@posta.test', 'invito');
    const rows = await server.database.db.select().from(userTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toHaveLength(64);
    const early = await post(HOST_A, null, '/api/auth/login', { email: 'nuovo@posta.test', password: token });
    expect(early.statusCode).toBe(401);

    const info = await call(HOST_A, null, { url: `/api/auth/links/${token}` });
    expect(body(info)).toMatchObject({ kind: 'invite', email: 'nuovo@posta.test', tenantName: 'POSTA-A' });

    const short = await post(HOST_A, null, '/api/auth/invite/accept', { token, password: 'corta' });
    expect(short.statusCode).toBe(400);
    const accept = await post(HOST_A, null, '/api/auth/invite/accept', { token, password: 'prima-password-1' });
    expect(accept.statusCode).toBe(200);
    expect(body(accept)).toMatchObject({ email: 'nuovo@posta.test', role: 'viewer', tenant: { slug: 'posta-a' } });
    const session = accept.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(session).toBeTruthy();
    const me = await call(HOST_A, `${SESSION_COOKIE}=${session?.value ?? ''}`, { url: '/api/auth/me' });
    expect(me.statusCode).toBe(200);

    // One use only; afterwards a normal user.
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token, password: 'altra-password-1' })).statusCode,
    ).toBe(410);
    expect((await call(HOST_A, null, { url: `/api/auth/links/${token}` })).statusCode).toBe(410);
    await login(server.app, { email: 'nuovo@posta.test', password: 'prima-password-1' }, HOST_A);
    const list = body<UserSummary[]>(await call(HOST_A, cookie, { url: '/api/admin/users' }));
    expect(list.find((u) => u.email === 'nuovo@posta.test')?.invite).toBeNull();
  });

  it('is valid 72 hours, then shows «scaduto» and can be sent again', async () => {
    await configureMail();
    const cookie = await login(server.app, adminA, HOST_A);
    const start = new Date('2026-10-17T10:00:00Z');
    server.setNow(start);
    const created = body<UserInviteResponse>(await invite(cookie, 'scade@posta.test'));
    const token = tokenIn('scade@posta.test', 'invito');
    server.setNow(new Date(start.getTime() + 71 * HOUR));
    expect((await call(HOST_A, null, { url: `/api/auth/links/${token}` })).statusCode).toBe(200);
    server.setNow(new Date(start.getTime() + 73 * HOUR));
    expect((await call(HOST_A, null, { url: `/api/auth/links/${token}` })).statusCode).toBe(410);
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token, password: 'prima-password-1' })).statusCode,
    ).toBe(410);
    const cookie2 = await login(server.app, adminA, HOST_A);
    const list = body<UserSummary[]>(await call(HOST_A, cookie2, { url: '/api/admin/users' }));
    expect(list.find((u) => u.id === created.id)?.invite).toBe('expired');
    // Still no password login.
    expect(
      (await post(HOST_A, null, '/api/auth/login', { email: 'scade@posta.test', password: token })).statusCode,
    ).toBe(401);

    const again = await post(HOST_A, cookie2, `/api/admin/users/${created.id}/invite`);
    expect(again.statusCode).toBe(200);
    expect(body<UserInviteResponse>(again)).toMatchObject({ invite: 'pending', delivery: { mail: 'sent' } });
    const fresh = tokenIn('scade@posta.test', 'invito');
    expect(fresh).not.toBe(token);
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token: fresh, password: 'prima-password-1' })).statusCode,
    ).toBe(200);
  });

  it('sending again makes the previous link useless', async () => {
    await configureMail();
    const cookie = await login(server.app, adminA, HOST_A);
    const created = body<UserInviteResponse>(await invite(cookie, 'doppio@posta.test'));
    const first = tokenIn('doppio@posta.test', 'invito');
    await post(HOST_A, cookie, `/api/admin/users/${created.id}/invite`);
    const second = tokenIn('doppio@posta.test', 'invito');
    expect(sent).toHaveLength(2);
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token: first, password: 'prima-password-1' })).statusCode,
    ).toBe(410);
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token: second, password: 'prima-password-1' })).statusCode,
    ).toBe(200);
    // Nothing left to send again.
    expect((await post(HOST_A, cookie, `/api/admin/users/${created.id}/invite`)).statusCode).toBe(409);
  });

  it('gives the link to copy when there is no mail server or the server refuses the mail', async () => {
    const cookie = await login(server.app, adminA, HOST_A);
    const res = body<UserInviteResponse>(await invite(cookie, 'senza@posta.test'));
    expect(res.delivery?.mail).toBe('not_configured');
    expect(res.delivery?.link).toMatch(/^http:\/\/portale\.test\/admin\/invito\/[A-Za-z0-9_-]{43}$/);
    expect(sent).toHaveLength(0);
    const token = res.delivery?.link?.split('/').pop() ?? '';
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token, password: 'prima-password-1' })).statusCode,
    ).toBe(200);

    await configureMail();
    failWith = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    const failed = body<UserInviteResponse>(await invite(cookie, 'rifiuta@posta.test'));
    expect(failed.delivery).toMatchObject({ mail: 'failed' });
    expect(failed.delivery?.link).toContain('/admin/invito/');
    const resend = body<UserInviteResponse>(await post(HOST_A, cookie, `/api/admin/users/${failed.id}/invite`));
    expect(resend.delivery?.mail).toBe('failed');
  });

  it('creates a user with a password as before, with no invitation', async () => {
    await configureMail();
    const cookie = await login(server.app, adminA, HOST_A);
    const res = await post(HOST_A, cookie, '/api/admin/users', {
      email: 'diretto@posta.test',
      password: 'password-diretta-1',
      role: 'viewer',
    });
    expect(res.statusCode).toBe(201);
    expect(body<UserInviteResponse>(res)).toMatchObject({ invite: null, delivery: null });
    expect(sent).toHaveLength(0);
    await login(server.app, { email: 'diretto@posta.test', password: 'password-diretta-1' }, HOST_A);
  });

  it('cancels an invitation by deleting the user, and a password set by an admin ends it', async () => {
    const cookie = await login(server.app, adminA, HOST_A);
    const a = body<UserInviteResponse>(await invite(cookie, 'annulla@posta.test'));
    const token = a.delivery?.link?.split('/').pop() ?? '';
    const del = await call(HOST_A, cookie, { method: 'DELETE', url: `/api/admin/users/${a.id}/invite` });
    expect(del.statusCode).toBe(204);
    expect(
      (await post(HOST_A, null, '/api/auth/invite/accept', { token, password: 'prima-password-1' })).statusCode,
    ).toBe(410);
    expect(
      body<UserSummary[]>(await call(HOST_A, cookie, { url: '/api/admin/users' })).some((u) => u.id === a.id),
    ).toBe(false);

    const b = body<UserInviteResponse>(await invite(cookie, 'imposta@posta.test'));
    const patch = await call(HOST_A, cookie, {
      method: 'PATCH',
      url: `/api/admin/users/${b.id}`,
      payload: { password: 'password-admin-1x' },
    });
    expect(body<UserSummary>(patch).invite).toBeNull();
    await login(server.app, { email: 'imposta@posta.test', password: 'password-admin-1x' }, HOST_A);
    // No invitation left to cancel.
    expect((await call(HOST_A, cookie, { method: 'DELETE', url: `/api/admin/users/${b.id}/invite` })).statusCode).toBe(
      409,
    );
  });

  it('does not count an invited admin as an active admin', async () => {
    const tenant = await createTenant(server, 'ultimo', ['ultimo.posta.test']);
    await createUser(server, { email: 'attivo@posta.test', password: 'password-attivo-12' }, 'admin', tenant);
    const sup = await login(server.app, SUPERADMIN, HOST_A);
    await post(HOST_A, sup, '/api/admin/active-tenant', { tenantId: tenant });
    const res = await post(HOST_A, sup, '/api/admin/users', { email: 'inv@posta.test', role: 'admin' });
    expect(res.statusCode).toBe(201);
    const attivo = await userId('attivo@posta.test');
    const count = await server.database.db.transaction((tx) => activeAdminsBesides(tx, tenant, attivo));
    expect(count).toBe(0);
    const inv = await userId('inv@posta.test');
    expect(await server.database.db.transaction((tx) => activeAdminsBesides(tx, tenant, inv))).toBe(1);
  });

  it('keeps one link per user and kind', async () => {
    const cookie = await login(server.app, adminA, HOST_A);
    const created = body<UserInviteResponse>(await invite(cookie, 'unico@posta.test'));
    await post(HOST_A, cookie, `/api/admin/users/${created.id}/invite`);
    await post(HOST_A, cookie, `/api/admin/users/${created.id}/invite`);
    expect(await server.database.db.select().from(userTokens).where(eq(userTokens.userId, created.id))).toHaveLength(1);
  });

  it('is isolated by client and needs the admin role', async () => {
    const cookieA = await login(server.app, adminA, HOST_A);
    const cookieB = await login(server.app, adminB, HOST_B);
    const viewer = await login(server.app, viewerA, HOST_A);
    const a = body<UserInviteResponse>(await invite(cookieA, 'iso@posta.test'));
    const base = `/api/admin/users/${a.id}`;
    expect((await post(HOST_B, cookieB, `${base}/invite`)).statusCode).toBe(404);
    expect((await call(HOST_B, cookieB, { method: 'DELETE', url: `${base}/invite` })).statusCode).toBe(404);
    expect((await post(HOST_B, cookieB, `${base}/reset-link`)).statusCode).toBe(404);
    expect((await post(HOST_A, viewer, `${base}/invite`)).statusCode).toBe(403);
    expect((await call(HOST_A, viewer, { method: 'DELETE', url: `${base}/invite` })).statusCode).toBe(403);
    expect((await post(HOST_A, viewer, `${base}/reset-link`)).statusCode).toBe(403);
    expect((await post(HOST_A, viewer, '/api/admin/users', { email: 'x@posta.test', role: 'viewer' })).statusCode).toBe(
      403,
    );
    expect(await userId('iso@posta.test')).toBe(a.id);
    // Never a superadmin.
    const superId = await userId(SUPERADMIN.email);
    expect((await post(HOST_A, cookieA, `/api/admin/users/${superId}/invite`)).statusCode).toBe(404);
  });

  it('invites the first user of a new client', async () => {
    await configureMail();
    const cookie = await login(server.app, SUPERADMIN, HOST_A);
    const res = await post(HOST_A, cookie, '/api/admin/tenants', {
      slug: 'nuovo-cliente',
      name: 'Nuovo Cliente',
      hostnames: ['nuovo.posta.test'],
      firstUser: { email: 'capo@posta.test' },
    });
    expect(res.statusCode).toBe(201);
    expect(body(res)).toMatchObject({ userCount: 1, firstUserInvite: { mail: 'sent', link: null } });
    expect(sent[0]?.subject).toBe('Sei stato invitato su Nuovo Cliente');
    const token = tokenIn('capo@posta.test', 'invito');
    const accept = await post('nuovo.posta.test', null, '/api/auth/invite/accept', {
      token,
      password: 'prima-password-1',
    });
    expect(body(accept)).toMatchObject({ role: 'admin', tenant: { slug: 'nuovo-cliente' } });
  });
});

describe('password reset', () => {
  const request = (email: string, host = HOST_A) => post(host, null, '/api/auth/password-reset/request', { email });
  const settle = () => server.app.mail.idle();

  it('answers the same for an existing and an unknown email, and mails only the first', async () => {
    await configureMail();
    const known = await request(adminA.email);
    const unknown = await request('nessuno@posta.test');
    await settle();
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
    expect(known.body).toBe('{"ok":true}');
    expect(sent.map((m) => m.to)).toEqual([adminA.email]);
    expect(sent[0]?.subject).toBe('Nuova password per POSTA-A');
  });

  it('sets the new password once, closes every session and expires after one hour', async () => {
    await configureMail();
    const who = { email: 'reset@posta.test', password: 'password-vecchia-1' };
    await createUser(server, who, 'admin', tenantA);
    server.setNow(new Date('2026-10-17T10:00:00Z'));
    const session = await login(server.app, who, HOST_A);
    expect((await call(HOST_A, session, { url: '/api/auth/me' })).statusCode).toBe(200);
    await request(who.email);
    await settle();
    const token = tokenIn(who.email, 'reimposta-password');
    const rows = await server.database.db.select().from(userTokens);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(body(await call(HOST_A, null, { url: `/api/auth/links/${token}` }))).toMatchObject({ kind: 'reset' });

    expect(
      (await post(HOST_A, null, '/api/auth/password-reset/confirm', { token, password: 'corta' })).statusCode,
    ).toBe(400);
    const done = await post(HOST_A, null, '/api/auth/password-reset/confirm', { token, password: 'password-nuova-1' });
    expect(done.statusCode).toBe(200);
    expect((await call(HOST_A, session, { url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await post(HOST_A, null, '/api/auth/login', who)).statusCode).toBe(401);
    await login(server.app, { email: who.email, password: 'password-nuova-1' }, HOST_A);
    expect(
      (await post(HOST_A, null, '/api/auth/password-reset/confirm', { token, password: 'password-altra-1' }))
        .statusCode,
    ).toBe(410);
    const [row] = await server.database.db.select().from(users).where(eq(users.email, who.email));
    expect(await verifyPassword(row?.passwordHash, 'password-nuova-1')).toBe(true);
  });

  it('expires after one hour and a newer link replaces the older one', async () => {
    await configureMail();
    const start = new Date('2026-10-17T10:00:00Z');
    server.setNow(start);
    await request(viewerA.email);
    await settle();
    const first = tokenIn(viewerA.email, 'reimposta-password');
    await request(viewerA.email);
    await settle();
    const second = tokenIn(viewerA.email, 'reimposta-password');
    expect(second).not.toBe(first);
    expect(
      (await post(HOST_A, null, '/api/auth/password-reset/confirm', { token: first, password: 'password-nuova-1' }))
        .statusCode,
    ).toBe(410);
    server.setNow(new Date(start.getTime() + 61 * 60_000));
    expect(
      (await post(HOST_A, null, '/api/auth/password-reset/confirm', { token: second, password: 'password-nuova-1' }))
        .statusCode,
    ).toBe(410);
    // An invitation link is not a reset link.
    const cookie = await login(server.app, adminA, HOST_A);
    const inv = body<UserInviteResponse>(
      await post(HOST_A, cookie, '/api/admin/users', { email: 'tipo@posta.test', role: 'viewer' }),
    );
    const invToken = tokenIn('tipo@posta.test', 'invito');
    expect(inv.delivery?.mail).toBe('sent');
    expect(
      (await post(HOST_A, null, '/api/auth/password-reset/confirm', { token: invToken, password: 'password-nuova-1' }))
        .statusCode,
    ).toBe(410);
  });

  it('sends nothing to a disabled user nor without a mail server, with the same answer', async () => {
    const withoutMail = await request(adminA.email);
    await settle();
    expect(withoutMail.body).toBe('{"ok":true}');
    expect(sent).toHaveLength(0);
    expect(await server.database.db.select().from(userTokens)).toHaveLength(0);

    await configureMail();
    await server.database.db.update(users).set({ disabled: true }).where(eq(users.email, viewerA.email));
    const res = await request(viewerA.email);
    await settle();
    await server.database.db.update(users).set({ disabled: false }).where(eq(users.email, viewerA.email));
    expect(res.body).toBe('{"ok":true}');
    expect(sent).toHaveLength(0);
  });

  it('limits the requests per email and per IP, always with the usual answer per email', async () => {
    await configureMail();
    const email = 'limite@posta.test';
    await createUser(server, { email, password: 'password-limite-1' }, 'viewer', tenantA);
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(email);
      answers.push(`${res.statusCode}:${res.body}`);
      await settle();
    }
    expect(new Set(answers).size).toBe(1);
    expect(sent.filter((m) => m.to === email)).toHaveLength(3);

    const limited = await startServer({ passwordReset: 2 }, { SETTINGS_ENCRYPTION_KEY: KEY });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: '/api/auth/password-reset/request',
              payload: { email: `u${i}@x.test` },
            })
          ).statusCode,
        );
      }
      expect(codes).toEqual([200, 200, 429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('lets the admin of the client create a link to copy, only for its own users', async () => {
    const cookieA = await login(server.app, adminA, HOST_A);
    const cookieB = await login(server.app, adminB, HOST_B);
    const viewerId = await userId(viewerA.email);
    expect((await post(HOST_B, cookieB, `/api/admin/users/${viewerId}/reset-link`)).statusCode).toBe(404);
    const res = await post(HOST_A, cookieA, `/api/admin/users/${viewerId}/reset-link`);
    expect(res.statusCode).toBe(200);
    const { link } = body<{ link: string }>(res);
    expect(link).toMatch(/^http:\/\/portale\.test\/admin\/reimposta-password\/[A-Za-z0-9_-]{43}$/);
    const token = link.split('/').pop() ?? '';
    const done = await post(HOST_A, null, '/api/auth/password-reset/confirm', { token, password: 'password-viewer-2' });
    expect(done.statusCode).toBe(200);
    await login(server.app, { email: viewerA.email, password: 'password-viewer-2' }, HOST_A);
    await server.database.db.update(users).set({ disabled: true }).where(eq(users.id, viewerId));
    expect((await post(HOST_A, cookieA, `/api/admin/users/${viewerId}/reset-link`)).statusCode).toBe(409);
    await server.database.db.update(users).set({ disabled: false }).where(eq(users.id, viewerId));
  });

  it('builds links from PUBLIC_BASE_URL, never from the Host header', async () => {
    await configureMail();
    const res = await call('evil.example', null, {
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { email: adminA.email },
      headers: { 'x-forwarded-host': 'evil.example' },
    });
    expect(res.statusCode).toBe(200);
    await server.app.mail.idle();
    expect(sent[0]?.text).toContain('http://portale.test/admin/reimposta-password/');
    expect(sent[0]?.text).not.toContain('evil.example');
  });
});
