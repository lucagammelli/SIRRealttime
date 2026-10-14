import type { MeResponse } from '@sir/shared';
import { LoginRequestSchema } from '@sir/shared';
import { and, eq, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { sessions, users } from '../db/index.js';
import { HttpError, unauthorized } from '../lib/errors.js';
import { verifyPassword } from '../lib/passwords.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: ctx.config.cookieSecure,
    path: '/',
  };

  app.post(
    '/api/auth/login',
    { config: perMinute(ctx.rateLimits.login) },
    async (request, reply): Promise<MeResponse> => {
      const body = validate(LoginRequestSchema, request.body);
      const email = body.email.trim().toLowerCase();
      const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = await verifyPassword(user?.passwordHash, body.password);
      if (!user || !ok) {
        request.log.warn('login fallito');
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenziali non valide');
      }
      const now = ctx.now();
      const expiresAt = new Date(now.getTime() + ctx.config.sessionTtlHours * 3_600_000);
      const token = generateToken();
      await ctx.db.delete(sessions).where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, now)));
      await ctx.db.insert(sessions).values({ tokenHash: hashToken(token), userId: user.id, expiresAt });
      void reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      request.log.info({ userId: user.id }, 'login');
      return { id: user.id, email: user.email, role: user.role };
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
    (request): MeResponse => {
      if (!request.user) throw unauthorized();
      return request.user;
    },
  );
}
