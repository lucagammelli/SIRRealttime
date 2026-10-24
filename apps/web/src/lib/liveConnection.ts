import type {
  ClubSide,
  JsonValue,
  PatchMessage,
  ServerMessage,
  TeamLogoPair,
  UpcomingFixture,
} from '@arenalive/shared';
import { applyPatch } from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import { gunzipFrame, supportsGzip, withGzip } from './frames.ts';
import { looksLikeMatchState, parseServerMessage } from './messages.ts';

/** Close codes of the server (docs/server.md, WebSocket). */
export const CLOSE_LINK_INVALID = 4404;
export const CLOSE_SESSION_ENDED = 4401;

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'invalid' | 'unauthorized';

export type LiveData =
  | {
      kind: 'state';
      matchId: string;
      version: number;
      state: MatchState;
      /**
       * True when the state is a live update (a patch, or a full state sent after an update); missing for the first
       * state of a connection and the answer to a `resync`, which only bring the match up to date (no overlays).
       */
      live?: boolean;
      /** Logos of the two sides, as chosen by the server («Loghi delle squadre»); missing: none. */
      logos?: TeamLogoPair;
      /** Side of our team as chosen by the server with the logos (e.g. the simulation); missing: unknown. */
      ourSide?: ClubSide;
      /** A match of the simulation of the server: the page shows «Simulazione». */
      simulated?: boolean;
      /** When the match ended (ISO UTC), while it is finished: «Dopo la partita» starts from it. */
      finishedAt?: string;
    }
  | { kind: 'noMatch' }
  /** Link of a match of the calendar before its start: «Prossima partita». */
  | { kind: 'scheduled'; fixture: UpcomingFixture };

export interface LiveSnapshot {
  status: ConnectionStatus;
  data: LiveData | null;
  /** Message of the last `error` frame, cleared by the next state. */
  error: string | null;
  /** Failed attempts since the last open connection. */
  attempts: number;
  /** The server answered that it is full (503): the next attempt waits its Retry-After. */
  serverFull?: boolean;
}

/** Minimal WebSocket surface used here: the browser one, or a fake in the tests. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  /** Set to `arraybuffer` for the gzip frames. */
  binaryType?: string;
  send(data: string): void;
  close(code?: number): void;
}
export type SocketFactory = (url: string) => SocketLike;

/**
 * Answer of the HTTP check made when the socket closes before opening (the browser hides the 404/401/503 of the
 * upgrade); `retryAfterMs`: the server is full or limiting, wait at least that long.
 */
export type ProbeResult = 'ok' | 'invalid' | 'unauthorized' | { retryAfterMs: number };

export interface LiveConnectionOptions {
  url: string;
  onChange: (snapshot: LiveSnapshot) => void;
  createSocket?: SocketFactory;
  probe?: () => Promise<ProbeResult>;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Extra random wait, up to this, before reconnecting after an open connection dropped (server restart or crash:
   * every client is dropped at once, so they spread out): default 5 s.
   */
  restartSpreadMs?: number;
  random?: () => number;
  /** Ask gzip frames (`enc=gzip`); default: when the browser has `DecompressionStream`. */
  gzip?: boolean;
  /**
   * `resync` sent again when its full state has not arrived within this time: default 8 s (the server answers at
   * most every 5 s per socket).
   */
  resyncRetryMs?: number;
  /**
   * Message sent once at every open of the socket (public page: the `hello` of the statistics of the visits, see
   * `lib/visit.ts`); missing or null: nothing is sent.
   */
  hello?: () => string | null;
  /**
   * The graphics of the client may have changed: `changed` the server sent `config` (a save in the reserved area),
   * `reconnected` the socket opened again after a drop (a `config` may have been lost meanwhile).
   */
  onConfig?: (reason: 'changed' | 'reconnected') => void;
}

/** Close codes of a server that stopped, restarted or crashed: every client reconnects, so they spread out. */
const RESTART_CODES = new Set([1001, 1006, 1012, 1013]);

