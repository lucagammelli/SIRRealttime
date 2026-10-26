import type { DisplayCommandMessage, DisplaySummary, DisplayTarget } from '@arenalive/shared';
import { DISPLAY_LIMIT } from '@arenalive/shared';
import { and, count, eq, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from './context.js';
import type { Db } from './db/index.js';
import { clientFixtures, displays, matches } from './db/index.js';
import type { Target } from './hub.js';
import { badRequest, HttpError } from './lib/errors.js';
import type { Tx } from './matchLock.js';
import { sendLive } from './state.js';
import { tenantScope } from './tenancy.js';

/**
 * Players for big screens (`display`): what they show, the summary of the reserved area and the move of their
 * sockets when the admin changes something. Routes: `routes/admin.ts` (reserved area), `routes/display.ts` (device).
 */

export type DisplayRow = typeof displays.$inferSelect;

/**
 * Pure: what a player shows. A kind whose match (or match of the calendar) was deleted has a null id (`on delete set
 * null`): the waiting screen, never a content the admin did not choose.
 */
export function displayTargetOf(row: Pick<DisplayRow, 'targetKind' | 'matchId' | 'clientFixtureId'>): DisplayTarget {
  if (row.targetKind === 'channel') return { kind: 'channel' };
  if (row.targetKind === 'match' && row.matchId) return { kind: 'match', matchId: row.matchId };
  if (row.targetKind === 'fixture' && row.clientFixtureId)
    return { kind: 'fixture', clientFixtureId: row.clientFixtureId };
  return { kind: 'none' };
}

/** Pure: the columns of a target. */
export function targetColumns(target: DisplayTarget): Pick<DisplayRow, 'targetKind' | 'matchId' | 'clientFixtureId'> {
  return {
    targetKind: target.kind,
    matchId: target.kind === 'match' ? target.matchId : null,
    clientFixtureId: target.kind === 'fixture' ? target.clientFixtureId : null,
  };
}

/** Pure: what the socket of a player follows in the hub (the same targets of the public links, or `standby`). */
export function hubTargetOf(
  row: Pick<DisplayRow, 'id' | 'tenantId' | 'targetKind' | 'matchId' | 'clientFixtureId'>,
): Target {
  const target = displayTargetOf(row);
  const tenantId = row.tenantId;
  switch (target.kind) {
    case 'channel':
      return { kind: 'channel', tenantId };
    case 'match':
      return { kind: 'match', tenantId, matchId: target.matchId };
    case 'fixture':
      return { kind: 'fixture', tenantId, clientFixtureId: target.clientFixtureId };
    case 'none':
      return { kind: 'standby', tenantId, displayId: row.id };
  }
}

/** Pure: a player in the reserved area; `withIp` false (a viewer): without the IP of the last heartbeat. */
export function displaySummary(row: DisplayRow, withIp: boolean): DisplaySummary {
  return {
    id: row.id,
    name: row.name,
    target: displayTargetOf(row),
    configured: row.tokenHash !== null,
    revoked: row.revoked,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    lastIp: withIp ? row.lastIp : null,
    version: row.version,
    resolution: row.resolution,
    command: row.command,
    commandSeq: row.commandSeq,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Key of the transaction lock (with a hash of the client) that serializes the creation of the players of a client. */
const DISPLAY_LOCK_KEY = 0x53494450;

export async function lockTenantDisplays(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${DISPLAY_LOCK_KEY}, hashtext(${tenantId}))`);
}

/** Pure: the 409 of a client that already has DISPLAY_LIMIT players. */
export function displayLimitReached(): HttpError {
  return new HttpError(
    409,
    'DISPLAY_LIMIT',
    `Limite di player raggiunto: questo cliente può averne ${DISPLAY_LIMIT}. Revoca un player che non usi`,
  );
}

/** Under `lockTenantDisplays`: 409 when one more player not revoked would go past DISPLAY_LIMIT. */
export async function requireDisplaySlot(tx: Tx, tenantId: string): Promise<void> {
  const [row] = await tx
    .select({ n: count() })
    .from(displays)
    .where(tenantScope(displays, tenantId, eq(displays.revoked, false)));
  if ((row?.n ?? 0) >= DISPLAY_LIMIT) throw displayLimitReached();
}

/**
 * 400 unless the target is of the client: a real match (never a simulated one, which is only for its own link) or a
 * match of its calendar.
 */
export async function checkDisplayTarget(db: Db | Tx, tenantId: string, target: DisplayTarget): Promise<void> {
  if (target.kind === 'match') {
    const [m] = await db
      .select({ id: matches.id })
      .from(matches)
      .where(tenantScope(matches, tenantId, eq(matches.id, target.matchId), eq(matches.simulated, false)))
      .limit(1);
    if (!m) throw badRequest('Richiesta non valida: matchId');
  } else if (target.kind === 'fixture') {
    const [f] = await db
      .select({ id: clientFixtures.id })
      .from(clientFixtures)
      .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, target.clientFixtureId)))
      .limit(1);
    if (!f) throw badRequest('Richiesta non valida: clientFixtureId');
  }
}

/** Pure: a PostgreSQL error of a foreign key (code 23503), also when wrapped by drizzle in `cause`. */
export function isForeignKeyViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e !== null && typeof e === 'object' && depth < 5; depth++) {
    if ('code' in e && e.code === '23503') return true;
    e = 'cause' in e ? e.cause : null;
  }
  return false;
}

/**
 * The command `commandSeq` (and every earlier one) was executed: the pending command is cleared unless a newer one
 * was sent meanwhile.
 */
export async function acknowledgeCommand(db: Db, displayId: string, commandSeq: number): Promise<void> {
  await db
    .update(displays)
    .set({ command: null })
    .where(and(eq(displays.id, displayId), lte(displays.commandSeq, commandSeq)));
}

/** The open pages of a player show what it shows now (target changed, renamed: the full message of the target). */
export function showDisplay(ctx: AppContext, row: DisplayRow, log: FastifyBaseLogger): void {
  const target = hubTargetOf(row);
  for (const socket of ctx.hub.displaySockets(row.id)) {
    ctx.hub.setTarget(socket, target);
    sendLive(ctx, socket, target, log);
  }
}

/** A `reload` for the open pages of a player, at once (the device gets it with the next heartbeat too). */
export function sendReload(ctx: AppContext, displayId: string, commandSeq: number): void {
  const message: DisplayCommandMessage = { type: 'command', command: 'reload', commandSeq };
  for (const socket of ctx.hub.displaySockets(displayId)) ctx.hub.send(socket, message);
}

/**
 * After a match of the calendar of a client was deleted: its players with an open page show what they show now
 * (the waiting screen for the ones that showed that match).
 */
export async function refreshDisplays(ctx: AppContext, tenantId: string, log: FastifyBaseLogger): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(displays)
    .where(tenantScope(displays, tenantId, eq(displays.revoked, false)));
  for (const row of rows) if (ctx.hub.displaySockets(row.id).length > 0) showDisplay(ctx, row, log);
}
