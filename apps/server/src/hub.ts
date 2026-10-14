import type { ServerMessage, StateMessage } from '@sir/shared';
import type { WebSocket } from 'ws';

/** What a client follows: a fixed match, or whichever match is live. */
export type Target = { kind: 'match'; matchId: string } | { kind: 'live' };

/** What lets a client stay connected: closed when it is revoked (or the session ends) and when it expires. */
export type Grant = { kind: 'share'; shareTokenId: string } | { kind: 'session'; sessionHash: string };

export interface Subscriber {
  socket: WebSocket;
  target: Target;
  grant: Grant;
  expiresAt: Date | null;
}

interface Entry extends Subscriber {
  alive: boolean;
  last: { matchId: string; version: number } | null;
}

/** Close code sent when the share token of a connected client is revoked or expires. */
export const CLOSE_TOKEN_GONE = 4404;
/** Close code sent to an admin client when its session ends (logout or expiry). */
export const CLOSE_SESSION_GONE = 4401;
/** A client with more than this many bytes still to send is too slow and is disconnected. */
export const MAX_BUFFERED_BYTES = 1024 * 1024;
/** Interval of ping and expiry checks: a revoked or expired grant is closed within this time. */
export const HEARTBEAT_MS = 30_000;

/** WebSocket clients and the push of state updates. */
export class LiveHub {
  private readonly entries = new Map<WebSocket, Entry>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  get size(): number {
    return this.entries.size;
  }

  add(sub: Subscriber): void {
    const entry: Entry = { ...sub, alive: true, last: null };
    this.entries.set(sub.socket, entry);
    sub.socket.on('pong', () => {
      entry.alive = true;
    });
    sub.socket.on('close', () => this.entries.delete(sub.socket));
  }

  /** Sends a message to one client; a state not newer than the last one sent for the same match is skipped. */
  send(socket: WebSocket, message: ServerMessage): void {
    const entry = this.entries.get(socket);
    if (!entry) return;
    this.deliver(entry, message, JSON.stringify(message));
  }

  /** New state of `matchId`, which has just become the live match. */
  publish(message: StateMessage): void {
    const text = JSON.stringify(message);
    for (const entry of this.entries.values()) {
      const follows = entry.target.kind === 'live' || entry.target.matchId === message.matchId;
      if (follows) this.deliver(entry, message, text);
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
  }

  private deliver(entry: Entry, message: ServerMessage, text: string): void {
    if (entry.expiresAt && entry.expiresAt <= this.now()) {
      this.drop(entry);
      return;
    }
    if (message.type === 'noMatch' && entry.last) return;
    if (message.type === 'state') {
      const last = entry.last;
      if (last && last.matchId === message.matchId && last.version >= message.version) return;
      entry.last = { matchId: message.matchId, version: message.version };
    }
    if (entry.socket.readyState !== entry.socket.OPEN) return;
    if (entry.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.kill(entry);
      return;
    }
    entry.socket.send(text);
  }

  private drop(entry: Entry): void {
    this.entries.delete(entry.socket);
    entry.socket.close(entry.grant.kind === 'share' ? CLOSE_TOKEN_GONE : CLOSE_SESSION_GONE);
  }

  /** Disconnects at once, without the close handshake (dead or too slow client). */
  private kill(entry: Entry): void {
    this.entries.delete(entry.socket);
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
