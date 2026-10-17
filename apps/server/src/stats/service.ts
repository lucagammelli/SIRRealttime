import type { HelloMessage } from '@sir/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { NowCounts, SocketView, VisitLink } from './tracker.js';
import { VisitTracker } from './tracker.js';
import { romeDay } from './days.js';
import { purgeOld, writeBatch } from './store.js';

/** Batches are written this often (10-30 s): never once per message. */
export const FLUSH_MS = 15_000;
/** Spectators per match are sampled once a minute. */
export const SAMPLE_MS = 60_000;
/** The cleanup looks for a new day this often (and at the start); it does not depend on the championship updates. */
export const HOUSEKEEPING_MS = 3_600_000;

/**
 * Statistics of the visits of the public pages: the tracker in memory, the timer that writes its batches, the daily
 * cleanup (run by the scheduler of the championships) and the flush at the shutdown. A failure of the database is
 * logged and the batch is tried again at the next flush; it never reaches the spectators.
 */
export class StatsService {
  private readonly tracker: VisitTracker;
  private timer: NodeJS.Timeout | null = null;
  private cleanTimer: NodeJS.Timeout | null = null;
  private lastSampleMinute = -1;
  private flushing: Promise<void> | null = null;
  private purgedDay: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
    private readonly log: FastifyBaseLogger,
    private readonly flushMs = FLUSH_MS,
  ) {
    this.tracker = new VisitTracker(now);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.flushMs);
    this.timer.unref();
    this.cleanTimer = setInterval(() => void this.housekeeping(), HOUSEKEEPING_MS);
    this.cleanTimer.unref();
  }

  /** Opens a visit for a socket (first `hello` only). */
  connect(socket: object, link: VisitLink, hello: HelloMessage, read: () => SocketView | null): void {
    this.tracker.connect(socket, link, hello, read);
  }

  disconnect(socket: object, view: SocketView): void {
    this.tracker.disconnect(socket, view);
  }

  currently(tenantId: string): NowCounts {
    return this.tracker.currently(tenantId);
  }

  /** Samples the peaks when a new minute began, then writes what is ready. */
  async tick(): Promise<void> {
    const minute = Math.floor(this.now().getTime() / SAMPLE_MS);
    if (minute !== this.lastSampleMinute) {
      this.lastSampleMinute = minute;
      this.tracker.samplePeaks();
    }
    await this.flush();
  }

  flush(all = false): Promise<void> {
    if (this.flushing) return this.flushing;
    const batch = this.tracker.take(all);
    if (batch.visits.length === 0 && batch.peaks.length === 0) return Promise.resolve();
    this.flushing = writeBatch(this.db, batch)
      .catch((err: unknown) => {
        this.log.error({ err }, 'statistiche delle visite non scritte, nuovo tentativo al prossimo invio');
        this.tracker.giveBack(batch);
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  /** Once a day: the detail older than 90 days becomes daily totals (called by its own hourly timer and at the start). */
  async housekeeping(): Promise<void> {
    const today = romeDay(this.now());
    if (this.purgedDay === today) return;
    try {
      await purgeOld(this.db, today);
      this.purgedDay = today;
    } catch (err) {
      this.log.error({ err }, 'pulizia delle statistiche non riuscita');
    }
  }

  /** Shutdown: the open visits end now and everything is written. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.cleanTimer) clearInterval(this.cleanTimer);
    this.cleanTimer = null;
    await this.flushing;
    this.tracker.samplePeaks();
    await this.flush(true);
  }
}
