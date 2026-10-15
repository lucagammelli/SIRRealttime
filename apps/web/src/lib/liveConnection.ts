import type { ServerMessage } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import { looksLikeMatchState, parseServerMessage } from './messages.ts';

/** Close codes of the server (docs/server.md, WebSocket). */
export const CLOSE_LINK_INVALID = 4404;
export const CLOSE_SESSION_ENDED = 4401;

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'invalid' | 'unauthorized';

export type LiveData = { kind: 'state'; matchId: string; version: number; state: MatchState } | { kind: 'noMatch' };

export interface LiveSnapshot {
  status: ConnectionStatus;
  data: LiveData | null;
  /** Message of the last `error` frame, cleared by the next state. */
  error: string | null;
  /** Failed attempts since the last open connection. */
  attempts: number;
}

/** Minimal WebSocket surface used here: the browser one, or a fake in the tests. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number): void;
}
export type SocketFactory = (url: string) => SocketLike;

/** Answer of the HTTP check made when the socket closes before opening (the browser hides the 404/401 of the upgrade). */
export type ProbeResult = 'ok' | 'invalid' | 'unauthorized';

export interface LiveConnectionOptions {
  url: string;
  onChange: (snapshot: LiveSnapshot) => void;
  createSocket?: SocketFactory;
  probe?: () => Promise<ProbeResult>;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

/**
 * Applies a server message to what is shown. `null` = ignore the message: a state of the same match with a version
 * not newer than the one on screen (late or duplicated frame), or a state that is not readable.
 */
export function applyMessage(current: LiveData | null, message: ServerMessage): LiveData | null {
  if (message.type === 'noMatch') return { kind: 'noMatch' };
  if (message.type === 'error') return null;
  if (!looksLikeMatchState(message.state)) return null;
  if (current?.kind === 'state' && current.matchId === message.matchId && message.version <= current.version)
    return null;
  return { kind: 'state', matchId: message.matchId, version: message.version, state: message.state };
}

/** Delay before the attempt number `attempt` (1-based): doubles from `base` up to `max`, with ±20% jitter. */
export function backoffDelay(attempt: number, base: number, max: number, random: () => number = Math.random): number {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.8 + 0.4 * random()));
}

/**
 * WebSocket that stays connected: reconnects with backoff (never after 4404/4401), and on every (re)connection the
 * server sends the whole state again. Old versions are ignored (`applyMessage`).
 */
export class LiveConnection {
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** HTTP probe in flight: its answer decides the next step, nothing else may reconnect meanwhile. */
  private probing = false;
  private snapshot: LiveSnapshot = { status: 'connecting', data: null, error: null, attempts: 0 };
  private readonly createSocket: SocketFactory;
  private readonly base: number;
  private readonly max: number;
  private readonly random: () => number;

  constructor(private readonly options: LiveConnectionOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.base = options.baseDelayMs ?? 1000;
    this.max = options.maxDelayMs ?? 30_000;
    this.random = options.random ?? Math.random;
  }

  current(): LiveSnapshot {
    return this.snapshot;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Reconnects now (e.g. the browser is back online), unless the link is invalid. */
  retryNow(): void {
    if (this.stopped || this.probing || this.isFinal() || this.socket) return;
    this.clearTimer();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.dropSocket();
  }

  /** Detaches and closes the current socket, if any (never two sockets at once). */
  private dropSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onerror = null;
      s.onclose = null;
      s.close(1000);
    }
  }

  private isFinal(): boolean {
    return this.snapshot.status === 'invalid' || this.snapshot.status === 'unauthorized';
  }

  private update(patch: Partial<LiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.options.onChange(this.snapshot);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private connect(): void {
    this.dropSocket();
    let opened = false;
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      opened = true;
      this.update({ status: 'live', attempts: 0 });
    };
    socket.onmessage = (ev) => {
      const message = parseServerMessage(ev.data);
      if (!message) return;
      if (message.type === 'error') {
        this.update({ error: message.message });
        return;
      }
      const next = applyMessage(this.snapshot.data, message);
      if (next) this.update({ data: next, error: null, status: 'live' });
    };
    socket.onerror = () => {
      // Always followed by `close`, where the reconnection is decided.
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      if (ev.code === CLOSE_LINK_INVALID) return this.update({ status: 'invalid' });
      if (ev.code === CLOSE_SESSION_ENDED) return this.update({ status: 'unauthorized' });
      if ((!opened || ev.code === 1008) && this.options.probe) {
        this.probing = true;
        void this.options.probe().then(
          (result) => this.afterProbe(result),
          () => this.afterProbe('ok'),
        );
        return;
      }
      this.scheduleReconnect();
    };
  }

  private afterProbe(result: ProbeResult): void {
    this.probing = false;
    if (this.stopped) return;
    if (result === 'invalid') return this.update({ status: 'invalid' });
    if (result === 'unauthorized') return this.update({ status: 'unauthorized' });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const attempts = this.snapshot.attempts + 1;
    this.update({ status: 'reconnecting', attempts });
    this.clearTimer();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.stopped) this.connect();
      },
      backoffDelay(attempts, this.base, this.max, this.random),
    );
  }
}