/**
 * Applies a server message to what is shown. `null` = ignore the message: a state of the same match with a version
 * not newer than the one on screen (late or duplicated frame), or a state that is not readable.
 */
export function applyMessage(current: LiveData | null, message: ServerMessage): LiveData | null {
  if (message.type === 'noMatch') return { kind: 'noMatch' };
  if (message.type === 'scheduled') return { kind: 'scheduled', fixture: message.fixture };
  if (message.type === 'error' || message.type === 'patch' || message.type === 'config') return null;
  if (!looksLikeMatchState(message.state)) return null;
  if (current?.kind === 'state' && current.matchId === message.matchId && message.version <= current.version)
    return null;
  return {
    kind: 'state',
    matchId: message.matchId,
    version: message.version,
    state: message.state,
    ...(message.logos ? { logos: message.logos } : {}),
    ...(message.ourSide ? { ourSide: message.ourSide } : {}),
    ...(message.simulated ? { simulated: true } : {}),
    ...(message.finishedAt ? { finishedAt: message.finishedAt } : {}),
  };
}

/**
 * Applies a patch to what is shown: the new data, `null` to ignore it (old version or another match), `'resync'`
 * when it does not fit the version shown (a step was lost) or cannot be applied: the full state is needed.
 */
export function applyPatchMessage(current: LiveData | null, message: PatchMessage): LiveData | null | 'resync' {
  if (current?.kind !== 'state' || current.matchId !== message.matchId) return 'resync';
  if (message.version <= current.version) return null;
  if (message.baseVersion !== current.version) return 'resync';
  let next: JsonValue;
  try {
    next = applyPatch(current.state as unknown as JsonValue, message.ops);
  } catch {
    return 'resync';
  }
  if (!looksLikeMatchState(next)) return 'resync';
  // A patch changes only the state: the logos, the side of our team (and the end of the match, which the server sends with a full state
  // when it changes) stay those of the full state it applies to.
  return {
    kind: 'state',
    matchId: message.matchId,
    version: message.version,
    state: next,
    ...(current.logos ? { logos: current.logos } : {}),
    ...(current.ourSide ? { ourSide: current.ourSide } : {}),
    ...(current.simulated ? { simulated: true } : {}),
    ...(current.finishedAt && next.status === 'finished' ? { finishedAt: current.finishedAt } : {}),
  };
}

/**
 * Delay before the attempt number `attempt` (1-based): doubles from `base` up to `max`, with ±50% jitter from the
 * first attempt on (clients dropped together do not come back together).
 */
export function backoffDelay(attempt: number, base: number, max: number, random: () => number = Math.random): number {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.5 + random()));
}

/**
 * WebSocket that stays connected: reconnects with backoff (never after 4404/4401), and on every (re)connection the
 * server sends the whole state again. Old versions are ignored (`applyMessage`); a patch is applied only to its
 * `baseVersion`, otherwise the client sends `resync` and waits for the full state. With `gzip` the server sends
 * binary frames, decompressed here in order (`gunzipFrame`, size capped).
 */
export class LiveConnection {
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** HTTP probe in flight: its answer decides the next step, nothing else may reconnect meanwhile. */
  private probing = false;
  /** A socket of this connection opened at least once: the next open is a reconnection. */
  private everOpened = false;
  private snapshot: LiveSnapshot = { status: 'connecting', data: null, error: null, attempts: 0 };
  private readonly createSocket: SocketFactory;
  private readonly base: number;
  private readonly max: number;
  private readonly restartSpread: number;
  private readonly random: () => number;
  private readonly url: string;
  private readonly gzip: boolean;
  private readonly resyncRetry: number;
  /** Timer that repeats a `resync` still unanswered. */
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: LiveConnectionOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.base = options.baseDelayMs ?? 1000;
    this.max = options.maxDelayMs ?? 30_000;
    this.restartSpread = options.restartSpreadMs ?? 5000;
    this.random = options.random ?? Math.random;
    this.gzip = options.gzip ?? supportsGzip();
    this.url = this.gzip ? withGzip(options.url) : options.url;
    this.resyncRetry = options.resyncRetryMs ?? 8000;
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
    this.clearResyncTimer();
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

