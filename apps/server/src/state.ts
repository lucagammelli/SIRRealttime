import type {
  ClubCoverage,
  ClubSide,
  MatchLogoInfo,
  ServerMessage,
  ShareAccess,
  StateMessage,
} from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import {
  ClientMessageSchema,
  effectiveStartsAt,
  LiveSocketQuerySchema,
  matchOurSide,
  matchTeamLogos,
} from '@arenalive/shared';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  broadcastOf,
  clubLook,
  comingFixtures,
  matchLogoInfo,
  refreshClientFixtures,
  scheduledMessage,
  upcomingOf,
} from './club.js';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext, ResolvedShareToken } from './context.js';
import { clientFixtures, matches, shareTokens, tenants } from './db/index.js';
import { romeDayAt } from './leagues/romeTime.js';
import type { FrameEncoding, Subscriber, Target } from './hub.js';
import { sameExtras } from './hub.js';
import { shortCodeLookupHash } from './lib/shortCode.js';
import { hashToken } from './lib/tokens.js';
import { tenantScope } from './tenancy.js';

const whereOf = (target: Exclude<Target, { kind: 'channel' }>) =>
  target.kind === 'live'
    ? eq(matches.live, true)
    : target.kind === 'match'
      ? eq(matches.id, target.matchId)
      : eq(matches.clientFixtureId, target.clientFixtureId);

/**
 * Logos and side of our team of a state for the public messages (`matchTeamLogos`, `matchOurSide`), cached 60 s by
 * client and match of the calendar. `fixedSide`: the side of our team chosen by the simulation (`matches.our_side`).
 */
export async function withLogos(
  ctx: AppContext,
  tenantId: string,
  message: StateMessage,
  clientFixtureId: string | null,
  fixedSide: ClubSide | null = null,
): Promise<StateMessage> {
  const key = `${tenantId}:${clientFixtureId ?? ''}`;
  let info: MatchLogoInfo | undefined = ctx.caches.logos.get(key);
  if (!info) {
    info = await matchLogoInfo(ctx.db, tenantId, clientFixtureId);
    ctx.caches.logos.set(key, info);
  }
  const { ourSide: _previous, ...rest } = message;
  const ourSide = matchOurSide(info, message.state.teams, fixedSide);
  return {
    ...rest,
    logos: matchTeamLogos(info, message.state.teams, fixedSide),
    ...(ourSide ? { ourSide } : {}),
  };
}

/**
 * After a save of the graphics of a client (`tenantConfigChanged`): the logos and the side of our team of the states
 * of its matches kept by the hub (the ones on screen: real and simulated, also paused or finished) are chosen again
 * and, when they changed, sent again to their clients with the next `version` of the match (written in the database
 * only if the match has not changed meanwhile). The lines, `seq` and `contentHash` of the match stay as they are and
 * nothing of the history is sent again; a second call with the same graphics sends nothing. Returns the states sent.
 */
export async function refreshMatchLogos(ctx: AppContext, tenantId: string): Promise<number> {
  const shown = ctx.hub.statesOf(tenantId);
  if (shown.length === 0) return 0;
  const rows = await ctx.db
    .select({
      id: matches.id,
      version: matches.version,
      clientFixtureId: matches.clientFixtureId,
      ourSide: matches.ourSide,
    })
    .from(matches)
    .where(
      tenantScope(
        matches,
        tenantId,
        inArray(
          matches.id,
          shown.map((m) => m.matchId),
        ),
      ),
    );
  let sent = 0;
  for (const message of shown) {
    const row = rows.find((r) => r.id === message.matchId);
    // Deleted, or a newer state is on its way (it gets the new logos by itself).
    if (row?.version !== message.version) continue;
    const fresh = await withLogos(ctx, tenantId, message, row.clientFixtureId, row.ourSide);
    if (sameExtras(fresh, message)) continue;
    const [bumped] = await ctx.db
      .update(matches)
      .set({ version: row.version + 1 })
      .where(and(eq(matches.id, row.id), eq(matches.version, row.version)))
      .returning({ version: matches.version });
    if (!bumped) continue;
    if (ctx.hub.republish(tenantId, { ...fresh, version: bumped.version })) sent++;
  }
  return sent;
}

/**
 * Pure: the `finishedAt` of a state message: when the match ended (`finished_at`; for a match finished before the
 * column existed, its last update), only while its state is `finished`.
 */
export function finishedAtField(
  state: Pick<MatchState, 'status'>,
  finishedAt: Date | null,
  updatedAt: Date,
): { finishedAt?: string } {
  return state.status === 'finished' ? { finishedAt: (finishedAt ?? updatedAt).toISOString() } : {};
}

