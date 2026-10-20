import { randomUUID } from 'node:crypto';
import type { HelloMessage, VisitDevice, VisitSource } from '@arenalive/shared';
import { romeDay } from './days.js';

/** A reconnection within this time with the same visit id is the same visit. */
export const RECONNECT_GRACE_MS = 30_000;
/** A visit shorter than this is not recorded (a page opened and closed at once says nothing). */
export const MIN_VISIT_MS = 3_000;
/** Finished visits waiting for the database (past it the oldest are dropped: the database is down for too long). */
export const BUFFER_LIMIT = 100_000;
/** Samples of the peaks waiting for the database. */
export const PEAK_BUFFER_LIMIT = 50_000;
/** Visits tracked at once, open or closed and waiting for the grace time (past it new visits are not counted). */
export const MAX_VISITS = 20_000;

/** What a socket follows now, as known by the hub. */
export interface SocketView {
  /** Match shown to the socket (null: none yet). */
  matchId: string | null;
  /** The match is a simulation: the visit is never recorded. */
  simulated: boolean;
}

export interface VisitLink {
  tenantId: string;
  shareTokenId: string;
  clientFixtureId: string | null;
}

/** A finished visit, as written to `page_views`. */
export interface VisitRow {
  /** Assigned here, so that writing the same visit twice (a retry) is harmless. */
  id: string;
  tenantId: string;
  shareTokenId: string;
  clientFixtureId: string | null;
  matchId: string | null;
  startedAt: Date;
  endedAt: Date;
  seconds: number;
  device: VisitDevice;
  source: VisitSource;
  app: boolean;
  day: string;
}

/** Spectators connected to a match at a minute, as written to `viewer_peaks`. */
export interface PeakRow {
  tenantId: string;
  matchId: string;
  minute: Date;
  viewers: number;
  day: string;
}

interface Visit extends VisitLink {
  key: string;
  device: VisitDevice;
  source: VisitSource;
  app: boolean;
  startedAt: Date;
  /** Open sockets of the visit (a reconnection opens the new one after the old one closed). */
  sockets: number;
  /** When the last socket closed; null while one is open. */
  closedAt: Date | null;
  matchId: string | null;
  simulated: boolean;
  /** Reads what the latest socket of the visit follows now (null: it is gone). */
  read: (() => SocketView | null) | null;
}

/** Spectators connected now, by client. */
export interface NowCounts {
  viewers: number;
  matches: Map<string | null, number>;
  links: Map<string, number>;
}

/**
 * Visits of the public pages, in memory: everything is counted here and written to the database in batches by
 * `flushable()` (never once per message). A visit starts with the `hello` of a socket, ends 30 s after the last
 * socket closed, and is recorded unless it was short or on a simulated match. Nothing identifies the spectator: the id
 * of the visit only joins a reconnection to its visit and is forgotten with it.
 */
export class VisitTracker {
  private readonly visits = new Map<string, Visit>();
  private readonly bySocket = new WeakMap<object, Visit>();
  private finished: VisitRow[] = [];
  private peaks = new Map<string, PeakRow>();
  /** Visits and samples dropped because the buffers were full (read by the logs). */
  dropped = 0;

  constructor(private readonly now: () => Date) {}

  get openVisits(): number {
    return this.visits.size;
  }

  get pending(): { visits: number; peaks: number } {
    return { visits: this.finished.length, peaks: this.peaks.size };
  }

  /**
   * First `hello` of a socket opens (or, within the grace time, continues) a visit; the next ones of the same socket
   * are ignored: one visit per WebSocket connection, whatever the client sends. `view` is read at the end.
   */
  connect(socket: object, link: VisitLink, hello: HelloMessage, read: () => SocketView | null): boolean {
    if (this.bySocket.has(socket)) return false;
    const key = `${link.shareTokenId}:${hello.visit}`;
    let visit = this.visits.get(key);
    if (visit && visit.tenantId !== link.tenantId) return false;
    if (!visit) {
      if (this.visits.size >= MAX_VISITS) {
        this.dropped++;
        return false;
      }
      visit = {
        ...link,
        key,
        device: hello.device,
        source: hello.source,
        app: hello.app,
        startedAt: this.now(),
        sockets: 0,
        closedAt: null,
        matchId: null,
        simulated: false,
        read,
      };
      this.visits.set(key, visit);
    }
    visit.read = read;
    visit.sockets++;
    this.refresh(visit);
    visit.closedAt = null;
    this.bySocket.set(socket, visit);
    return true;
  }

  /** The socket closed: with its last socket closed the visit waits for a reconnection. */
  disconnect(socket: object, view: SocketView): void {
    const visit = this.bySocket.get(socket);
    if (!visit) return;
    this.bySocket.delete(socket);
    this.observe(visit, view);
    visit.sockets = Math.max(0, visit.sockets - 1);
    if (visit.sockets === 0) {
      visit.closedAt = this.now();
      visit.read = null;
    }
  }