  private clearResyncTimer(): void {
    if (this.resyncTimer !== null) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
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
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    if (this.gzip) socket.binaryType = 'arraybuffer';
    /** Frames are handled in order: a text frame waits for the binary ones still being decompressed. */
    let queue: Promise<void> = Promise.resolve();
    let pending = 0;
    /** A `resync` was sent and its full state has not arrived yet. */
    let resyncing = false;
    /** The first full state of this socket has arrived: the next states are live updates. */
    let synced = false;
    /** Sends `resync`, and again every `resyncRetry` until a full state arrives. */
    const askResync = (): void => {
      resyncing = true;
      socket.send(JSON.stringify({ type: 'resync' }));
      this.clearResyncTimer();
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = null;
        if (this.socket === socket && resyncing) askResync();
      }, this.resyncRetry);
    };
    const handle = (text: unknown): void => {
      if (this.socket !== socket) return;
      const message = parseServerMessage(text);
      if (!message) return;
      if (message.type === 'error') {
        this.update({ error: message.message });
        return;
      }
      if (message.type === 'config') {
        this.options.onConfig?.('changed');
        return;
      }
      if (message.type === 'patch') {
        if (resyncing) return;
        const next = applyPatchMessage(this.snapshot.data, message);
        if (next === 'resync') askResync();
        else if (next?.kind === 'state') this.update({ data: { ...next, live: true }, error: null, status: 'live' });
        return;
      }
      let live = false;
      if (message.type === 'state') {
        live = synced && !resyncing;
        synced = true;
        resyncing = false;
        this.clearResyncTimer();
      }
      const next = applyMessage(this.snapshot.data, message);
      if (next)
        this.update({ data: next.kind === 'state' && live ? { ...next, live } : next, error: null, status: 'live' });
    };
    socket.onopen = () => {
      opened = true;
      if (this.everOpened) this.options.onConfig?.('reconnected');
      this.everOpened = true;
      const hello = this.options.hello?.();
      if (hello) socket.send(hello);
      this.update({ status: 'live', attempts: 0, serverFull: false });
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data === 'string' && pending === 0) {
        handle(ev.data);
        return;
      }
      pending++;
      const data = ev.data;
      queue = queue
        .then(async () => handle(typeof data === 'string' ? data : await gunzipFrame(data)))
        .finally(() => {
          pending--;
        });
    };
    socket.onerror = () => {
      // Always followed by `close`, where the reconnection is decided.
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearResyncTimer();
      if (this.stopped) return;
      if (ev.code === CLOSE_LINK_INVALID) return this.update({ status: 'invalid' });
      if (ev.code === CLOSE_SESSION_ENDED) return this.update({ status: 'unauthorized' });
      if (opened && RESTART_CODES.has(ev.code)) {
        this.scheduleReconnect(this.random() * this.restartSpread);
        return;
      }
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
    if (typeof result === 'object') {
      // Server full: wait its Retry-After plus up to half of it, so that the clients do not return together.
      this.scheduleReconnect(result.retryAfterMs * (1 + 0.5 * this.random()), true);
      return;
    }
    this.scheduleReconnect();
  }

  /** Next attempt after the backoff, or after `atLeastMs` (plus the backoff jitter) when that is longer. */
  private scheduleReconnect(atLeastMs = 0, serverFull = false): void {
    if (this.stopped) return;
    const attempts = this.snapshot.attempts + 1;
    this.update({ status: 'reconnecting', attempts, serverFull });
    this.clearTimer();
    const backoff = backoffDelay(attempts, this.base, this.max, this.random);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.stopped) this.connect();
      },
      Math.max(backoff, Math.round(atLeastMs)),
    );
  }
}