/** A match being played that has sent nothing for this long no longer holds the channel (agent left on). */
export const CHANNEL_STALE_MS = 6 * 3_600_000;

/**
 * Pure: what the channel of a club shows. The last match while it is being played (live, not finished, updated in
 * the last CHANNEL_STALE_MS); otherwise the next broadcast match from the start of its day (Rome) on, or when there
 * is no last match; otherwise the last match (finished: it stays until the day of the next one); otherwise nothing.
 */
export function channelChoice(input: {
  latest: { live: boolean; finished: boolean; updatedAt: Date } | null;
  next: { startsAt: Date | null } | null;
  now: Date;
}): 'latest' | 'next' | 'none' {
  const { latest, next, now } = input;
  if (latest?.live && !latest.finished && now.getTime() - latest.updatedAt.getTime() < CHANNEL_STALE_MS)
    return 'latest';
  if (next && (!latest || (next.startsAt !== null && now >= romeDayAt(next.startsAt, 0).at))) return 'next';
  if (latest) return 'latest';
  return next ? 'next' : 'none';
}

/**
 * What the channel of a client shows (`channelChoice`), among the `.dvw` not linked to a match of the calendar (the
 * agent is sending them) and the ones linked to a broadcast match: read from the database, kept 45 s in the hub
 * (forgotten when a match starts or ends), with the newest state of the same match from the memory of the hub.
 * After 45 s the database is read again: a match that sends nothing for CHANNEL_STALE_MS leaves the channel.
 */
export async function channelMessage(ctx: AppContext, tenantId: string): Promise<ServerMessage> {
  const kept = ctx.hub.currentChannel(tenantId);
  if (kept) {
    if (kept.type !== 'state') return kept;
    const known = ctx.hub.current({ kind: 'match', tenantId, matchId: kept.matchId });
    return known && known.version > kept.version ? known : kept;
  }
  const now = ctx.now();
  const look = await clubLook(ctx.db, tenantId);
  const [row] = await ctx.db
    .select({
      id: matches.id,
      version: matches.version,
      state: matches.state,
      live: matches.live,
      clientFixtureId: matches.clientFixtureId,
      updatedAt: matches.updatedAt,
      finishedAt: matches.finishedAt,
    })
    .from(matches)
    .leftJoin(clientFixtures, eq(clientFixtures.id, matches.clientFixtureId))
    .where(
      tenantScope(
        matches,
        tenantId,
        sql`${matches.state} is not null`,
        // A simulated match is only for its own link.
        eq(matches.simulated, false),
        or(isNull(matches.clientFixtureId), broadcastSql(look.coverage)),
      ),
    )
    .orderBy(desc(matches.live), sql`${matches.liveSince} desc nulls last`, desc(matches.updatedAt))
    .limit(1);
  const coming = await comingFixtures(ctx.db, tenantId, now);
  const next = coming.rows.find((r) => !coming.live.has(r.id)) ?? null;
  const latest = row?.state ? { ...row, state: row.state } : null;
  const choice = channelChoice({
    latest: latest
      ? { live: latest.live, finished: latest.state.status === 'finished', updatedAt: latest.updatedAt }
      : null,
    next: next ? { startsAt: effectiveStartsAt(next) } : null,
    now,
  });
  let message: ServerMessage;
  if (choice === 'latest' && latest) {
    const state: StateMessage = {
      type: 'state',
      matchId: latest.id,
      version: latest.version,
      state: latest.state,
      ...finishedAtField(latest.state, latest.finishedAt, latest.updatedAt),
    };
    message = await withLogos(ctx, tenantId, state, latest.clientFixtureId);
    ctx.hub.remember(tenantId, message, latest.live, latest.clientFixtureId);
    ctx.hub.setChannelMatch(tenantId, latest.id);
  } else if (choice === 'next' && next) message = { type: 'scheduled', fixture: upcomingOf(next, coming.look) };
  else message = { type: 'noMatch' };
  ctx.hub.rememberChannel(tenantId, message);
  return message;
}

/**
 * Current message for a target: the state of the match (of the target's client), or `noMatch`; for a match of the
 * calendar, «Prossima partita» (`scheduled`) until a `.dvw` is linked to it, then that match (the live one, otherwise
 * the one live last). The live link shows the match that became live last. From the memory of the hub when it has it
 * (every state published by this process), otherwise from the database (then kept there).
 */
