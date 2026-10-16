import type { ServerMessage, ShareAccess } from '@sir/shared';
import { ClientMessageSchema, LiveSocketQuerySchema } from '@sir/shared';
import { desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { refreshClientFixtures, scheduledMessage } from './club.js';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext, ResolvedShareToken } from './context.js';
import { matches, shareTokens } from './db/index.js';
import type { FrameEncoding, Subscriber, Target } from './hub.js';
import { shortCodeLookupHash } from './lib/shortCode.js';
import { hashToken } from './lib/tokens.js';
import { tenantScope } from './tenancy.js';

const whereOf = (target: Target) =>
  target.kind === 'live'
    ? eq(matches.live, true)
    : target.kind === 'match'
      ? eq(matches.id, target.matchId)
      : eq(matches.clientFixtureId, target.clientFixtureId);

/**
 * Current message for a target: the state of the match (of the target's client), or `noMatch`; for a match of the
 * calendar, «Prossima partita» (`scheduled`) until a `.dvw` is linked to it, then that match (the live one, otherwise
 * the one live last). The live link shows the match that became live last. From the memory of the hub when it has it
 * (every state published by this process), otherwise from the database (then kept there).
 */
export async function currentMessage(ctx: AppContext, target: Target): Promise<ServerMessage> {
  const known = ctx.hub.current(target);
  if (known) return known;
  const waiting = target.kind === 'fixture' ? ctx.hub.currentScheduled(target.tenantId, target.clientFixtureId) : null;
  if (waiting) return waiting;
  const [row] = await ctx.db
    .select({
      id: matches.id,
      version: matches.version,
      state: matches.state,
      live: matches.live,
      clientFixtureId: matches.clientFixtureId,
    })
    .from(matches)
    .where(tenantScope(matches, target.tenantId, whereOf(target), sql`${matches.state} is not null`))
    .orderBy(desc(matches.live), sql`${matches.liveSince} desc nulls last`, desc(matches.updatedAt))
    .limit(1);
  if (!row?.state) {
    if (target.kind !== 'fixture') return { type: 'noMatch' };
    const scheduled = await scheduledMessage(ctx.db, target.tenantId, target.clientFixtureId);
    if (!scheduled) return { type: 'noMatch' };
    ctx.hub.rememberScheduled(target.tenantId, target.clientFixtureId, scheduled);
    return scheduled;
  }
  const message = { type: 'state', matchId: row.id, version: row.version, state: row.state } as const;
  ctx.hub.remember(target.tenantId, message, row.live, row.clientFixtureId);
  return message;
}

/** Frames asked by the query of a live socket (`?enc=gzip`); anything else gets text frames. */
export function encodingOf(query: unknown): FrameEncoding {
  const parsed = LiveSocketQuerySchema.safeParse(query);
  return parsed.success && parsed.data.enc === 'gzip' ? 'gzip' : 'text';
}

/**
 * Registers a live socket in the hub, sends it the current state and answers its `resync` requests (validated
 * with the shared schema; anything else is ignored), paced by `ctx.resync`: every request gets the full state,
 * possibly later.
 */
export function attachLiveSocket(ctx: AppContext, sub: Subscriber, log: FastifyBaseLogger): void {
  const { socket, target } = sub;
  ctx.hub.add(sub);
  const sendCurrent = (): void => {
    currentMessage(ctx, target).then(
      (message) => ctx.hub.send(socket, message),
      (err: unknown) => {
        log.error({ err }, 'stato non disponibile');
        ctx.hub.send(socket, { type: 'error', message: 'Errore interno' });
      },
    );
  };
  const resync = ctx.resync.forSocket(sub.ip ?? null, () => {
    ctx.hub.forget(socket);
    sendCurrent();
  });
  socket.on('close', () => resync.cancel());
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    let value: unknown;
    try {
      value = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (ClientMessageSchema.safeParse(value).success) resync.request();
  });
  sendCurrent();
}

/** Stored hash of what a public request carries: sha256 of the long token, keyed hash of the short code. */
const accessHash = (ctx: AppContext, access: ShareAccess): string =>
  access.kind === 'token' ? hashToken(access.value) : shortCodeLookupHash(ctx.config.shareCodeSecret, access.value);

