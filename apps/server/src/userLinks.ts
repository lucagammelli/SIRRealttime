import type { InviteDelivery } from '@sir/shared';
import { DEFAULT_BRAND_NAME, INVITE_TTL_HOURS, publicAssetPath, resolveBranding, RESET_TTL_HOURS } from '@sir/shared';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { AppContext } from './context.js';
import { userTokens, users } from './db/index.js';
import { generateToken, hashToken } from './lib/tokens.js';
import type { MailBrand } from './mail/templates.js';
import { inviteMail } from './mail/templates.js';
import type { Tx } from './matchLock.js';
import { findTenant, tenantDisplayName } from './tenancy.js';

/**
 * One-time links of the users (`user_tokens`): an invitation to choose the first password (72 h) and the reset of a
 * password (1 h). Only the sha256 of the token is stored; a new link of the same kind replaces the old one; links are
 * built only from PUBLIC_BASE_URL, never from the `Host` header.
 */

export type LinkKind = 'invite' | 'reset';
const TTL_MS: Record<LinkKind, number> = { invite: INVITE_TTL_HOURS * 3_600_000, reset: RESET_TTL_HOURS * 3_600_000 };
const PATH: Record<LinkKind, string> = { invite: '/admin/invito/', reset: '/admin/reimposta-password/' };

/** Pure: the link of a token. */
export function linkUrl(publicBaseUrl: string, kind: LinkKind, token: string): string {
  return `${publicBaseUrl}${PATH[kind]}${token}`;
}

/** New link for the user (the previous one of the same kind stops working); returns the token in clear, once. */
export async function issueLink(
  tx: Tx,
  userId: string,
  kind: LinkKind,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + TTL_MS[kind]);
  const tokenHash = hashToken(token);
  await tx
    .insert(userTokens)
    .values({ userId, kind, tokenHash, expiresAt })
    .onConflictDoUpdate({
      target: [userTokens.userId, userTokens.kind],
      set: { tokenHash, expiresAt, createdAt: now },
    });
  return { token, expiresAt };
}

/** Link of a kind that is still valid for this token, with its user; null otherwise. Does not use it up. */
export async function findLink(ctx: AppContext, token: string, kind: LinkKind | null, now: Date) {
  const hash = hashToken(token);
  const [row] = await ctx.db
    .select({
      userId: userTokens.userId,
      kind: userTokens.kind,
      expiresAt: userTokens.expiresAt,
      email: users.email,
      tenantId: users.tenantId,
      disabled: users.disabled,
    })
    .from(userTokens)
    .innerJoin(users, eq(users.id, userTokens.userId))
    .where(and(eq(userTokens.tokenHash, hash), gt(userTokens.expiresAt, now)))
    .limit(1);
  if (!row || row.disabled || (kind !== null && row.kind !== kind)) return null;
  return row;
}

/**
 * Uses the link up: deletes it and returns the user it belonged to; null when it does not exist, has expired or was
 * already used (the delete is the only step, so two requests cannot both succeed).
 */
export async function consumeLink(tx: Tx, token: string, kind: LinkKind, now: Date): Promise<string | null> {
  const [row] = await tx
    .delete(userTokens)
    .where(
      and(
        eq(userTokens.tokenHash, hashToken(token)),
        eq(userTokens.kind, kind),
        gt(userTokens.expiresAt, now),
        // A disabled user cannot use a link (and the link is left as it is).
        inArray(userTokens.userId, tx.select({ id: users.id }).from(users).where(eq(users.disabled, false))),
      ),
    )
    .returning({ userId: userTokens.userId });
  return row?.userId ?? null;
}

/** Invitation state of the given users: users without an unused invitation are not in the map. */
export async function inviteStates(
  ctx: AppContext,
  userIds: readonly string[],
  now: Date,
): Promise<Map<string, 'pending' | 'expired'>> {
  if (userIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ userId: userTokens.userId, expiresAt: userTokens.expiresAt })
    .from(userTokens)
    .where(and(inArray(userTokens.userId, [...userIds]), eq(userTokens.kind, 'invite')))
    .orderBy(desc(userTokens.createdAt));
  return new Map(rows.map((r) => [r.userId, r.expiresAt > now ? 'pending' : 'expired']));
}

/** True when the user has an invitation not used yet (valid or expired): it cannot log in with a password. */
export async function hasOpenInvite(ctx: AppContext, userId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: userTokens.id })
    .from(userTokens)
    .where(and(eq(userTokens.userId, userId), eq(userTokens.kind, 'invite')))
    .limit(1);
  return row !== undefined;
}

/** Name and logo of a client for the mails (the portal name without a client). */
export async function mailBrand(ctx: AppContext, tenantId: string | null): Promise<MailBrand> {
  const tenant = tenantId ? await findTenant(ctx, { id: tenantId }) : null;
  if (!tenant) return { name: DEFAULT_BRAND_NAME, logoUrl: null };
  const branding = resolveBranding(tenant.branding);
  const logo = branding.logoMain ?? branding.logoMark;
  return {
    name: tenantDisplayName(tenant, branding),
    logoUrl: logo ? `${ctx.config.publicBaseUrl}${publicAssetPath(logo)}` : null,
  };
}

/**
 * Sends the invitation of a user whose link was just issued. Without a mail server (or if it refuses the mail) the
 * link is given back to be copied; once sent by mail it is not given back.
 */
export async function deliverInvite(
  ctx: AppContext,
  user: { email: string; tenantId: string | null },
  issued: { token: string; expiresAt: Date },
): Promise<InviteDelivery> {
  const link = linkUrl(ctx.config.publicBaseUrl, 'invite', issued.token);
  const mail = await ctx.mail.send(user.email, inviteMail(await mailBrand(ctx, user.tenantId), link));
  return { mail, link: mail === 'sent' ? null : link, expiresAt: issued.expiresAt.toISOString() };
}
