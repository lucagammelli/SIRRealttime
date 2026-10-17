import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { leagues } from '../db/index.js';
import { romeDayAt } from './romeTime.js';
import type { LeagueService, StandingsMode } from './sync.js';
import { leaguesWithClubMatches } from '../club.js';

/** Hour (Rome) of the nightly update of every championship. */
export const NIGHTLY_HOUR = 4;
/** Pause between two updates of a championship with a match today. */
export const MATCH_DAY_INTERVAL_MS = 10 * 60_000;
/** Every minute the scheduler looks for what is due. */
export const SCHEDULER_TICK_MS = 60_000;

export interface ScheduledLeague {
  id: string;
  /** Last attempt (good or not). */
  lastSyncAt: Date | null;
  /** A club of a client has a match of the championship starting today (Rome day). */
  matchToday: boolean;
}

/**
 * Pure: updates due at `now`. Every championship once a night after 04:00 (Rome), standings included; the ones with
 * a match of a club of a client today every 10 minutes, standings only when a match became played.
 */
export function dueSyncs(now: Date, list: ScheduledLeague[]): { id: string; standings: StandingsMode }[] {
  const nightly = romeDayAt(now, NIGHTLY_HOUR).at;
  const due: { id: string; standings: StandingsMode }[] = [];
  for (const l of list) {
    if (now >= nightly && (l.lastSyncAt === null || l.lastSyncAt < nightly))
      due.push({ id: l.id, standings: 'always' });
    else if (l.matchToday && (l.lastSyncAt === null || now.getTime() - l.lastSyncAt.getTime() >= MATCH_DAY_INTERVAL_MS))
      due.push({ id: l.id, standings: 'ifChanged' });
  }
  return due;
}

/**
 * Pure: time of the next automatic update of a championship (the same rules as `dueSyncs`): `now` when one is due,
 * otherwise 10 minutes after the last attempt on a match day (never later than the nightly one), otherwise the
 * next nightly update at 04:00 (Rome).
 */
export function nextSyncAt(now: Date, l: Omit<ScheduledLeague, 'id'>): Date {
  const nightly = romeDayAt(now, NIGHTLY_HOUR);
  if (now >= nightly.at && (l.lastSyncAt === null || l.lastSyncAt < nightly.at)) return now;
  const nextNightly = now < nightly.at ? nightly.at : nightly.nextDay;
  if (l.matchToday) {
    const at = l.lastSyncAt ? new Date(Math.max(now.getTime(), l.lastSyncAt.getTime() + MATCH_DAY_INTERVAL_MS)) : now;
    return at < nextNightly ? at : nextNightly;
  }
  return nextNightly;
}

/** Automatic updates in the server process (off with LEAGUE_SYNC=off): one championship at a time. */
export class LeagueScheduler {
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly o: { db: Db; leagues: LeagueService; now: () => Date; log: FastifyBaseLogger },
    private readonly tickMs = SCHEDULER_TICK_MS,
  ) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.current;
  }

  /** Runs the updates due now (nothing when the previous tick is still running). */
  tick(): Promise<void> {
    if (this.current || this.stopped) return this.current ?? Promise.resolve();
    this.current = this.runDue()
      .catch((err: unknown) => this.o.log.error({ err }, 'pianificazione dei campionati fallita'))
      .finally(() => {
        this.current = null;
      });
    return this.current;
  }

  private async runDue(): Promise<void> {
    const now = this.o.now();
    const day = romeDayAt(now, 0);
    const [rows, today] = await Promise.all([
      this.o.db.select({ id: leagues.id, lastSyncAt: leagues.lastSyncAt }).from(leagues),
      leaguesWithClubMatches(this.o.db, day.at, day.nextDay),
    ]);
    const due = dueSyncs(
      now,
      rows.map((r) => ({ ...r, matchToday: today.has(r.id) })),
    );
    for (const d of due) {
      if (this.stopped) return;
      await this.o.leagues.syncLeague(d.id, { standings: d.standings });
    }
  }
}