const shareCacheKey = (ctx: AppContext, tenantId: string, access: ShareAccess): string =>
  `${tenantId}:${access.kind === 'token' ? '' : 'c:'}${accessHash(ctx, access)}`;

/**
 * Share token of the cache (valid when cached, still not expired), or null when the database must be read
 * (`resolveShareToken`). An expired entry is removed.
 */
export function cachedShareToken(ctx: AppContext, tenantId: string, access: ShareAccess): ResolvedShareToken | null {
  const key = shareCacheKey(ctx, tenantId, access);
  const cached = ctx.caches.shares.get(key);
  if (!cached) return null;
  if (!cached.expiresAt || cached.expiresAt > ctx.now()) return cached;
  ctx.caches.shares.delete(key);
  return null;
}

/**
 * Valid (not revoked, not expired) share link of the client `tenantId`, by its long token or by its short code
 * (looked up by sha256 of the token, by the keyed hash of the code), or null; valid ones are cached 30 s.
 */
export async function resolveShareToken(
  ctx: AppContext,
  tenantId: string,
  access: ShareAccess,
): Promise<ResolvedShareToken | null> {
  const cached = cachedShareToken(ctx, tenantId, access);
  if (cached) return cached;
  const hash = accessHash(ctx, access);
  const [row] = await ctx.db
    .select({
      id: shareTokens.id,
      tenantId: shareTokens.tenantId,
      matchId: shareTokens.matchId,
      clientFixtureId: shareTokens.clientFixtureId,
      expiresAt: shareTokens.expiresAt,
    })
    .from(shareTokens)
    .where(
      tenantScope(
        shareTokens,
        tenantId,
        access.kind === 'token' ? eq(shareTokens.tokenHash, hash) : eq(shareTokens.shortCodeHash, hash),
        eq(shareTokens.revoked, false),
        or(isNull(shareTokens.expiresAt), gt(shareTokens.expiresAt, ctx.now())),
      ),
    )
    .limit(1);
  if (!row) return null;
  ctx.caches.shares.set(shareCacheKey(ctx, tenantId, access), row);
  return row;
}

/** Forgets a share token at once (revocation): the next request reads the database again. */
export function forgetShareToken(ctx: AppContext, shareTokenId: string): void {
  ctx.caches.shares.deleteWhere((share) => share.id === shareTokenId);
  // The public schedule carries the short links of the matches of the club: a revoked one goes at once.
  ctx.caches.schedule.clear();
}

export const targetOf = (share: ResolvedShareToken): Target =>
  share.clientFixtureId
    ? { kind: 'fixture', tenantId: share.tenantId, clientFixtureId: share.clientFixtureId }
    : share.matchId
      ? { kind: 'match', tenantId: share.tenantId, matchId: share.matchId }
      : { kind: 'live', tenantId: share.tenantId };

/**
 * Tells the clients of a link of a match of the calendar what it shows now (after a change of the `.dvw` linked to
 * it): read from the database, never from the memory of the hub.
 */
export async function announceFixture(ctx: AppContext, tenantId: string, clientFixtureId: string): Promise<void> {
  const target: Target = { kind: 'fixture', tenantId, clientFixtureId };
  const [row] = await ctx.db
    .select({ id: matches.id, version: matches.version, state: matches.state })
    .from(matches)
    .where(tenantScope(matches, tenantId, whereOf(target), sql`${matches.state} is not null`))
    .orderBy(desc(matches.live), sql`${matches.liveSince} desc nulls last`, desc(matches.updatedAt))
    .limit(1);
  const message: ServerMessage = row?.state
    ? { type: 'state', matchId: row.id, version: row.version, state: row.state }
    : ((await scheduledMessage(ctx.db, tenantId, clientFixtureId)) ?? { type: 'noMatch' });
  ctx.hub.retarget(tenantId, clientFixtureId, message);
}

/** Copies again the matches of the club of a client and tells the clients of the `.dvw` linked now. */
export async function refreshClub(ctx: AppContext, tenantId: string): Promise<void> {
  const linked = await refreshClientFixtures(ctx.db, ctx.config.shareCodeSecret, tenantId, ctx.now());
  ctx.hub.forgetScheduled(tenantId);
  ctx.caches.schedule.delete(tenantId);
  for (const l of linked) await announceFixture(ctx, l.tenantId, l.clientFixtureId);
}
