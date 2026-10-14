import type { UserRole } from '@sir/shared';
import { containsNul } from '@sir/shared';
import { and, eq, gt } from 'drizzle-orm';
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  preHandlerHookHandler,
  preParsingHookHandler,
  preValidationHookHandler,
} from 'fastify';
import type { AppContext, SessionUser } from './context.js';
import { SESSION_COOKIE } from './context.js';
import { agents, sessions, users } from './db/index.js';
import { badRequest, forbidden, unauthorized, unsupportedMediaType } from './lib/errors.js';
import { hashesEqual, hashToken } from './lib/tokens.js';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,200}$/;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** User of the session cookie, if the session exists and has not expired. */
export async function sessionUser(
  ctx: AppContext,
  request: FastifyRequest,
): Promise<{ user: SessionUser; expiresAt: Date } | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const [row] = await ctx.db
    .select({ id: users.id, email: users.email, role: users.role, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, ctx.now())))
    .limit(1);
  if (!row) return null;
  const { expiresAt, ...user } = row;
  return { user, expiresAt };
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, admin: 1 };

/** preHandler: session required (401) with at least the given role (403). */
export function requireRole(ctx: AppContext, role: UserRole): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const session = await sessionUser(ctx, request);
    if (!session) throw unauthorized();
    if (ROLE_RANK[session.user.role] < ROLE_RANK[role]) throw forbidden();
    request.user = session.user;
    request.sessionExpiresAt = session.expiresAt;
  };
}

/**
 * Browser routes that change data (`/api/auth/*`, `/api/admin/*`): JSON body only and, when the browser sends it,
 * an Origin equal to CORS_ORIGIN (with the SameSite=Lax cookie, protection against CSRF).
 * preParsing hook: it runs after the rate limit (an onRequest of the route), so rejected requests are counted too.
 */
export function browserWriteGuard(ctx: AppContext): preParsingHookHandler {
  return (request, _reply, _payload, done) => {
    if (!UNSAFE_METHODS.has(request.method)) return done();
    if (!originAllowed(ctx, request)) return done(forbidden());
    if (BODY_METHODS.has(request.method)) {
      const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (type !== 'application/json') return done(unsupportedMediaType());
    }
    done();
  };
}

/** preHandler of the browser WebSocket routes, where CORS does not apply: Origin, if present, must be CORS_ORIGIN. */
export function sameOriginGuard(ctx: AppContext): preHandlerHookHandler {
  return (request, _reply, done) => {
    if (!originAllowed(ctx, request)) return done(forbidden());
    done();
  };
}

/**
 * preValidation of every route: a JSON body with a NUL character anywhere is a 400 (PostgreSQL cannot store NUL;
 * the schemas reject it too, this is defense in depth for any field they might miss).
 */
export const rejectNulBody: preValidationHookHandler = (request, _reply, done) => {
  if (containsNul(request.body)) return done(badRequest());
  done();
};

/** True when the request has no Origin (not a browser) or the Origin is CORS_ORIGIN. */
export function originAllowed(ctx: AppContext, request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  return origin === undefined || origin === ctx.config.corsOrigin;
}

/**
 * preParsing of `/api/ingest` (after the rate limit, before the body is read): bearer token of a non-revoked agent,
 * looked up by its hash and compared again in constant time.
 */
export function authenticateAgent(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!match?.[1]) throw unauthorized();
    const hash = hashToken(match[1]);
    const [agent] = await ctx.db
      .select({ id: agents.id, tokenHash: agents.tokenHash })
      .from(agents)
      .where(and(eq(agents.tokenHash, hash), eq(agents.revoked, false)))
      .limit(1);
    if (!agent || !hashesEqual(agent.tokenHash, hash)) throw unauthorized();
    request.agentId = agent.id;
    await ctx.db.update(agents).set({ lastSeenAt: ctx.now() }).where(eq(agents.id, agent.id));
  };
}
