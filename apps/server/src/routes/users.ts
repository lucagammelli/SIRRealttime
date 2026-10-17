import type { UserSummary } from '@sir/shared';
import { CreateUserRequestSchema, IdParamSchema, UpdateUserRequestSchema } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext, SessionUser } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { users } from '../db/index.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword } from '../lib/passwords.js';
import { hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import type { Tx } from '../matchLock.js';
import { requireRole } from '../security.js';
import { adminTenantId, tenantScope } from '../tenancy.js';
import {
  activeAdminsBesides,
  closeSessionSockets,
  deleteUserSessions,
  insertTenantUser,
  LAST_ADMIN_MESSAGE,
  lockTenantUsers,
  SELF_CHANGE_MESSAGE,
} from '../users.js';

type UserRow = typeof users.$inferSelect;

/** Never the password hash. */
export const userSummary = (u: UserRow): UserSummary => ({
  id: u.id,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
  disabled: u.disabled,
});

/** True when the user is an active `admin` (it counts for «at least one active admin per client»). */
const activeAdmin = (u: Pick<UserRow, 'role' | 'disabled'>): boolean => u.role === 'admin' && !u.disabled;

/**
 * Users of the client of the session (role `admin`; a superadmin works on the client it chose): list, creation,
 * change of role, new password, disabling and deletion. A superadmin user is never listed nor changed here (its row
 * has no client: 404). Nobody takes away its own role nor disables or deletes itself (409); a client keeps at least
 * one active admin (409), unless the change comes from the superadmin. A change of role or password and the disabling
 * close the sessions of the user (and their admin WebSockets).
 */
export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  const actorOf = (request: FastifyRequest): SessionUser => {
    if (!request.user) throw unauthorized();
    return request.user;
  };

  /** The user of the client, locked for the change (404 for another client or a superadmin). */
  const findForChange = async (tx: Tx, tenantId: string, id: string): Promise<UserRow> => {
    await lockTenantUsers(tx, tenantId);
    const [row] = await tx
      .select()
      .from(users)
      .where(tenantScope(users, tenantId, eq(users.id, id)))
      .limit(1);
    if (!row) throw notFound();
    return row;
  };

  /** 409 when the change leaves the client without an active admin (not for the superadmin). */
  const keepAnAdmin = async (tx: Tx, actor: SessionUser, before: UserRow, stillAdmin: boolean): Promise<void> => {
    if (actor.role === 'superadmin' || !activeAdmin(before) || stillAdmin || !before.tenantId) return;
    if ((await activeAdminsBesides(tx, before.tenantId, before.id)) === 0) throw conflict(LAST_ADMIN_MESSAGE);
  };

  app.post('/api/admin/users', admin, async (request, reply): Promise<UserSummary> => {
    const tenantId = adminTenantId(request);
    const body = validate(CreateUserRequestSchema, request.body);
    const passwordHash = await hashPassword(body.password);
    const row = await ctx.db.transaction((tx) =>
      insertTenantUser(tx, { tenantId, email: body.email, passwordHash, role: body.role }),
    );
    request.log.info({ userId: row.id, role: row.role, by: request.user?.id }, 'utente creato');
    void reply.code(201);
    return userSummary(row);
  });

  app.get('/api/admin/users', admin, async (request): Promise<UserSummary[]> => {
    const tenantId = adminTenantId(request);
    const rows = await ctx.db.select().from(users).where(tenantScope(users, tenantId)).orderBy(users.createdAt);
    return rows.map(userSummary);
  });

  app.patch('/api/admin/users/:id', admin, async (request): Promise<UserSummary> => {
    const tenantId = adminTenantId(request);
    const actor = actorOf(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(UpdateUserRequestSchema, request.body);
    const passwordHash = body.password === undefined ? undefined : await hashPassword(body.password);
    const token = request.cookies[SESSION_COOKIE];
    const self = id === actor.id;
    const { row, closed, roleChanged } = await ctx.db.transaction(async (tx) => {
      const before = await findForChange(tx, tenantId, id);
      const role = body.role ?? before.role;
      const disabled = body.disabled ?? before.disabled;
      const roleChanged = role !== before.role;
      const disabling = disabled && !before.disabled;
      if (self && (roleChanged || disabling)) throw conflict(SELF_CHANGE_MESSAGE);
      await keepAnAdmin(tx, actor, before, activeAdmin({ role, disabled }));
      const [updated] = await tx
        .update(users)
        .set({ role, disabled, ...(passwordHash === undefined ? {} : { passwordHash }) })
        .where(tenantScope(users, tenantId, eq(users.id, id)))
        .returning();
      if (!updated) throw notFound();
      // A user changing its own password keeps the session it is using; the others are closed.
      const closeAll = roleChanged || disabling || passwordHash !== undefined;
      const keep = self && token ? hashToken(token) : undefined;
      const closed = closeAll ? await deleteUserSessions(tx, id, keep) : [];
      return { row: updated, closed, roleChanged };
    });
    closeSessionSockets(ctx, closed);
    request.log.info(
      {
        userId: id,
        by: actor.id,
        ...(roleChanged ? { role: row.role } : {}),
        ...(body.disabled === undefined ? {} : { disabled: row.disabled }),
        passwordChanged: passwordHash !== undefined,
        sessionsClosed: closed.length,
      },
      'utente modificato',
    );
    return userSummary(row);
  });

  app.delete('/api/admin/users/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const actor = actorOf(request);
    const { id } = validate(IdParamSchema, request.params);
    const closed = await ctx.db.transaction(async (tx) => {
      const before = await findForChange(tx, tenantId, id);
      if (id === actor.id) throw conflict(SELF_CHANGE_MESSAGE);
      await keepAnAdmin(tx, actor, before, false);
      const hashes = await deleteUserSessions(tx, id);
      await tx.delete(users).where(tenantScope(users, tenantId, eq(users.id, id)));
      return hashes;
    });
    closeSessionSockets(ctx, closed);
    request.log.info({ userId: id, by: actor.id }, 'utente eliminato');
    return reply.code(204).send();
  });
}
