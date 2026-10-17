import type { CreateTenantResponse, MeResponse, TenantSummary } from '@sir/shared';
import {
  clampAgentQuota,
  CreateTenantRequestSchema,
  IdParamSchema,
  SetActiveTenantRequestSchema,
  UpdateTenantRequestSchema,
} from '@sir/shared';
import { and, arrayOverlaps, asc, count, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { sessions, tenants, users } from '../db/index.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, unusablePasswordHash } from '../lib/passwords.js';
import { hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { findTenant, forgetTenants, tenantRef } from '../tenancy.js';
import { deliverInvite, issueLink } from '../userLinks.js';
import { insertTenantUser } from '../users.js';

type TenantRow = typeof tenants.$inferSelect;
type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

/** Key of the transaction lock that serializes the writes of the clients (hostnames unique among all of them). */
const TENANT_LOCK_KEY = 0x53495254;

/**
 * The quota is brought within the limits of the schema: one value out of range (the database refuses it since the
 * migration 0008) must not make the whole list of clients unreadable for the portal.
 */
const tenantSummary = (t: TenantRow, userCount: number): TenantSummary => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  hostnames: t.hostnames,
  createdAt: t.createdAt.toISOString(),
  agentQuota: clampAgentQuota(t.agentQuota),
  userCount,
});

/** Users of every client (disabled ones included), by client id. */
async function userCounts(db: AppContext['db'] | Tx, tenantId?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ tenantId: users.tenantId, n: count() })
    .from(users)
    .where(tenantId ? eq(users.tenantId, tenantId) : isNotNull(users.tenantId))
    .groupBy(users.tenantId);
  return new Map(rows.flatMap((r) => (r.tenantId ? [[r.tenantId, r.n] as const] : [])));
}

const hostnameTaken = () => conflict('Hostname già usato da un altro cliente');

/** True when another client (not `exceptId`) already has one of `hostnames`. */
async function hostnamesTaken(tx: Tx, hostnames: string[], exceptId: string | null): Promise<boolean> {
  if (hostnames.length === 0) return false;
  const overlap = arrayOverlaps(tenants.hostnames, hostnames);
  const [row] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(exceptId ? and(overlap, ne(tenants.id, exceptId)) : overlap)
    .limit(1);
  return row !== undefined;
}

/** Clients (superadmin only) and the client a superadmin works on. */
export function tenantRoutes(app: FastifyInstance, ctx: AppContext): void {
  const superadmin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'superadmin') };

  app.get('/api/admin/tenants', superadmin, async (): Promise<TenantSummary[]> => {
    const rows = await ctx.db.select().from(tenants).orderBy(asc(tenants.name));
    const counts = await userCounts(ctx.db);
    return rows.map((t) => tenantSummary(t, counts.get(t.id) ?? 0));
  });

  app.post('/api/admin/tenants', superadmin, async (request, reply): Promise<CreateTenantResponse> => {
    const body = validate(CreateTenantRequestSchema, request.body);
    const firstUser = body.firstUser;
    // Without a password the first user is invited (link by email, or to copy without a mail server).
    const passwordHash = firstUser
      ? firstUser.password === undefined
        ? await unusablePasswordHash()
        : await hashPassword(firstUser.password)
      : null;
    const { row, user, issued } = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TENANT_LOCK_KEY})`);
      if (await hostnamesTaken(tx, body.hostnames, null)) throw hostnameTaken();
      const [inserted] = await tx
        .insert(tenants)
        .values({ slug: body.slug, name: body.name, hostnames: body.hostnames, agentQuota: body.agentQuota })
        .onConflictDoNothing({ target: tenants.slug })
        .returning();
      if (!inserted) throw conflict('Esiste già un cliente con questo identificativo');
      // The first user (role admin) in the same transaction: an email already taken leaves no client behind.
      const created =
        firstUser && passwordHash
          ? await insertTenantUser(tx, { tenantId: inserted.id, email: firstUser.email, passwordHash, role: 'admin' })
          : null;
      const link =
        created && firstUser?.password === undefined ? await issueLink(tx, created.id, 'invite', ctx.now()) : null;
      return { row: inserted, user: created, issued: link };
    });
    forgetTenants(ctx);
    const delivery = user && issued ? await deliverInvite(ctx, user, issued) : null;
    request.log.info(
      {
        tenantId: row.id,
        userId: request.user?.id,
        firstUserId: user?.id ?? null,
        ...(delivery ? { mail: delivery.mail } : {}),
      },
      'cliente creato',
    );
    void reply.code(201);
    return { ...tenantSummary(row, user ? 1 : 0), firstUserInvite: delivery };
  });

  app.patch('/api/admin/tenants/:id', superadmin, async (request): Promise<TenantSummary> => {
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(UpdateTenantRequestSchema, request.body);
    const row = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TENANT_LOCK_KEY})`);
      if (body.hostnames && (await hostnamesTaken(tx, body.hostnames, id))) throw hostnameTaken();
      const [updated] = await tx
        .update(tenants)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.hostnames === undefined ? {} : { hostnames: body.hostnames }),
          // A lower quota does not switch off the agents already there: it stops new approvals until they fit.
          ...(body.agentQuota === undefined ? {} : { agentQuota: body.agentQuota }),
        })
        .where(eq(tenants.id, id))
        .returning();
      if (!updated) throw notFound();
      return updated;
    });
    forgetTenants(ctx);
    request.log.info({ tenantId: row.id, userId: request.user?.id }, 'cliente modificato');
    return tenantSummary(row, (await userCounts(ctx.db, row.id)).get(row.id) ?? 0);
  });

  /**
   * «Entra nel cliente» / «Esci dal cliente» of a superadmin: the client of its admin pages, kept in its session (so
   * the WebSocket and every page use it); null: no client (only the pages of the superadmin). Every change is in the
   * log (user, client left, client entered). Another role gets 403.
   */
  app.post('/api/admin/active-tenant', superadmin, async (request): Promise<MeResponse> => {
    const body = validate(SetActiveTenantRequestSchema, request.body);
    const user = request.user;
    const token = request.cookies[SESSION_COOKIE];
    if (!user || !token) throw unauthorized();
    if (body.tenantId && !(await findTenant(ctx, { id: body.tenantId }))) throw notFound();
    await ctx.db
      .update(sessions)
      .set({ activeTenantId: body.tenantId })
      .where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.userId, user.id)));
    const previous = request.adminTenantId;
    if (previous && previous !== body.tenantId) {
      request.log.info({ userId: user.id, tenantId: previous }, 'superadmin uscito dal cliente');
    }
    if (body.tenantId && previous !== body.tenantId) {
      request.log.info({ userId: user.id, tenantId: body.tenantId }, 'superadmin entrato nel cliente');
    }
    return { id: user.id, email: user.email, role: user.role, tenant: await tenantRef(ctx, body.tenantId) };
  });
}
