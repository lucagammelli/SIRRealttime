import { gzipSync } from 'node:zlib';
import type { JsonValue, PatchMessage, ScheduledMessage, ServerMessage, StateMessage } from '@sir/shared';
import { diffJson } from '@sir/shared';
import type { WebSocket } from 'ws';
import type { SocketView } from './stats/tracker.js';

/**
 * What a client follows, always within one client (tenant): a fixed match, the live match of the client (the one
 * that became live last: the admin page), the channel of the club (public links without a match: the live match,
 * otherwise «Prossima partita» of the next broadcast match, see `channelMessage`), or a match of the calendar of the
 * club (`clientFixtureId`: «Prossima partita» until a `.dvw` is linked to it, then that match).
 */
export type Target =
  | { kind: 'match'; tenantId: string; matchId: string }
  | { kind: 'live'; tenantId: string }
  | { kind: 'channel'; tenantId: string }
  | { kind: 'fixture'; tenantId: string; clientFixtureId: string };

/** What lets a client stay connected: closed when it is revoked (or the session ends) and when it expires. */
export type Grant = { kind: 'share'; shareTokenId: string } | { kind: 'session'; sessionHash: string };

/** `gzip`: the client asked binary frames with the gzip of the JSON (`?enc=gzip`); `text`: plain JSON frames. */
export type FrameEncoding = 'gzip' | 'text';

export interface Subscriber {
  socket: WebSocket;
  target: Target;
  grant: Grant;
  expiresAt: Date | null;
  encoding?: FrameEncoding;
  /** Client IP of a public socket (counted against the per-IP limit); null for admin sockets. */
  ip?: string | null;
  /** Public link of the socket (statistics of the visits); missing for admin sockets. */
  link?: { shareTokenId: string; clientFixtureId: string | null };
}

interface Entry extends Subscriber {
  alive: boolean;
  /** Last state version sent to the client: a patch is sent only to a client that has its `baseVersion`. */
  last: { matchId: string; version: number; simulated: boolean } | null;
  /** Channel: what `showChannel` sent last (a match or the next match), to send it only when it changes. */
  channelKey?: string;
  /** Called when the socket leaves the hub (closed, dropped or too slow), with what it was following. */
  onLeave?: (view: SocketView) => void;
}

/**
 * Where a published state goes besides the clients of its match: `clientFixtureId` the match of the calendar it is
 * linked to (null: none); `becameLive` it has just become live (the live link of the client moves to it).
 */
export interface PublishRoute {
  clientFixtureId: string | null;
  becameLive: boolean;
  /** false: linked to a match not broadcast, the channel of the club does not show it (missing: shown). */
  channel?: boolean;
  /**
   * true: a simulated match (`src/simulation/`), only for the clients of its own link: it never becomes the live match
   * nor the match of the channel, and it changes nothing of what the channel shows.
   */
  isolated?: boolean;
}

/** Without a route (older callers): not linked to the calendar, and the live match of the client. */
const DEFAULT_ROUTE: PublishRoute = { clientFixtureId: null, becameLive: true };

/** Where the ingest sends a new state; today the hub of this process, later a Postgres NOTIFY to every copy. */
export interface StatePublisher {
  publish(tenantId: string, message: StateMessage, route?: PublishRoute): void;
}

/** Close code sent when the share token of a connected client is revoked or expires. */
export const CLOSE_TOKEN_GONE = 4404;
/** Close code sent to an admin client when its session ends (logout or expiry). */
export const CLOSE_SESSION_GONE = 4401;
/** A client with more than this many bytes still to send is too slow and is disconnected. */
export const MAX_BUFFERED_BYTES = 1024 * 1024;
/** Interval of ping and expiry checks: a revoked or expired grant is closed within this time. */
export const HEARTBEAT_MS = 30_000;
/** A patch longer than this share of the full state is not worth it: the full state is sent instead. */
export const PATCH_MAX_RATIO = 0.5;
/** gzip level of the live frames: moderate, the frame is compressed once for every client. */
export const GZIP_LEVEL = 6;
/** Last published states kept in memory (one per match: patches, initial states and resyncs). */
export const SNAPSHOT_LIMIT = 64;
/**
 * «Prossima partita» of a match of the calendar is kept this long: the spectators who open the QR before the match
 * (thousands, with their reconnections and resyncs) do not read the database every time.
 */