export async function currentMessage(ctx: AppContext, target: Target): Promise<ServerMessage> {
  if (target.kind === 'channel') return channelMessage(ctx, target.tenantId);
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
      simulated: matches.simulated,
      ourSide: matches.ourSide,
      updatedAt: matches.updatedAt,
      finishedAt: matches.finishedAt,
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
  const state: StateMessage = {
    type: 'state',
    matchId: row.id,
    version: row.version,
    state: row.state,
    ...(row.simulated ? { simulated: true as const } : {}),
    ...finishedAtField(row.state, row.finishedAt, row.updatedAt),
  };
  const message = await withLogos(ctx, target.tenantId, state, row.clientFixtureId, row.ourSide);
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
    const message = ClientMessageSchema.safeParse(value);
    if (!message.success) return;
    if (message.data.type === 'resync') resync.request();
    else if (sub.link && socket.readyState === socket.OPEN && ctx.hub.viewOf(socket) !== null) {
      // Only a socket the hub still holds (not revoked, expired or closing) opens a visit: its close would never come.
      // Statistics of the visits: the first `hello` of a public socket opens its visit (nothing else is read).
      const link = { tenantId: target.tenantId, ...sub.link };
      ctx.stats.connect(socket, link, message.data, () => ctx.hub.viewOf(socket));
      ctx.hub.onLeave(socket, (view) => ctx.stats.disconnect(socket, view));
    }
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
 * (looked up by sha256 of the token, by the keyed hash of the code), or null; valid ones are cached 30 s (emptied for
 * the client by `forgetClubCaches` when «Link e QR per singola partita» changes).
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
    .innerJoin(tenants, eq(tenants.id, shareTokens.tenantId))
    .leftJoin(matches, eq(matches.id, shareTokens.matchId))
    .where(
      tenantScope(
        shareTokens,
        tenantId,
        access.kind === 'token' ? eq(shareTokens.tokenHash, hash) : eq(shareTokens.shortCodeHash, hash),
        eq(shareTokens.revoked, false),
        or(isNull(shareTokens.expiresAt), gt(shareTokens.expiresAt, ctx.now())),
        // Without «Link e QR per singola partita» only the channel works (and the link of a simulation): a link of one
        // match left valid is not found, as a link that does not exist.
        or(
          eq(tenants.matchLinksEnabled, true),
          and(isNull(shareTokens.matchId), isNull(shareTokens.clientFixtureId)),
          eq(matches.simulated, true),
        ),
      ),
    )
    .limit(1);
  if (!row) return null;
  // The link of a match not broadcast (hidden, «Non trasmessa», away with «solo partite in casa») is not active.
  if (row.clientFixtureId && !(await fixtureBroadcast(ctx, tenantId, row.clientFixtureId))) return null;
  ctx.caches.shares.set(shareCacheKey(ctx, tenantId, access), row);
  return row;
}

/** SQL of `isFixtureBroadcast` on `client_fixtures` (joined), for the coverage of the client. */
function broadcastSql(coverage: ClubCoverage) {
  return and(
    eq(clientFixtures.hidden, false),
    or(
      eq(clientFixtures.broadcast, 'on'),
      and(
        eq(clientFixtures.broadcast, 'auto'),
        coverage === 'homeAndAway' ? undefined : eq(clientFixtures.ourSide, 'home'),
      ),
    ),
  );
}

/**
 * Whether the states of a `.dvw` go to the channel of its client: always without a match of the calendar, otherwise
 * only when that match is broadcast (cached 60 s, emptied with the caches of the club).
 */
export async function channelAllowed(
  ctx: AppContext,
  tenantId: string,
  clientFixtureId: string | null,
): Promise<boolean> {
  if (!clientFixtureId) return true;
  const key = `${tenantId}:${clientFixtureId}`;
  const cached = ctx.caches.broadcast.get(key);
  if (cached !== undefined) return cached;
  const allowed = await fixtureBroadcast(ctx, tenantId, clientFixtureId);
  ctx.caches.broadcast.set(key, allowed);
  return allowed;
}

/** Whether a match of the calendar of a client is broadcast now (false when it is not one of the client). */
export async function fixtureBroadcast(ctx: AppContext, tenantId: string, clientFixtureId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ ourSide: clientFixtures.ourSide, broadcast: clientFixtures.broadcast, hidden: clientFixtures.hidden })
    .from(clientFixtures)
    .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, clientFixtureId)))
    .limit(1);
  return row ? broadcastOf(row, (await clubLook(ctx.db, tenantId)).coverage) : false;
}

/** Forgets a share token at once (revocation): the next request reads the database again. */
export function forgetShareToken(ctx: AppContext, shareTokenId: string): void {
  ctx.caches.shares.deleteWhere((share) => share.id === shareTokenId);
  // The public schedule carries the short links of the matches of the club: a revoked one goes at once.
  ctx.caches.schedule.clear();
}

