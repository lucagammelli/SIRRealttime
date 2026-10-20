import type { ResetLinkResponse, UserInviteResponse, UserSummary } from '@arenalive/shared';
import { CreateUserRequestSchema, IdParamSchema, UpdateUserRequestSchema } from '@arenalive/shared';
import { and, eq, exists, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext, SessionUser } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { userTokens, users } from '../db/index.js';
import { conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, unusablePasswordHash } from '../lib/passwords.js';
import { hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import type { Tx } from '../matchLock.js';
import { requireRole } from '../security.js';
import { adminTenantId, tenantScope } from '../tenancy.js';
import { deliverInvite, inviteStates, issueLink, linkUrl } from '../userLinks.js';
import {
  activeAdminsBesides,
  hasOpenInviteTx,
  closeSessionSockets,
  deleteUserSessions,
  insertTenantUser,
  LAST_ADMIN_MESSAGE,
  lockTenantUsers,
  SELF_CHANGE_MESSAGE,
} from '../users.js';

type UserRow = typeof users.$inferSelect;

/** Never the password hash. `invite`: state of its invitation, if it has not chosen its password yet. */
export const userSummary = (u: UserRow, invite: UserSummary['invite'] = null): UserSummary => ({
  id: u.id,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
  disabled: u.disabled,
  invite,
});

/** True when the user is an active `admin` (it counts for «at least one active admin per client»). */
const activeAdmin = (u: Pick<UserRow, 'role' | 'disabled'>): boolean => u.role === 'admin' && !u.disabled;

/**
 * Users of the client of the session (role `admin`; a superadmin works on the client it chose): list, creation,
 * change of role, new password, disabling and deletion. A superadmin user is never listed nor changed here (its row
 * has no client: 404). Nobody takes away its own role nor disables or deletes itself (409); a client keeps at least
 * one active admin (409), unless the change comes from the superadmin. A change of role or password and the disabling
 * close the sessions of the user (and their admin WebSockets). A user created without a password is invited: a
 * link (72 h, one use) to choose the first password goes by email, or is given back to be copied when there is no
 * mail server; until then it cannot log in. «Invia di nuovo» replaces the link, «Annulla invito» deletes the user.
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
    // An invited admin has not chosen a password: it is not one of the active admins.
    if (await hasOpenInviteTx(tx, before.id)) return;
    if ((await activeAdminsBesides(tx, before.tenantId, before.id)) === 0) throw conflict(LAST_ADMIN_MESSAGE);
  };

  app.post('/api/admin/users', admin, async (request, reply): Promise<UserInviteResponse> => {
    const tenantId = adminTenantId(request);
    const body = validate(CreateUserRequestSchema, request.body);
    const invited = body.password === undefined;
    const passwordHash = invited ? await unusablePasswordHash() : await hashPassword(body.password ?? '');
    const { row, issued } = await ctx.db.transaction(async (tx) => {
      const inserted = await insertTenantUser(tx, { tenantId, email: body.email, passwordHash, role: body.role });
      return { row: inserted, issued: invited ? await issueLink(tx, inserted.id, 'invite', ctx.now()) : null };
    });
    const delivery = issued ? await deliverInvite(ctx, row, issued) : null;
    request.log.info(
      { userId: row.id, role: row.role, by: request.user?.id, invited, ...(delivery ? { mail: delivery.mail } : {}) },
      'utente creato',
    );
    void reply.code(201);
    return { ...userSummary(row, issued ? 'pending' : null), delivery };
  });

  app.get('/api/admin/users', admin, async (request): Promise<UserSummary[]> => {
    const tenantId = adminTenantId(request);
    const rows = await ctx.db.select().from(users).where(tenantScope(users, tenantId)).orderBy(users.createdAt);
    const invites = await inviteStates(
      ctx,
      rows.map((u) => u.id),
      ctx.now(),
    );
    return rows.map((u) => userSummary(u, invites.get(u.id) ?? null));
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
      // A password set by the admin makes the invitation useless.
      if (passwordHash !== undefined) {
        await tx.delete(userTokens).where(and(eq(userTokens.userId, id), eq(userTokens.kind, 'invite')));
      }
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
    return userSummary(row, (await inviteStates(ctx, [id], ctx.now())).get(id) ?? null);
  });

  /** «Invia di nuovo»: a new invitation link (the previous one stops working), by email or to copy. */
  app.post('/api/admin/users/:id/invite', admin, async (request): Promise<UserInviteResponse> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const { row, issued } = await ctx.db.transaction(async (tx) => {
      const before = await findForChange(tx, tenantId, id);
      const [open] = await tx
        .select({ id: userTokens.id })
        .from(userTokens)
        .where(and(eq(userTokens.userId, id), eq(userTokens.kind, 'invite')))
        .limit(1);
      if (!open) throw conflict('L’utente ha già scelto la password: non c’è nessun invito da inviare');
      if (before.disabled) throw conflict('L’utente è disattivato: riattivalo prima di invitarlo');
      return { row: before, issued: await issueLink(tx, id, 'invite', ctx.now()) };
    });
    const delivery = await deliverInvite(ctx, row, issued);
    request.log.info({ userId: id, by: request.user?.id, mail: delivery.mail }, 'invito inviato di nuovo');
    return { ...userSummary(row, 'pending'), delivery };
  });

  /** «Annulla invito»: the user never chose a password, so it is deleted (its link stops working). */
  app.delete('/api/admin/users/:id/invite', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const actor = actorOf(request);
    const { id } = validate(IdParamSchema, request.params);
    await ctx.db.transaction(async (tx) => {
      const before = await findForChange(tx, tenantId, id);
      await keepAnAdmin(tx, actor, before, false);
      // One statement: the user goes only if the invitation is still open (not if it was just accepted).
      const deleted = await tx
        .delete(users)
        .where(
          tenantScope(
            users,
            tenantId,
            eq(users.id, id),
            exists(
              tx
                .select({ one: sql`1` })
                .from(userTokens)
                .where(and(eq(userTokens.userId, users.id), eq(userTokens.kind, 'invite'))),
            ),
          ),
        )
        .returning({ id: users.id });
      if (deleted.length === 0)
        throw conflict('L’utente ha già scelto la password: non c’è nessun invito da annullare');
    });
    request.log.info({ userId: id, by: request.user?.id }, 'invito annullato');
    return reply.code(204).send();
  });

  /**
   * «Link per nuova password»: a one-hour link to copy and give to the user (for when there is no mail server or the
   * mail does not arrive). It replaces the previous reset link; using it closes the sessions of the user.
   */
  app.post('/api/admin/users/:id/reset-link', admin, async (request): Promise<ResetLinkResponse> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const issued = await ctx.db.transaction(async (tx) => {
      const before = await findForChange(tx, tenantId, id);
      if (before.disabled) throw conflict('L’utente è disattivato: riattivalo prima di dargli un link');
      return issueLink(tx, id, 'reset', ctx.now());
    });
    request.log.info({ userId: id, by: request.user?.id }, 'link per nuova password creato');
    return {
      link: linkUrl(ctx.config.publicBaseUrl, 'reset', issued.token),
      expiresAt: issued.expiresAt.toISOString(),
    };
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