export const SCHEDULED_TTL_MS = 45_000;
/** Most «Prossima partita» kept in memory (the oldest go first). */
export const SCHEDULED_LIMIT = 256;

/** A message serialized once and compressed at most once, whatever the number of clients. */
export class Frame {
  readonly bytes: Buffer;
  private gz: Buffer | null = null;
  constructor(readonly text: string) {
    this.bytes = Buffer.from(text, 'utf8');
  }
  gzip(): Buffer {
    this.gz ??= gzipSync(this.bytes, { level: GZIP_LEVEL });
    return this.gz;
  }
}

/** Last published state of a match, with its frame ready to send. */
interface Snapshot {
  tenantId: string;
  message: StateMessage;
  /** The state as the clients see it after `JSON.parse` (the base of the next patch). */
  state: JsonValue;
  frame: Frame;
}

/** WebSocket clients and the push of state updates (full state or patch, text or gzip). */
export class LiveHub implements StatePublisher {
  private readonly entries = new Map<WebSocket, Entry>();
  private readonly snapshots = new Map<string, Snapshot>();
  /** Live match of each client: the one that became live last. */
  private readonly liveMatch = new Map<string, string>();
  /** Match the channel of each client follows: the live one that became live last among the broadcast ones. */
  private readonly channelMatch = new Map<string, string>();
  /** Match linked to a match of the calendar, as last published (`clientFixtureId` → `matchId`). */
  private readonly fixtureMatch = new Map<string, string>();
  /** «Prossima partita» read from the database, by match of the calendar, with the time it was read. */
  private readonly scheduled = new Map<string, { tenantId: string; message: ScheduledMessage; at: number }>();
  /** What the channel of a client shows when no match is being played (read from the database), by client. */
  private readonly channel = new Map<string, { message: ServerMessage; at: number }>();
  private readonly perIp = new Map<string, number>();
  private publicCount = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Public sockets open in total and from `ip`. */
  publicSockets(ip: string): { total: number; fromIp: number } {
    return { total: this.publicCount, fromIp: this.perIp.get(ip) ?? 0 };
  }

  add(sub: Subscriber): void {
    const entry: Entry = { ...sub, alive: true, last: null };
    this.entries.set(sub.socket, entry);
    if (entry.ip !== undefined && entry.ip !== null) {
      this.publicCount++;
      this.perIp.set(entry.ip, (this.perIp.get(entry.ip) ?? 0) + 1);
    }
    sub.socket.on('pong', () => {
      entry.alive = true;
    });
    sub.socket.on('close', () => this.remove(entry));
  }

  /**
   * Current state of a target from memory (null: unknown here, read it from the database). A match of another
   * client is never returned.
   */
  current(target: Target): StateMessage | null {
    const matchId = this.matchOf(target);
    const snap = matchId ? this.snapshots.get(matchId) : undefined;
    return snap && snap.tenantId === target.tenantId ? snap.message : null;
  }

  /** «Prossima partita» of a match of the calendar kept here (at most SCHEDULED_TTL_MS old), or null. */
  currentScheduled(tenantId: string, clientFixtureId: string): ScheduledMessage | null {
    const kept = this.scheduled.get(clientFixtureId);
    if (!kept || kept.tenantId !== tenantId) return null;
    if (this.now().getTime() - kept.at >= SCHEDULED_TTL_MS) {
      this.scheduled.delete(clientFixtureId);
      return null;
    }
    return kept.message;
  }

  /** Keeps a «Prossima partita» read from the database (forgotten when a `.dvw` reaches that match of the calendar). */
  rememberScheduled(tenantId: string, clientFixtureId: string, message: ScheduledMessage): void {
    this.scheduled.delete(clientFixtureId);
    this.scheduled.set(clientFixtureId, { tenantId, message, at: this.now().getTime() });
    while (this.scheduled.size > SCHEDULED_LIMIT) {
      const oldest = this.scheduled.keys().next();
      if (oldest.done) break;
      this.scheduled.delete(oldest.value);
    }
  }