/** Links revoked (or deleted): forgotten at once by the caches and their spectators disconnected. */
export function dropShareLinks(ctx: AppContext, shareTokenIds: readonly string[]): void {
  for (const id of shareTokenIds) {
    forgetShareToken(ctx, id);
    ctx.hub.closeShareToken(id);
  }
}

/** Target of a public link: its match of the calendar, its match, otherwise the channel of the club (old live links too). */
export const targetOf = (share: ResolvedShareToken): Target =>
  share.clientFixtureId
    ? { kind: 'fixture', tenantId: share.tenantId, clientFixtureId: share.clientFixtureId }
    : share.matchId
      ? { kind: 'match', tenantId: share.tenantId, matchId: share.matchId }
      : { kind: 'channel', tenantId: share.tenantId };

/**
 * Tells the clients of a link of a match of the calendar what it shows now (after a change of the `.dvw` linked to
 * it): read from the database, never from the memory of the hub.
 */
export async function announceFixture(ctx: AppContext, tenantId: string, clientFixtureId: string): Promise<void> {
  const target: Target = { kind: 'fixture', tenantId, clientFixtureId };
  const [row] = await ctx.db
    .select({
      id: matches.id,
      version: matches.version,
      state: matches.state,
      updatedAt: matches.updatedAt,
      finishedAt: matches.finishedAt,
    })
    .from(matches)
    .where(tenantScope(matches, tenantId, whereOf(target), sql`${matches.state} is not null`))
    .orderBy(desc(matches.live), sql`${matches.liveSince} desc nulls last`, desc(matches.updatedAt))
    .limit(1);
  const message: ServerMessage = row?.state
    ? await withLogos(
        ctx,
        tenantId,
        {
          type: 'state',
          matchId: row.id,
          version: row.version,
          state: row.state,
          ...finishedAtField(row.state, row.finishedAt, row.updatedAt),
        },
        clientFixtureId,
      )
    : ((await scheduledMessage(ctx.db, tenantId, clientFixtureId)) ?? { type: 'noMatch' });
  ctx.hub.retarget(tenantId, clientFixtureId, message);
}

/** Copies again the matches of the club of a client and tells the clients of the `.dvw` linked now. */
export async function refreshClub(ctx: AppContext, tenantId: string): Promise<void> {
  const linked = await refreshClientFixtures(ctx.db, ctx.config.shareCodeSecret, tenantId, ctx.now());
  forgetClubCaches(ctx, tenantId);
  for (const l of linked) await announceFixture(ctx, l.tenantId, l.clientFixtureId);
}

/**
 * After a change of the calendar or of the profile of a club: «Prossima partita», the channel, the public schedule,
 * the logos and the valid links of the client are read again (a link may no longer be broadcast).
 */
export function forgetClubCaches(ctx: AppContext, tenantId: string): void {
  ctx.hub.forgetScheduled(tenantId);
  ctx.caches.schedule.delete(tenantId);
  ctx.caches.logos.clear();
  ctx.caches.broadcast.clear();
  ctx.caches.shares.deleteWhere((share) => share.tenantId === tenantId);
}

/** Every minute: the sockets of the channels see the next match after the end of the last one. */
export const CHANNEL_CHECK_MS = 60_000;

/** Checks the channels with sockets open every CHANNEL_CHECK_MS (`showChannel` sends only what changed). */
export class ChannelWatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
    private readonly everyMs = CHANNEL_CHECK_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const tenantId of this.ctx.hub.channelTenants()) {
        try {
          this.ctx.hub.showChannel(tenantId, await channelMessage(this.ctx, tenantId));
        } catch (err) {
          this.log.error({ err, tenantId }, 'canale del club non aggiornato');
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/** Disconnects the spectators of the links of the matches of a client that are no longer broadcast. */
export async function closeNotBroadcast(ctx: AppContext, tenantId: string): Promise<void> {
  const look = await clubLook(ctx.db, tenantId);
  const rows = await ctx.db
    .select({
      linkId: shareTokens.id,
      ourSide: clientFixtures.ourSide,
      broadcast: clientFixtures.broadcast,
      hidden: clientFixtures.hidden,
    })
    .from(shareTokens)
    .innerJoin(clientFixtures, eq(clientFixtures.id, shareTokens.clientFixtureId))
    .where(tenantScope(shareTokens, tenantId));
  for (const r of rows) if (!broadcastOf(r, look.coverage)) ctx.hub.closeShareToken(r.linkId);
}
