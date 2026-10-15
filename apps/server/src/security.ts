import type { UserRole } from '@sir/shared';
import { containsNul } from '@sir/shared';
import { and, eq, gt } from 'drizzle-orm';
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  preParsingAsyncHookHandler,
  preValidationHookHandler,
} from 'fastify';
import type { AppContext, SessionUser } from './context.js';
import { SESSION_COOKIE } from './context.js';
import { agents, sessions, users } from './db/index.js';
import { badRequest, forbidden, unauthorized, unsupportedMediaType } from './lib/errors.js';
import { hashesEqual, hashToken } from './lib/tokens.js';
import { hostTenant } from './tenancy.js';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,200}$/;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface Session {
  user: SessionUser;
  expiresAt: Date;
  /** Client the admin routes work on (see `FastifyRequest.adminTenantId`). */
  tenantId: string | null;
}

/**
 * Session of the cookie, if it exists and has not expired. The session of a user of a client is valid only on the
 * hostnames of that client (its cookie is not accepted on another client's portal); a superadmin works on the active
 * client of the session, otherwise on the client of the hostname.
 */
export async function sessionUser(ctx: AppContext, request: FastifyRequest): Promise<Session | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const [row] = await ctx.db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      tenantId: users.tenantId,
      activeTenantId: sessions.activeTenantId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, ctx.now())))
    .limit(1);
  if (!row) return null;
  const { expiresAt, activeTenantId, ...user } = row;
  const host = await hostTenant(ctx, request);
  if (user.role !== 'superadmin') {
    if (!user.tenantId || host?.id !== user.tenantId) return null;
    return { user, expiresAt, tenantId: user.tenantId };
  }
  return { user, expiresAt, tenantId: activeTenantId ?? host?.id ?? null };
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, admin: 1, superadmin: 2 };

/** preHandler: session required (401) with at least the given role (403). */
export function requireRole(ctx: AppContext, role: UserRole): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const session = await sessionUser(ctx, request);
    if (!session) throw unauthorized();
    if (ROLE_RANK[session.user.role] < ROLE_RANK[role]) throw forbidden();
    request.user = session.user;
    request.sessionExpiresAt = session.expiresAt;
    request.adminTenantId = session.tenantId;
  };
}

/**
 * Browser routes that change data (`/api/auth/*`, `/api/admin/*`): JSON body only and, when the browser sends it,
 * an allowed Origin (see `originAllowed`; with the SameSite=Lax cookie, protection against CSRF).
 * preParsing hook: it runs after the rate limit (an onRequest of the route), so rejected requests are counted too.
 */
export function browserWriteGuard(ctx: AppContext): preParsingAsyncHookHandler {
  return async (request, _reply, payload) => {
    if (!UNSAFE_METHODS.has(request.method)) return payload;
    if (!(await originAllowed(ctx, request))) throw forbidden();
    if (BODY_METHODS.has(request.method)) {
      const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (type !== 'application/json') throw unsupportedMediaType();
    }
    return payload;
  };
}

/** preHandler of the browser WebSocket routes, where CORS does not apply: Origin, if present, must be allowed. */
export function sameOriginGuard(ctx: AppContext): preHandlerAsyncHookHandler {
  return async (request) => {
    if (!(await originAllowed(ctx, request))) throw forbidden();
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

/**
 * True when the request has no Origin (not a browser), the Origin is CORS_ORIGIN (development, single portal) or
 * the Origin hostname is one of the hostnames of the client of the request hostname (each client's portal).
 */
export async function originAllowed(ctx: AppContext, request: FastifyRequest): Promise<boolean> {
  const origin = request.headers.origin;
  if (origin === undefined || origin === ctx.config.corsOrigin) return true;
  let hostname: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    hostname = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  const tenant = await hostTenant(ctx, request);
  return tenant !== null && tenant.hostnames.includes(hostname);
}

/** sha256 of the `Authorization: Bearer <token>` of the request (agent token, registration secret); 401 if missing. */
export function bearerHash(request: FastifyRequest): string {
  const header = request.headers.authorization ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  if (!match?.[1]) throw unauthorized();
  return hashToken(match[1]);
}

/**
 * preParsing of `/api/ingest` (after the rate limit, before the body is read): bearer token of a non-revoked agent,
 * looked up by its hash and compared again in constant time.
 */
export function authenticateAgent(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    const hash = bearerHash(request);
    // The token identifies the agent and so its client: the hostname does not matter for the ingest.
    const [agent] = await ctx.db
      .select({ id: agents.id, tenantId: agents.tenantId, tokenHash: agents.tokenHash })
      .from(agents)
      .where(and(eq(agents.tokenHash, hash), eq(agents.revoked, false)))
      .limit(1);
    if (!agent || !hashesEqual(agent.tokenHash, hash)) throw unauthorized();
    request.agent = { id: agent.id, tenantId: agent.tenantId };
    await ctx.db.update(agents).set({ lastSeenAt: ctx.now() }).where(eq(agents.id, agent.id));
  };
}