  /** Forgets the «Prossima partita» of a client (its calendar was copied again: times or venues may have changed). */
  forgetScheduled(tenantId: string): void {
    for (const [id, kept] of this.scheduled) if (kept.tenantId === tenantId) this.scheduled.delete(id);
    this.channel.delete(tenantId);
  }

  /** What the channel of a client shows, kept here at most SCHEDULED_TTL_MS (null: read it from the database). */
  currentChannel(tenantId: string): ServerMessage | null {
    const kept = this.channel.get(tenantId);
    if (!kept) return null;
    if (this.now().getTime() - kept.at >= SCHEDULED_TTL_MS) {
      this.channel.delete(tenantId);
      return null;
    }
    return kept.message;
  }

  rememberChannel(tenantId: string, message: ServerMessage): void {
    this.channel.delete(tenantId);
    this.channel.set(tenantId, { message, at: this.now().getTime() });
    while (this.channel.size > SCHEDULED_LIMIT) {
      const oldest = this.channel.keys().next();
      if (oldest.done) break;
      this.channel.delete(oldest.value);
    }
  }

  /** The channel of a client follows this match (chosen by `channelMessage` from the database). */
  setChannelMatch(tenantId: string, matchId: string): void {
    this.channelMatch.set(tenantId, matchId);
  }

  /** Clients with at least one socket on their channel (checked every minute by `ChannelWatcher`). */
  channelTenants(): Set<string> {
    const out = new Set<string>();
    for (const entry of this.entries.values()) if (entry.target.kind === 'channel') out.add(entry.target.tenantId);
    return out;
  }

  /**
   * What the channel of a client shows now (from `channelMessage`), sent to its sockets that show something else: the
   * next match after the end of the last one, or a match the socket does not show. Sent once per change.
   */
  showChannel(tenantId: string, message: ServerMessage): void {
    const key =
      message.type === 'state'
        ? `m:${message.matchId}`
        : message.type === 'scheduled'
          ? `f:${JSON.stringify(message.fixture)}`
          : message.type;
    for (const entry of this.entries.values()) {
      if (entry.target.kind !== 'channel' || entry.target.tenantId !== tenantId) continue;
      if (message.type === 'state') {
        if (entry.last?.matchId === message.matchId) continue;
      } else if (entry.channelKey === key && entry.last === null) continue;
      entry.last = null;
      entry.channelKey = key;
      this.send(entry.socket, message);
    }
  }

  /**
   * Keeps a state read from the database (after a restart), unless a newer one was published meanwhile; `live`:
   * it is the live match of its client, unless another one was published meanwhile.
   * Known limit (not handled): after a restart, if two publishes of different matches of one client complete in
   * reverse order, the live match kept here is the older one until the next publish (same as the clients today).
   */
  remember(tenantId: string, message: StateMessage, live: boolean, clientFixtureId: string | null = null): void {
    const known = this.snapshots.get(message.matchId);
    if (!known || known.message.version < message.version) this.store(tenantId, message, JSON.stringify(message));
    if (live && !this.liveMatch.has(tenantId)) this.liveMatch.set(tenantId, message.matchId);
    if (clientFixtureId && !this.fixtureMatch.has(clientFixtureId))
      this.fixtureMatch.set(clientFixtureId, message.matchId);
  }

  /** Sends a message to one client; a state not newer than the last one sent for the same match is skipped. */
  send(socket: WebSocket, message: ServerMessage): void {
    const entry = this.entries.get(socket);
    if (!entry) return;
    if (message.type === 'state') {
      const snap = this.snapshots.get(message.matchId);
      const same = snap && snap.message.version === message.version ? snap.frame : null;
      this.deliver(entry, message, same ?? new Frame(JSON.stringify(message)), null);
      return;
    }
    this.deliver(entry, message, new Frame(JSON.stringify(message)), null);
  }

