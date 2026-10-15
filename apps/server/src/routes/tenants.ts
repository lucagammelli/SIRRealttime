import type { MeResponse, TenantSummary } from '@sir/shared';
import {
  CreateTenantRequestSchema,
  IdParamSchema,
  SetActiveTenantRequestSchema,
  UpdateTenantRequestSchema,
} from '@sir/shared';
import { and, arrayOverlaps, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { sessions, tenants } from '../db/index.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { findTenant, forgetTenants, hostTenant, tenantRef } from '../tenancy.js';

type TenantRow = typeof tenants.$inferSelect;
type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

/** Key of the transaction lock that serializes the writes of the clients (hostnames unique among all of them). */
const TENANT_LOCK_KEY = 0x53495254;

const tenantSummary = (t: TenantRow): TenantSummary => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  hostnames: t.hostnames,
  createdAt: t.createdAt.toISOString(),
});

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
    return rows.map(tenantSummary);
  });

  app.post('/api/admin/tenants', superadmin, async (request, reply): Promise<TenantSummary> => {
    const body = validate(CreateTenantRequestSchema, request.body);
    const row = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TENANT_LOCK_KEY})`);
      if (await hostnamesTaken(tx, body.hostnames, null)) throw hostnameTaken();
      const [inserted] = await tx
        .insert(tenants)
        .values({ slug: body.slug, name: body.name, hostnames: body.hostnames })
        .onConflictDoNothing({ target: tenants.slug })
        .returning();
      if (!inserted) throw conflict('Esiste già un cliente con questo identificativo');
      return inserted;
    });
    forgetTenants(ctx);
    request.log.info({ tenantId: row.id, userId: request.user?.id }, 'cliente creato');
    void reply.code(201);
    return tenantSummary(row);
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
        })
        .where(eq(tenants.id, id))
        .returning();
      if (!updated) throw notFound();
      return updated;
    });
    forgetTenants(ctx);
    request.log.info({ tenantId: row.id, userId: request.user?.id }, 'cliente modificato');
    return tenantSummary(row);
  });

  /**
   * Client of the admin pages of a superadmin, kept in its session (so the WebSocket and every page use it);
   * null: back to the client of the hostname. Another role gets 403.
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
    const tenantId = body.tenantId ?? (await hostTenant(ctx, request))?.id ?? null;
    request.log.info({ userId: user.id, tenantId }, 'cliente attivo del superadmin');
    return { id: user.id, email: user.email, role: user.role, tenant: await tenantRef(ctx, tenantId) };
  });
}
