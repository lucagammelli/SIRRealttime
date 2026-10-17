import type { LinkInfo, MeResponse } from '@sir/shared';
import { LinkTokenSchema, LoginRequestSchema, PasswordResetRequestSchema, SetPasswordRequestSchema } from '@sir/shared';
import { and, eq, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { sessions, userTokens, users } from '../db/index.js';
import { gone, HttpError, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { resetMail } from '../mail/templates.js';
import { requireRole } from '../security.js';
import { tenantRef } from '../tenancy.js';
import { consumeLink, findLink, hasOpenInvite, issueLink, linkUrl, mailBrand } from '../userLinks.js';
import { closeSessionSockets, deleteUserSessions } from '../users.js';

/** Token of an invitation or reset link in the path. */
const LinkParamsSchema = z.object({ token: LinkTokenSchema });

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: ctx.config.cookieSecure,
    path: '/',
  };

  /** New session cookie for a user who has just proved who it is; the answer of the login. */
  const openSession = async (
    user: { id: string; email: string; role: MeResponse['role']; tenantId: string | null },
    reply: FastifyReply,
  ): Promise<MeResponse> => {
    const now = ctx.now();
    const expiresAt = new Date(now.getTime() + ctx.config.sessionTtlHours * 3_600_000);
    const token = generateToken();
    await ctx.db.delete(sessions).where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, now)));
    await ctx.db.insert(sessions).values({ tokenHash: hashToken(token), userId: user.id, expiresAt });
    void reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
    // A new session of a superadmin has entered no client.
    const tenantId = user.role === 'superadmin' ? null : user.tenantId;
    return { id: user.id, email: user.email, role: user.role, tenant: await tenantRef(ctx, tenantId) };
  };

  app.post(
    '/api/auth/login',
    { config: perMinute(ctx.rateLimits.login) },
    async (request, reply): Promise<MeResponse> => {
      const body = validate(LoginRequestSchema, request.body);
      const email = body.email.trim().toLowerCase();
      const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = await verifyPassword(user?.passwordHash, body.password);
      // Any hostname of the portal: a user of a client works on its own client, never on the one of the hostname.
      const hasClient = user?.role === 'superadmin' || (user !== undefined && user.tenantId !== null);
      // A disabled user gets the same answer of a wrong password (nothing tells whether the account exists).
      if (!user || !ok || !hasClient || user.disabled) {
        if (user?.disabled && ok) request.log.warn({ userId: user.id }, 'login di un utente disattivato');
        else request.log.warn('login fallito');
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenziali non valide');
      }
      if (await hasOpenInvite(ctx, user.id)) {
        request.log.warn({ userId: user.id }, 'login di un utente con invito in attesa');
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenziali non valide');
      }
      request.log.info({ userId: user.id }, 'login');
      return openSession(user, reply);
    },
  );

  app.post('/api/auth/logout', { config: perMinute(ctx.rateLimits.admin) }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const sessionHash = hashToken(token);
      await ctx.db.delete(sessions).where(eq(sessions.tokenHash, sessionHash));
      ctx.hub.closeSession(sessionHash);
    }
    void reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  });

  app.get(
    '/api/auth/me',
    { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'viewer') },
    async (request): Promise<MeResponse> => {
      const user = request.user;
      if (!user) throw unauthorized();
      return { id: user.id, email: user.email, role: user.role, tenant: await tenantRef(ctx, request.adminTenantId) };
    },
  );

  const links = { config: perMinute(ctx.rateLimits.passwordReset) };

  /** What the page of an invitation or reset link shows (410 when the link is wrong, used or expired). */
  app.get('/api/auth/links/:token', links, async (request): Promise<LinkInfo> => {
    const { token } = validate(LinkParamsSchema, request.params);
    const link = await findLink(ctx, token, null, ctx.now());
    if (!link) throw gone();
    const tenant = await tenantRef(ctx, link.tenantId);
    return {
      kind: link.kind === 'invite' ? 'invite' : 'reset',
      email: link.email,
      tenantName: tenant?.name ?? null,
      expiresAt: link.expiresAt.toISOString(),
    };
  });

  /** First password of an invited user: the link is used up and the user enters, already logged in. */
  app.post('/api/auth/invite/accept', links, async (request, reply): Promise<MeResponse> => {
    const body = validate(SetPasswordRequestSchema, request.body);
    const passwordHash = await hashPassword(body.password);
    const userId = await ctx.db.transaction(async (tx) => {
      const id = await consumeLink(tx, body.token, 'invite', ctx.now());
      if (!id) return null;
      await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
      // Any other link of the user (a reset asked meanwhile) is no more needed.
      await tx.delete(userTokens).where(eq(userTokens.userId, id));
      return id;
    });
    if (!userId) throw gone();
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw gone();
    request.log.info({ userId }, 'invito accettato');
    return openSession(user, reply);
  });

  /**
   * Reset of a forgotten password: the answer is always the same (and immediate) whether the email exists, is
   * disabled, is over the limit or there is no mail server; the work happens after it. 3 requests per hour per email
   * (more are ignored), plus the limit per IP of the route.
   */
  app.post('/api/auth/password-reset/request', links, (request): { ok: true } => {
    const { email } = validate(PasswordResetRequestSchema, request.body);
    if (ctx.resetRequests.blockedFor(email) === 0) {
      ctx.resetRequests.fail(email);
      ctx.mail.background(async () => {
        const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user || user.disabled || (user.role !== 'superadmin' && user.tenantId === null)) return;
        if (!(await ctx.mail.isConfigured())) {
          request.log.info({ userId: user.id }, 'recupero password: posta non configurata');
          return;
        }
        const issued = await ctx.db.transaction((tx) => issueLink(tx, user.id, 'reset', ctx.now()));
        const brand = await mailBrand(ctx, user.tenantId);
        const result = await ctx.mail.send(
          user.email,
          resetMail(brand, linkUrl(ctx.config.publicBaseUrl, 'reset', issued.token)),
        );
        request.log.info({ userId: user.id, mail: result }, 'recupero password');
      });
    }
    return { ok: true };
  });

  /** New password from a reset link: the link is used up and every session of the user is closed. */
  app.post('/api/auth/password-reset/confirm', links, async (request): Promise<{ ok: true }> => {
    const body = validate(SetPasswordRequestSchema, request.body);
    const passwordHash = await hashPassword(body.password);
    const result = await ctx.db.transaction(async (tx) => {
      const id = await consumeLink(tx, body.token, 'reset', ctx.now());
      if (!id) return null;
      await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
      await tx.delete(userTokens).where(eq(userTokens.userId, id));
      return { id, closed: await deleteUserSessions(tx, id) };
    });
    if (!result) throw gone();
    closeSessionSockets(ctx, result.closed);
    request.log.info({ userId: result.id, sessionsClosed: result.closed.length }, 'password reimpostata');
    return { ok: true };
  });
}