  private refresh(visit: Visit): void {
    const view = visit.read?.();
    if (view) this.observe(visit, view);
  }

  private observe(visit: Visit, view: SocketView): void {
    if (view.simulated) visit.simulated = true;
    if (view.matchId !== null) visit.matchId = view.matchId;
  }

  /**
   * Once a minute: spectators connected to each match (visits with an open socket), kept for the next batch. The
   * count of the minute is the highest sample of that minute.
   */
  samplePeaks(): void {
    const at = this.now();
    const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
    const counts = new Map<string, { tenantId: string; matchId: string; viewers: number }>();
    for (const v of this.visits.values()) {
      if (v.sockets > 0) this.refresh(v);
      if (v.sockets === 0 || v.simulated || v.matchId === null) continue;
      const k = `${v.tenantId}|${v.matchId}`;
      const c = counts.get(k) ?? { tenantId: v.tenantId, matchId: v.matchId, viewers: 0 };
      c.viewers++;
      counts.set(k, c);
    }
    for (const [k, c] of counts) {
      const key = `${k}|${minute.getTime()}`;
      const kept = this.peaks.get(key);
      if (!kept || kept.viewers < c.viewers) this.peaks.set(key, { ...c, minute, day: romeDay(minute) });
    }
    while (this.peaks.size > PEAK_BUFFER_LIMIT) {
      const oldest = this.peaks.keys().next();
      if (oldest.done) break;
      this.peaks.delete(oldest.value);
      this.dropped++;
    }
  }

  /** Spectators connected now of a client (simulations excluded). */
  currently(tenantId: string): NowCounts {
    const out: NowCounts = { viewers: 0, matches: new Map(), links: new Map() };
    for (const v of this.visits.values()) {
      if (v.tenantId !== tenantId || v.sockets === 0) continue;
      this.refresh(v);
      if (v.simulated) continue;
      out.viewers++;
      out.matches.set(v.matchId, (out.matches.get(v.matchId) ?? 0) + 1);
      out.links.set(v.shareTokenId, (out.links.get(v.shareTokenId) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Takes what is ready for the database: the visits closed for more than the grace time (all of them with `all`, at
   * the shutdown: the open ones end now), and the samples of the peaks.
   */
  take(all = false): { visits: VisitRow[]; peaks: PeakRow[] } {
    const at = this.now();
    for (const [key, v] of this.visits) {
      const open = v.sockets > 0;
      if (open && !all) continue;
      if (open) this.refresh(v);
      if (!open && !all && v.closedAt && at.getTime() - v.closedAt.getTime() < RECONNECT_GRACE_MS) continue;
      this.visits.delete(key);
      const endedAt = open ? at : (v.closedAt ?? at);
      const ms = endedAt.getTime() - v.startedAt.getTime();
      if (v.simulated || ms < MIN_VISIT_MS) continue;
      this.finished.push({
        id: randomUUID(),
        tenantId: v.tenantId,
        shareTokenId: v.shareTokenId,
        clientFixtureId: v.clientFixtureId,
        matchId: v.matchId,
        startedAt: v.startedAt,
        endedAt,
        seconds: Math.round(ms / 1000),
        device: v.device,
        source: v.source,
        app: v.app,
        day: romeDay(v.startedAt),
      });
    }
    if (this.finished.length > BUFFER_LIMIT) {
      this.dropped += this.finished.length - BUFFER_LIMIT;
      this.finished = this.finished.slice(-BUFFER_LIMIT);
    }
    const out = { visits: this.finished, peaks: [...this.peaks.values()] };
    this.finished = [];
    this.peaks = new Map();
    return out;
  }

  /** A batch the database refused goes back first in line (the next flush tries again). */
  giveBack(batch: { visits: VisitRow[]; peaks: PeakRow[] }): void {
    this.finished = [...batch.visits, ...this.finished];
    for (const p of batch.peaks) {
      const key = `${p.tenantId}|${p.matchId}|${p.minute.getTime()}`;
      const kept = this.peaks.get(key);
      if (!kept || kept.viewers < p.viewers) this.peaks.set(key, p);
    }
    while (this.peaks.size > PEAK_BUFFER_LIMIT) {
      const oldest = this.peaks.keys().next();
      if (oldest.done) break;
      this.peaks.delete(oldest.value);
      this.dropped++;
    }
    if (this.finished.length > BUFFER_LIMIT) {
      this.dropped += this.finished.length - BUFFER_LIMIT;
      this.finished = this.finished.slice(-BUFFER_LIMIT);
    }
  }
}