  /** Match a socket is shown (null: the socket is not here, or no state was sent to it yet). */
  viewOf(socket: WebSocket): SocketView | null {
    const entry = this.entries.get(socket);
    return entry ? { matchId: entry.last?.matchId ?? null, simulated: entry.last?.simulated ?? false } : null;
  }

  /** `onLeave` is called once when the socket leaves the hub. */
  onLeave(socket: WebSocket, onLeave: (view: SocketView) => void): void {
    const entry = this.entries.get(socket);
    if (entry) entry.onLeave = onLeave;
  }

  /** The client lost track of the versions (`resync`): the next state is sent in full. */
  forget(socket: WebSocket): void {
    const entry = this.entries.get(socket);
    if (entry) entry.last = null;
  }

  /**
   * New state of `matchId` (a live match of the client `tenantId`), sent to the clients of that match, of its match of
   * the calendar (`route.clientFixtureId`) and, when it is the live match of the client, of the live link. The live
   * link moves to a match only when it has just become live (two matches live at the same time on two courts do not
   * take it from each other at every point). The patch from the previous state is computed once; clients that have
   * that state get the patch, the others the full state.
   */
  publish(tenantId: string, message: StateMessage, route: PublishRoute = DEFAULT_ROUTE): void {
    const previous = this.snapshots.get(message.matchId);
    if (previous && previous.message.version >= message.version) return;
    const text = JSON.stringify(message);
    const snap = this.store(tenantId, message, text);
    if (!route.isolated) {
      if (route.becameLive || !this.liveMatch.has(tenantId)) this.liveMatch.set(tenantId, message.matchId);
      if (route.channel !== false && (route.becameLive || !this.channelMatch.has(tenantId)))
        this.channelMatch.set(tenantId, message.matchId);
      // A match that starts or ends changes what the channel shows when nothing is played.
      if (route.becameLive || message.state.status === 'finished') this.channel.delete(tenantId);
    }
    if (route.clientFixtureId) {
      this.fixtureMatch.set(route.clientFixtureId, message.matchId);
      this.scheduled.delete(route.clientFixtureId);
    }
    let patch: { baseVersion: number; frame: Frame } | null = null;
    if (previous && previous.tenantId === tenantId) {
      const ops = diffJson(previous.state, snap.state);
      const body: PatchMessage = {
        type: 'patch',
        matchId: message.matchId,
        baseVersion: previous.message.version,
        version: message.version,
        ops,
      };
      const patchText = JSON.stringify(body);
      if (patchText.length <= text.length * PATCH_MAX_RATIO) {
        patch = { baseVersion: previous.message.version, frame: new Frame(patchText) };
      }
    }
    for (const entry of this.entries.values()) {
      if (entry.target.tenantId !== tenantId) continue;
      if (entry.target.kind === 'channel' && route.channel === false) continue;
      if (route.isolated && entry.target.kind !== 'match') continue;
      if (this.matchOf(entry.target) === message.matchId) this.deliver(entry, message, snap.frame, patch);
    }
  }

  /**
   * The admin changed the match of the calendar of a `.dvw` (or took it away): the clients of that match of the
   * calendar get `message` at once (the state of the match now linked, or «Prossima partita» again).
   */
  retarget(tenantId: string, clientFixtureId: string, message: ServerMessage): void {
    this.scheduled.delete(clientFixtureId);
    if (message.type === 'state') {
      this.remember(tenantId, message, false);
      this.fixtureMatch.set(clientFixtureId, message.matchId);
    } else this.fixtureMatch.delete(clientFixtureId);
    for (const entry of this.entries.values()) {
      if (entry.target.kind !== 'fixture' || entry.target.tenantId !== tenantId) continue;
      if (entry.target.clientFixtureId !== clientFixtureId) continue;
      entry.last = null;
      this.send(entry.socket, message);
    }
  }

  /** Match a target follows now, as known here (null: unknown, read it from the database). */
  private matchOf(target: Target): string | null {
    if (target.kind === 'match') return target.matchId;
    if (target.kind === 'live') return this.liveMatch.get(target.tenantId) ?? null;
    if (target.kind === 'channel') return this.channelMatch.get(target.tenantId) ?? null;
    return this.fixtureMatch.get(target.clientFixtureId) ?? null;
  }

