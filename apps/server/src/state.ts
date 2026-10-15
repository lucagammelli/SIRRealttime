import type { ServerMessage } from '@sir/shared';
import { ClientMessageSchema, LiveSocketQuerySchema } from '@sir/shared';
import { eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext, ResolvedShareToken } from './context.js';
import { matches, shareTokens } from './db/index.js';
import type { FrameEncoding, Subscriber, Target } from './hub.js';
import { hashToken } from './lib/tokens.js';
import { tenantScope } from './tenancy.js';

/**
 * Current message for a target: the state of the match (of the target's client), or `noMatch`. From the memory of
 * the hub when it has it (every state published by this process), otherwise from the database (then kept there).
 */
export async function currentMessage(ctx: AppContext, target: Target): Promise<ServerMessage> {
  const known = ctx.hub.current(target);
  if (known) return known;
  const where = target.kind === 'live' ? eq(matches.live, true) : eq(matches.id, target.matchId);
  const [row] = await ctx.db
    .select({ id: matches.id, version: matches.version, state: matches.state, live: matches.live })
    .from(matches)
    .where(tenantScope(matches, target.tenantId, where))
    .limit(1);
  if (!row?.state) return { type: 'noMatch' };
  const message = { type: 'state', matchId: row.id, version: row.version, state: row.state } as const;
  ctx.hub.remember(target.tenantId, message, row.live);
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

/** Valid (not revoked, not expired) share token of the client `tenantId`, or null; valid ones are cached 30 s. */
export async function resolveShareToken(
  ctx: AppContext,
  tenantId: string,
  token: string,
): Promise<ResolvedShareToken | null> {
  const key = `${tenantId}:${hashToken(token)}`;
  const cached = ctx.caches.shares.get(key);
  if (cached) {
    if (!cached.expiresAt || cached.expiresAt > ctx.now()) return cached;
    ctx.caches.shares.delete(key);
    return null;
  }
  const [row] = await ctx.db
    .select({
      id: shareTokens.id,
      tenantId: shareTokens.tenantId,
      matchId: shareTokens.matchId,
      expiresAt: shareTokens.expiresAt,
    })
    .from(shareTokens)
    .where(
      tenantScope(
        shareTokens,
        tenantId,
        eq(shareTokens.tokenHash, hashToken(token)),
        eq(shareTokens.revoked, false),
        or(isNull(shareTokens.expiresAt), gt(shareTokens.expiresAt, ctx.now())),
      ),
    )
    .limit(1);
  if (!row) return null;
  ctx.caches.shares.set(key, row);
  return row;
}

/** Forgets a share token at once (revocation): the next request reads the database again. */
export function forgetShareToken(ctx: AppContext, shareTokenId: string): void {
  ctx.caches.shares.deleteWhere((share) => share.id === shareTokenId);
}

export const targetOf = (share: ResolvedShareToken): Target =>
  share.matchId
    ? { kind: 'match', tenantId: share.tenantId, matchId: share.matchId }
    : { kind: 'live', tenantId: share.tenantId };
