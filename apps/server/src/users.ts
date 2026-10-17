import { and, count, eq, ne, sql } from 'drizzle-orm';
import type { AppContext } from './context.js';
import { sessions, users } from './db/index.js';
import { conflict } from './lib/errors.js';
import type { Tx } from './matchLock.js';
import { tenantScope } from './tenancy.js';

/**
 * Users of a client: the changes that can leave a client without an active admin (change of role, disabling,
 * deletion) are serialized by a lock of the client, so two of them at the same time cannot both remove the last one.
 */

/** Key of the transaction lock (with a hash of the client) that serializes the changes to the users of a client. */
const USER_LOCK_KEY = 0x53495553;

export const LAST_ADMIN_MESSAGE =
  'Il cliente deve avere almeno un utente attivo «Lettura e scrittura»: assegna prima questo ruolo a un altro utente';
export const SELF_CHANGE_MESSAGE =
  'Non puoi togliere a te stesso il ruolo né disattivare o eliminare il tuo utente: chiedilo a un altro amministratore';
export const USER_EXISTS_MESSAGE = 'Utente già esistente';

export async function lockTenantUsers(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${USER_LOCK_KEY}, hashtext(${tenantId}))`);
}

/** Active users with the role `admin` of the client, without `exceptUserId`. */
export async function activeAdminsBesides(tx: Tx, tenantId: string, exceptUserId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(users)
    .where(
      tenantScope(users, tenantId, eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, exceptUserId)),
    );
  return row?.n ?? 0;
}

/**
 * Inserts a user of a client (409 USER_EXISTS_MESSAGE when the email is taken: emails are unique among all the
 * clients, as the login finds a user by email alone).
 */
export async function insertTenantUser(
  tx: Tx,
  values: { tenantId: string; email: string; passwordHash: string; role: 'admin' | 'viewer' },
): Promise<typeof users.$inferSelect> {
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, values.email)).limit(1);
  if (existing) throw conflict(USER_EXISTS_MESSAGE);
  const [row] = await tx.insert(users).values(values).onConflictDoNothing({ target: users.email }).returning();
  if (!row) throw conflict(USER_EXISTS_MESSAGE);
  return row;
}

/**
 * Deletes the sessions of a user (all but `keepHash`, the session of the request when a user changes its own
 * password) and returns their hashes, to close their admin WebSockets after the commit (`closeSessionSockets`).
 */
export async function deleteUserSessions(tx: Tx, userId: string, keepHash?: string): Promise<string[]> {
  const rows = await tx
    .delete(sessions)
    .where(keepHash ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, keepHash)) : eq(sessions.userId, userId))
    .returning({ tokenHash: sessions.tokenHash });
  return rows.map((r) => r.tokenHash);
}

/** Closes the admin WebSockets of sessions just deleted. */
export function closeSessionSockets(ctx: AppContext, hashes: readonly string[]): void {
  for (const hash of hashes) ctx.hub.closeSession(hash);
}
