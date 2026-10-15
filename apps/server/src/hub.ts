import { gzipSync } from 'node:zlib';
import type { JsonValue, PatchMessage, ServerMessage, StateMessage } from '@sir/shared';
import { diffJson } from '@sir/shared';
import type { WebSocket } from 'ws';

/** What a client follows: a fixed match, or whichever match is live, always within one client (tenant). */
export type Target = { kind: 'match'; tenantId: string; matchId: string } | { kind: 'live'; tenantId: string };

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
}

interface Entry extends Subscriber {
  alive: boolean;
  /** Last state version sent to the client: a patch is sent only to a client that has its `baseVersion`. */
  last: { matchId: string; version: number } | null;
}

/** Where the ingest sends a new state; today the hub of this process, later a Postgres NOTIFY to every copy. */
export interface StatePublisher {
  publish(tenantId: string, message: StateMessage): void;
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
  /** Live match of each client, as last published. */
  private readonly liveMatch = new Map<string, string>();
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
    const matchId = target.kind === 'match' ? target.matchId : this.liveMatch.get(target.tenantId);
    const snap = matchId ? this.snapshots.get(matchId) : undefined;
    return snap && snap.tenantId === target.tenantId ? snap.message : null;
  }

  /**
   * Keeps a state read from the database (after a restart), unless a newer one was published meanwhile; `live`:
   * it is the live match of its client, unless another one was published meanwhile.
   * Known limit (not handled): after a restart, if two publishes of different matches of one client complete in
   * reverse order, the live match kept here is the older one until the next publish (same as the clients today).
   */
  remember(tenantId: string, message: StateMessage, live: boolean): void {
    const known = this.snapshots.get(message.matchId);
    if (!known || known.message.version < message.version) this.store(tenantId, message, JSON.stringify(message));
    if (live && !this.liveMatch.has(tenantId)) this.liveMatch.set(tenantId, message.matchId);
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

  /** The client lost track of the versions (`resync`): the next state is sent in full. */
  forget(socket: WebSocket): void {
    const entry = this.entries.get(socket);
    if (entry) entry.last = null;
  }

  /**
   * New state of `matchId`, which has just become the live match of the client `tenantId`. The patch from the
   * previous state is computed once; clients that have that state get the patch, the others the full state.
   */
  publish(tenantId: string, message: StateMessage): void {
    const previous = this.snapshots.get(message.matchId);
    if (previous && previous.message.version >= message.version) return;
    const text = JSON.stringify(message);
    const snap = this.store(tenantId, message, text);
    this.liveMatch.set(tenantId, message.matchId);
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
      const follows = entry.target.kind === 'live' || entry.target.matchId === message.matchId;
      if (follows) this.deliver(entry, message, snap.frame, patch);
    }
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
    if (message.type === 'noMatch' && entry.last) return;
    let frame = full;
    const compressible = message.type === 'state';
    if (message.type === 'state') {
      const last = entry.last;
      if (last && last.matchId === message.matchId && last.version >= message.version) return;
      if (patch && last && last.matchId === message.matchId && last.version === patch.baseVersion) frame = patch.frame;
      entry.last = { matchId: message.matchId, version: message.version };
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
