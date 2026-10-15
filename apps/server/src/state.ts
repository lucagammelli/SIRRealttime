import type { ServerMessage } from '@sir/shared';
import { eq, gt, isNull, or } from 'drizzle-orm';
import type { AppContext, ResolvedShareToken } from './context.js';
import { matches, shareTokens } from './db/index.js';
import type { Target } from './hub.js';
import { hashToken } from './lib/tokens.js';
import { tenantScope } from './tenancy.js';

/** Current message for a target: the state of the match (of the target's client), or `noMatch`. */
export async function currentMessage(ctx: AppContext, target: Target): Promise<ServerMessage> {
  const where = target.kind === 'live' ? eq(matches.live, true) : eq(matches.id, target.matchId);
  const [row] = await ctx.db
    .select({ id: matches.id, version: matches.version, state: matches.state })
    .from(matches)
    .where(tenantScope(matches, target.tenantId, where))
    .limit(1);
  if (!row?.state) return { type: 'noMatch' };
  return { type: 'state', matchId: row.id, version: row.version, state: row.state };
}

/** Valid (not revoked, not expired) share token of the client `tenantId`, or null. */
export async function resolveShareToken(
  ctx: AppContext,
  tenantId: string,
  token: string,
): Promise<ResolvedShareToken | null> {
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
  return row ?? null;
}

export const targetOf = (share: ResolvedShareToken): Target =>
  share.matchId
    ? { kind: 'match', tenantId: share.tenantId, matchId: share.matchId }
    : { kind: 'live', tenantId: share.tenantId };
