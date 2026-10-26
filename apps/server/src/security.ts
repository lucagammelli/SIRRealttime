import type { UserRole } from '@arenalive/shared';
import { AGENT_EXPIRED_ERROR, containsNul } from '@arenalive/shared';
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
import { agents, displays, sessions, users } from './db/index.js';
import { badRequest, forbidden, HttpError, tooManyRequests, unauthorized, unsupportedMediaType } from './lib/errors.js';
import { hashesEqual, hashToken } from './lib/tokens.js';
import { hostTenant } from './tenancy.js';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,200}$/;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface Session {
  user: SessionUser;
  expiresAt: Date;
  /** Client the admin routes work on (see `FastifyRequest.adminTenantId`); null: a superadmin with no client. */
  tenantId: string | null;
}

/**
 * Session of the cookie, if it exists, has not expired and its user is not disabled. The hostname does not matter: a
 * user of a client always works on its own client (`users.tenant_id`), a superadmin on the client it has entered
 * (`sessions.active_tenant_id`), otherwise on none.
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
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, ctx.now()), eq(users.disabled, false)))
    .limit(1);
  if (!row) return null;
  const { expiresAt, activeTenantId, ...user } = row;
  if (user.role !== 'superadmin') return user.tenantId ? { user, expiresAt, tenantId: user.tenantId } : null;
  return { user, expiresAt, tenantId: activeTenantId };
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, admin: 1, superadmin: 2 };

/** preHandler: session required (401) with at least the given role (403). */
export function requireRole(ctx: AppContext, role: UserRole): preHandlerAsyncHookHandler {
  const check = checkRole(ctx, role);
  return async (request: FastifyRequest, _reply: FastifyReply) => check(request);
}

/**
 * The check of `requireRole` as a plain function, for a hook that must run before the body is read (the upload of a
 * video: no anonymous request is read for 15 MB).
 */
export function checkRole(ctx: AppContext, role: UserRole): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest) => {
    const session = await sessionUser(ctx, request);
    if (!session) throw unauthorized();
    if (ROLE_RANK[session.user.role] < ROLE_RANK[role]) throw forbidden();
    request.user = session.user;
    request.sessionExpiresAt = session.expiresAt;
    request.adminTenantId = session.tenantId;
  };
}

/**
 * Route config of the one browser route whose body is a file (`application/octet-stream`, the upload of a video):
 * `{ config: { ...BINARY_BODY } }`; that route checks the type itself with `requireBinaryBody`, after the role. Every
 * other route keeps JSON only.
 */
export const BINARY_BODY = { binaryBody: true } as const;

/**
 * Browser routes that change data (`/api/auth/*`, `/api/admin/*`): JSON body only (a route with BINARY_BODY:
 * `application/octet-stream` only; not a «simple» type, so a cross-site form cannot send it) and, when the browser
 * sends it, an allowed Origin (see `originAllowed`; with the SameSite=Lax cookie, protection against CSRF).
 * preParsing hook: it runs after the rate limit (an onRequest of the route), so rejected requests are counted too.
 */
export function browserWriteGuard(ctx: AppContext): preParsingAsyncHookHandler {
  return async (request, _reply, payload) => {
    if (!UNSAFE_METHODS.has(request.method)) return payload;
    if (!(await originAllowed(ctx, request))) throw forbidden();
    if (BODY_METHODS.has(request.method)) {
      const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      // A route with BINARY_BODY checks session, role and type itself, in this order (403 before 415).
      const binary = (request.routeOptions.config as { binaryBody?: boolean }).binaryBody === true;
      if (!binary && type !== 'application/json') throw unsupportedMediaType();
    }
    return payload;
  };
}

/** The body of a route with BINARY_BODY must be `application/octet-stream` (415 otherwise). */
export function requireBinaryBody(request: FastifyRequest): void {
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/octet-stream') throw unsupportedMediaType();
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

const agentExpired = (): HttpError => new HttpError(401, 'AGENT_EXPIRED', AGENT_EXPIRED_ERROR);

/**
 * preParsing of `/api/ingest` (after the rate limit, before the body is read): bearer token of a non-revoked agent,
 * looked up by its hash and compared again in constant time; an expired registration is a 401 with
 * AGENT_EXPIRED_ERROR (only to the holder of the token: anyone else gets the plain 401).
 */
export function authenticateAgent(ctx: AppContext) {
  return async (request: FastifyRequest): Promise<void> => {
    const hash = bearerHash(request);
    // The token identifies the agent and so its client: the hostname does not matter for the ingest.
    const [agent] = await ctx.db
      .select({ id: agents.id, tenantId: agents.tenantId, tokenHash: agents.tokenHash, expiresAt: agents.expiresAt })
      .from(agents)
      .where(and(eq(agents.tokenHash, hash), eq(agents.revoked, false)))
      .limit(1);
    if (!agent || !hashesEqual(agent.tokenHash, hash)) throw unauthorized();
    if (agent.expiresAt && agent.expiresAt <= ctx.now()) {
      request.log.info({ agentId: agent.id }, 'agente con registrazione scaduta');
      throw agentExpired();
    }
    request.agent = { id: agent.id, tenantId: agent.tenantId };
    await ctx.db.update(agents).set({ lastSeenAt: ctx.now() }).where(eq(agents.id, agent.id));
  };
}

/**
 * Player of a token (sha256 of the token, compared again in constant time), not revoked; `tenantId` limits it to one
 * client (the page `/schermo` on the hostname of another client finds nothing). null when there is none.
 */
export async function findDisplay(
  ctx: AppContext,
  hash: string,
  tenantId?: string,
): Promise<typeof displays.$inferSelect | null> {
  const [row] = await ctx.db
    .select()
    .from(displays)
    .where(
      and(
        eq(displays.tokenHash, hash),
        eq(displays.revoked, false),
        tenantId === undefined ? undefined : eq(displays.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row?.tokenHash && hashesEqual(row.tokenHash, hash) ? row : null;
}

/**
 * preHandler of `/api/displays/*`: bearer token of a player not revoked (the hostname does not matter, as for the
 * ingest). Every missing or wrong token counts for the IP (`ctx.displayFailures`): past `rateLimits.displayInvalid`
 * per minute that IP gets 429 until the minute ends.
 */
export function authenticateDisplay(ctx: AppContext) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = request.ip || 'sconosciuto';
    const wait = ctx.displayFailures.blockedFor(ip);
    if (wait > 0) {
      void reply.header('retry-after', String(Math.ceil(wait / 1000)));
      throw tooManyRequests();
    }
    let display: typeof displays.$inferSelect | null = null;
    try {
      display = await findDisplay(ctx, bearerHash(request));
    } catch (err) {
      if (!(err instanceof HttpError) || err.statusCode !== 401) throw err;
    }
    if (!display) {
      ctx.displayFailures.fail(ip);
      throw unauthorized();
    }
    request.display = { id: display.id, tenantId: display.tenantId };
  };
}