  /** Forgets the last state of a match (deleted): its clients are closed with its link (`closeShareToken`). */
  forgetMatch(matchId: string): void {
    this.snapshots.delete(matchId);
  }

  /** Closes the clients connected with a share token (revocation). */
  closeShareToken(shareTokenId: string): void {
    for (const entry of this.entries.values()) {
      if (entry.grant.kind === 'share' && entry.grant.shareTokenId === shareTokenId) this.drop(entry);
    }
  }

  /** Closes the admin clients of a session (logout); `sessionHash` is the hash of the session token. */
  closeSession(sessionHash: string): void {
    for (const entry of this.entries.values()) {
      if (entry.grant.kind === 'session' && entry.grant.sessionHash === sessionHash) this.drop(entry);
    }
  }

  closeAll(): void {
    clearInterval(this.timer);
    for (const entry of this.entries.values()) entry.socket.close(1001);
    this.entries.clear();
    this.perIp.clear();
    this.publicCount = 0;
  }

  private store(tenantId: string, message: StateMessage, text: string): Snapshot {
    const parsed = JSON.parse(text) as { state: JsonValue };
    const snap: Snapshot = { tenantId, message, state: parsed.state, frame: new Frame(text) };
    this.snapshots.delete(message.matchId);
    this.snapshots.set(message.matchId, snap);
    while (this.snapshots.size > SNAPSHOT_LIMIT) {
      const oldest = this.snapshots.keys().next();
      if (oldest.done) break;
      this.snapshots.delete(oldest.value);
    }
    return snap;
  }

  private deliver(
    entry: Entry,
    message: ServerMessage,
    full: Frame,
    patch: { baseVersion: number; frame: Frame } | null,
  ): void {
    if (entry.expiresAt && entry.expiresAt <= this.now()) {
      this.drop(entry);
      return;
    }
    if ((message.type === 'noMatch' || message.type === 'scheduled') && entry.last) return;
    let frame = full;
    const compressible = message.type === 'state';
    if (message.type === 'state') {
      const last = entry.last;
      if (last && last.matchId === message.matchId && last.version >= message.version) return;
      if (patch && last && last.matchId === message.matchId && last.version === patch.baseVersion) frame = patch.frame;
      entry.last = { matchId: message.matchId, version: message.version, simulated: message.simulated === true };
    }
    if (entry.socket.readyState !== entry.socket.OPEN) return;
    if (entry.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.kill(entry);
      return;
    }
    if (compressible && entry.encoding === 'gzip') entry.socket.send(frame.gzip(), { binary: true });
    else entry.socket.send(frame.bytes, { binary: false });
  }

  private remove(entry: Entry): void {
    if (this.entries.get(entry.socket) !== entry) return;
    this.entries.delete(entry.socket);
    entry.onLeave?.({ matchId: entry.last?.matchId ?? null, simulated: entry.last?.simulated ?? false });
    if (entry.ip !== undefined && entry.ip !== null) {
      this.publicCount--;
      const left = (this.perIp.get(entry.ip) ?? 1) - 1;
      if (left > 0) this.perIp.set(entry.ip, left);
      else this.perIp.delete(entry.ip);
    }
  }

  private drop(entry: Entry): void {
    this.remove(entry);
    entry.socket.close(entry.grant.kind === 'share' ? CLOSE_TOKEN_GONE : CLOSE_SESSION_GONE);
  }

  /** Disconnects at once, without the close handshake (dead or too slow client). */
  private kill(entry: Entry): void {
    this.remove(entry);
    entry.socket.terminate();
  }

  private heartbeat(): void {
    for (const entry of this.entries.values()) {
      if (entry.expiresAt && entry.expiresAt <= this.now()) {
        this.drop(entry);
      } else if (!entry.alive || entry.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        this.kill(entry);
      } else {
        entry.alive = false;
        entry.socket.ping();
      }
    }
  }
}
