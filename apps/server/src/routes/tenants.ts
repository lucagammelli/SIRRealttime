import type { CreateTenantResponse, MeResponse, TenantSummary } from '@arenalive/shared';
import {
  clampAgentQuota,
  CreateTenantRequestSchema,
  IdParamSchema,
  SetActiveTenantRequestSchema,
  UpdateTenantRequestSchema,
} from '@arenalive/shared';
import { and, arrayOverlaps, asc, count, eq, isNotNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { ensureFixtureLinks, revokeMatchLinks } from '../club.js';
import { sessions, tenants, users } from '../db/index.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, unusablePasswordHash } from '../lib/passwords.js';
import { hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { lockTenantMatches } from '../matchLock.js';
import { requireRole } from '../security.js';
import { dropShareLinks, forgetClubCaches } from '../state.js';
import { findTenant, forgetTenants, lockTenants, tenantConfigChanged, tenantRef } from '../tenancy.js';
import { deliverInvite, issueLink } from '../userLinks.js';
import { insertTenantUser } from '../users.js';

type TenantRow = typeof tenants.$inferSelect;
type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

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
  matchLinksEnabled: t.matchLinksEnabled,
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
      await lockTenants(tx);
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
    const { row, linksChanged, revoked } = await ctx.db.transaction(async (tx) => {
      await lockTenants(tx);
      if (body.hostnames && (await hostnamesTaken(tx, body.hostnames, id))) throw hostnameTaken();
      const [before] = await tx
        .select({ matchLinksEnabled: tenants.matchLinksEnabled })
        .from(tenants)
        .where(eq(tenants.id, id));
      if (!before) throw notFound();
      const [updated] = await tx
        .update(tenants)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.hostnames === undefined ? {} : { hostnames: body.hostnames }),
          // A lower quota does not switch off the agents already there: it stops new approvals until they fit.
          ...(body.agentQuota === undefined ? {} : { agentQuota: body.agentQuota }),
          ...(body.matchLinksEnabled === undefined ? {} : { matchLinksEnabled: body.matchLinksEnabled }),
        })
        .where(eq(tenants.id, id))
        .returning();
      if (!updated) throw notFound();
      const changed = body.matchLinksEnabled !== undefined && body.matchLinksEnabled !== before.matchLinksEnabled;
      if (!changed) return { row: updated, linksChanged: false, revoked: [] };
      // «Link e QR per singola partita»: off revokes the links of one match for good; on again gives every match of
      // the calendar a new link (the revoked ones stay revoked). Under the lock of the matches, as the updates of the
      // calendar (lock order: clients, then matches).
      await lockTenantMatches(tx, id);
      if (!updated.matchLinksEnabled)
        return { row: updated, linksChanged: true, revoked: await revokeMatchLinks(tx, id) };
      await ensureFixtureLinks(tx, ctx.config.shareCodeSecret, id, { renewRevoked: true });
      return { row: updated, linksChanged: true, revoked: [] };
    });
    // Name and hostnames are shown by the open pages of the client.
    tenantConfigChanged(ctx, row.id);
    if (linksChanged) {
      forgetClubCaches(ctx, row.id);
      dropShareLinks(ctx, revoked);
    }
    request.log.info(
      {
        tenantId: row.id,
        userId: request.user?.id,
        ...(linksChanged ? { matchLinksEnabled: row.matchLinksEnabled, linksRevoked: revoked.length } : {}),
      },
      'cliente modificato',
    );
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
