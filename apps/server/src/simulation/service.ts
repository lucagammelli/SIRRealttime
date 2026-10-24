import { randomInt, randomUUID } from 'node:crypto';
import type { PlaybackPlan } from '@arenalive/dvw-simulator';
import { DEFAULT_AWAY_NAME, planPlayback } from '@arenalive/dvw-simulator';
import type {
  IngestRequest,
  SimulationCommand,
  SimulationPace,
  SimulationResponse,
  SimulationStatus,
  SimulationSummary,
  StartSimulationRequest,
} from '@arenalive/shared';
import {
  hashScoutLines,
  INGEST_PROTOCOL,
  IngestRequestSchema,
  SIMULATION_RETENTION_MS,
  SIMULATION_TITLE,
} from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { comingFixtures, ourTeamForManual } from '../club.js';
import type { AppContext } from '../context.js';
import { matches, shareTokens } from '../db/index.js';
import type { IngestSource } from '../ingest.js';
import { applyIngest } from '../ingest.js';
import { conflict, notFound } from '../lib/errors.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { currentShortCode, insertShareToken } from '../shareCodes.js';
import { forgetShareToken } from '../state.js';
import { findTenant, publicBaseUrlFor, tenantScope } from '../tenancy.js';
import { setBreakSeconds } from './breaks.js';
import type { LoadedMatch } from './source.js';
import { fileMatch, generatedMatch } from './source.js';

/** Simulations running or paused at the same time on the server, all the clients together. */
export const SIMULATION_MAX_ACTIVE = 5;
/** At most one send to the ingest this often: the lines due meanwhile go together (points shown in sequence). */
export const SIMULATION_MIN_SEND_MS = 250;
/** How often ended simulations older than SIMULATION_RETENTION_MS are looked for. */
export const SIMULATION_SWEEP_MS = 60_000;

const RESTARTED_NOTICE = 'La simulazione si è interrotta con il riavvio del server: puoi ricominciarla da capo.';
const ERROR_NOTICE = 'La simulazione si è interrotta per un errore del server.';

/** Timers of the replay (tests: a fake clock that fires them by hand). */
export interface SimulationTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const REAL_TIMERS: SimulationTimers = {
  set: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    // A simulation never keeps the process alive.
    timer.unref();
    return timer;
  },
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

interface Session {
  tenantId: string;
  matchId: string;
  matchKey: string;
  link: SimulationSummary['link'];
  label: string;
  pace: SimulationPace;
  match: LoadedMatch;
  plan: PlaybackPlan;
  status: SimulationStatus;
  /** Lines the server has (sent and accepted). */
  sent: number;
  /** Next `seq` of the ingest. */
  seq: number;
  /** Milliseconds played before the last start or resume; `resumedAt` the time of that start (null: paused). */
  playedMs: number;
  resumedAt: number | null;
  lastSendAt: number;
  startedAt: Date;
  /** End (stop, finish) or pause: 6 hours after it the simulation is deleted. */
  endedAt: Date | null;
  pausedAt: Date | null;
  notice: string | null;
  state: MatchState | null;
  timer: unknown;
  /** Grows at every stop and restart: a send of the replay before it does nothing after it. */
  generation: number;
  /** The sends to the ingest of this simulation, one after the other. */
  queue: Promise<void>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Summary of the state of a match for the page (set, score, sets won, teams). */
function scoreOf(
  state: MatchState | null,
): Pick<SimulationSummary, 'homeName' | 'awayName' | 'set' | 'score' | 'setsWon'> {
  return {
    homeName: state?.teams.home.name ?? null,
    awayName: state?.teams.away.name ?? null,
    set: state?.live.set ?? 0,
    score: { home: state?.live.homeScore ?? 0, away: state?.live.awayScore ?? 0 },
    setsWon: { home: state?.setsWon.home ?? 0, away: state?.setsWon.away ?? 0 },
  };
}

/**
 * Simulations of a match, one per client at a time (at most SIMULATION_MAX_ACTIVE running or paused in the server):
 * the lines of a `.dvw` are sent with the timing of `planPlayback` to the same pipeline of `POST /api/ingest`
 * (`applyIngest`: `append`, `snapshot` when the server asks it, `seq` and `contentHash` as the agent), on a match
 * flagged `simulated` with a link of its own. Everything is in memory: a restart of the server loses the replay (the
 * match and its link stay, «stopped», until they are deleted). Match and link are deleted SIMULATION_RETENTION_MS
 * after the end (or the pause) of the simulation, or with «Elimina».
 */
export class SimulationService {
  private readonly sessions = new Map<string, Session>();
  /** Clients whose start is being prepared (two starts at once: the second one is a 409). */
  private readonly starting = new Set<string>();
  private sweeper: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly log: FastifyBaseLogger,
    private readonly timers: SimulationTimers = REAL_TIMERS,
  ) {}

  /** Starts the periodic deletion of the ended simulations. */
  open(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      this.sweep().catch((err: unknown) => this.log.error({ err }, 'pulizia delle simulazioni non riuscita'));
    }, SIMULATION_SWEEP_MS);
    this.sweeper.unref();
  }

  /** Shutdown of the server: every timer is cleared and the sends in progress are awaited. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const s of this.sessions.values()) {
      s.generation++;
      this.clearTimer(s);
    }
    await this.idle();
  }

  /** Every send in progress has ended (tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.queue));
  }

  /** Simulations running or paused in the whole server, with the ones being started. */
  activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.status === 'running' || s.status === 'paused') n++;
    for (const tenantId of this.starting) {
      const s = this.sessions.get(tenantId);
      if (s?.status !== 'running' && s?.status !== 'paused') n++;
    }
    return n;
  }

  async describe(tenantId: string): Promise<SimulationResponse> {
    const session = this.sessions.get(tenantId);
    return {
      simulation: session ? this.summaryOf(session) : await this.storedSummary(tenantId),
      clubTeams: await this.clubTeams(tenantId),
    };
  }

  async start(tenantId: string, request: StartSimulationRequest): Promise<SimulationResponse> {
    const current = this.sessions.get(tenantId);
    if (this.starting.has(tenantId) || current?.status === 'running' || current?.status === 'paused')
      throw conflict('C’è già una simulazione in corso: fermala prima di avviarne un’altra');
    if (this.activeCount() >= SIMULATION_MAX_ACTIVE)
      throw conflict('Troppe simulazioni in corso sul server: riprova tra qualche minuto');
    this.starting.add(tenantId);
    try {
      const match = await this.load(tenantId, request.source);
      // With a speed the break between two sets lasts the «Fine set» pause of the client (the points never cut it).
      const stored =
        request.pace.kind === 'speed' ? (await findTenant(this.ctx, { id: tenantId }))?.intermissions : null;
      const plan = planPlayback(match.timing, request.pace, {
        minBreakSeconds: (set) => setBreakSeconds(stored, set),
      });
      // The match of the previous simulation of the client is used again: a screen left on its link goes on.
      const reused = current ?? (await this.storedMatch(tenantId));
      const now = this.ctx.now();
      const session: Session = {
        tenantId,
        matchId: reused?.matchId ?? '',
        matchKey: reused?.matchKey ?? `simulazione-${randomUUID()}`,
        link: null,
        label: match.label,
        pace: request.pace,
        match,
        plan,
        status: 'running',
        sent: 0,
        seq: reused ? reused.seq : 0,
        playedMs: 0,
        resumedAt: now.getTime(),
        lastSendAt: 0,
        startedAt: now,
        endedAt: null,
        pausedAt: null,
        notice: null,
        state: null,
        timer: null,
        generation: (current?.generation ?? 0) + 1,
        queue: current?.queue ?? Promise.resolve(),
      };
      if (current) this.clearTimer(current);
      this.sessions.set(tenantId, session);
      await this.enqueue(session, () => this.snapshot(session, this.dueCount(session)));
      if (!session.matchId) throw new Error('simulated match not created');
      await this.ensureLink(session);
      this.log.info({ tenantId, matchId: session.matchId, source: request.source.kind }, 'simulazione avviata');
      this.schedule(session);
      return await this.describe(tenantId);
    } catch (err) {
      const s = this.sessions.get(tenantId);
      if (s && !s.matchId) this.sessions.delete(tenantId);
      else if (s?.status === 'running') this.end(s, 'stopped', ERROR_NOTICE);
      throw err;
    } finally {
      this.starting.delete(tenantId);
    }
  }

  async command(tenantId: string, command: SimulationCommand): Promise<SimulationResponse> {
    const s = this.sessions.get(tenantId);
    if (!s) throw notFound();
    const now = this.ctx.now();
    if (command === 'pause') {
      if (s.status !== 'running') throw conflict('La simulazione non è in corso');
      s.playedMs = this.playedMs(s);
      s.resumedAt = null;
      s.status = 'paused';
      s.pausedAt = now;
      this.clearTimer(s);
    } else if (command === 'resume') {
      if (s.status !== 'paused') throw conflict('La simulazione non è in pausa');
      s.status = 'running';
      s.resumedAt = now.getTime();
      s.pausedAt = null;
      this.schedule(s);
    } else if (command === 'stop') {
      if (s.status !== 'running' && s.status !== 'paused') throw conflict('La simulazione è già finita');
      this.end(s, 'stopped', null);
    } else {
      if (s.status !== 'running' && s.status !== 'paused' && this.activeCount() >= SIMULATION_MAX_ACTIVE)
        throw conflict('Troppe simulazioni in corso sul server: riprova tra qualche minuto');
      s.generation++;
      this.clearTimer(s);
      Object.assign(s, {
        status: 'running',
        playedMs: 0,
        resumedAt: now.getTime(),
        startedAt: now,
        endedAt: null,
        pausedAt: null,
        notice: null,
      });
      await this.enqueue(s, () => this.snapshot(s, this.dueCount(s)));
      this.schedule(s);
    }
    this.log.info({ tenantId, matchId: s.matchId, command }, 'comando della simulazione');
    return this.describe(tenantId);
  }

  /** «Elimina»: the simulation stops, its match and its link are deleted (spectators disconnected). */
  async remove(tenantId: string): Promise<void> {
    const s = this.sessions.get(tenantId);
    if (s) {
      s.generation++;
      this.clearTimer(s);
      await s.queue;
      this.sessions.delete(tenantId);
    }
    const deleted = await this.deleteMatches(tenantScope(matches, tenantId, eq(matches.simulated, true)));
    if (!s && deleted === 0) throw notFound();
    this.log.info({ tenantId }, 'simulazione eliminata');
  }

  /**
   * Deletes the simulations ended (or paused) at least SIMULATION_RETENTION_MS ago, and the simulated matches left
   * by a restart of the server not changed for as long. Returns the number of matches deleted.
   */
  async sweep(): Promise<number> {
    const now = this.ctx.now().getTime();
    const limit = new Date(now - SIMULATION_RETENTION_MS);
    let deleted = 0;
    for (const s of [...this.sessions.values()]) {
      const since = s.status === 'paused' ? s.pausedAt : s.status === 'running' ? null : s.endedAt;
      if (!since || since > limit) continue;
      s.generation++;
      this.clearTimer(s);
      await s.queue;
      this.sessions.delete(s.tenantId);
      deleted += await this.deleteMatches(eq(matches.id, s.matchId));
    }
    const kept = [...this.sessions.values()].map((s) => s.matchId);
    const old = await this.ctx.db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.simulated, true), lte(matches.updatedAt, limit)));
    const orphans = old.map((r) => r.id).filter((id) => !kept.includes(id));
    if (orphans.length) deleted += await this.deleteMatches(inArray(matches.id, orphans));
    if (deleted) this.log.info({ deleted }, 'simulazioni scadute eliminate');
    return deleted;
  }

  /**
   * Deletes simulated matches (lines and links go with them) and disconnects the spectators of their links, read
   * from the database before the delete (also after a restart, when this process never saw them).
   */
  private async deleteMatches(where: SQL | undefined): Promise<number> {
    const doomed = await this.ctx.db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.simulated, true), where));
    if (doomed.length === 0) return 0;
    const ids = doomed.map((r) => r.id);
    const links = await this.ctx.db
      .select({ id: shareTokens.id })
      .from(shareTokens)
      .where(inArray(shareTokens.matchId, ids));
    const rows = await this.ctx.db
      .delete(matches)
      .where(and(eq(matches.simulated, true), inArray(matches.id, ids)))
      .returning({ id: matches.id });
    for (const r of rows) this.ctx.hub.forgetMatch(r.id);
    this.ctx.caches.shares.deleteWhere((share) => share.matchId !== null && ids.includes(share.matchId));
    for (const link of links) this.closeLink(link.id);
    return rows.length;
  }

  private closeLink(linkId: string): void {
    forgetShareToken(this.ctx, linkId);
    this.ctx.hub.closeShareToken(linkId);
  }

  private async load(tenantId: string, source: StartSimulationRequest['source']): Promise<LoadedMatch> {
    const maxLines = this.ctx.config.matchMaxLines;
    if (source.kind === 'upload')
      return fileMatch(Buffer.from(source.data, 'base64'), `File: ${source.fileName}`, maxLines);
    const teams = source.clubTeams ? await this.clubTeams(tenantId) : null;
    return generatedMatch({
      sets: source.sets,
      seed: source.seed ?? randomInt(1, 2_147_483_647),
      homeName: teams?.home,
      awayName: teams?.away,
      profile: source.profile,
    });
  }

  /** Our team and the opponent of the next match of the club (home and away as in the calendar). */
  private async clubTeams(tenantId: string): Promise<SimulationResponse['clubTeams']> {
    const next = (await comingFixtures(this.ctx.db, tenantId, this.ctx.now())).rows[0];
    if (next) return { home: next.homeName, away: next.awayName };
    const our = await ourTeamForManual(this.ctx.db, tenantId);
    return { home: our.name, away: DEFAULT_AWAY_NAME };
  }

  /** The simulated match of the client in the database (after a restart), with its next `seq`. */
  private async storedMatch(tenantId: string): Promise<{ matchId: string; matchKey: string; seq: number } | null> {
    const [row] = await this.ctx.db
      .select({ id: matches.id, matchKey: matches.matchKey, lastSeq: matches.lastSeq })
      .from(matches)
      .where(tenantScope(matches, tenantId, eq(matches.simulated, true)))
      .orderBy(desc(matches.updatedAt))
      .limit(1);
    return row ? { matchId: row.id, matchKey: row.matchKey, seq: row.lastSeq + 1 } : null;
  }

  /** Summary of a simulated match left in the database by a restart (the replay is lost). */
  private async storedSummary(tenantId: string): Promise<SimulationSummary | null> {
    const [row] = await this.ctx.db
      .select()
      .from(matches)
      .where(tenantScope(matches, tenantId, eq(matches.simulated, true)))
      .orderBy(desc(matches.updatedAt))
      .limit(1);
    if (!row) return null;
    return {
      matchId: row.id,
      status: 'stopped',
      source: SIMULATION_TITLE,
      pace: null,
      ...scoreOf(row.state),
      linesSent: row.lineCount,
      linesTotal: row.lineCount,
      elapsedMs: 0,
      totalMs: 0,
      remainingMs: 0,
      startedAt: row.createdAt.toISOString(),
      endedAt: row.updatedAt.toISOString(),
      deleteAt: new Date(row.updatedAt.getTime() + SIMULATION_RETENTION_MS).toISOString(),
      notice: RESTARTED_NOTICE,
      link: await this.linkOf(tenantId, row.id),
    };
  }

  /** Short code and URL of the link of a simulated match (null: none). */
  private async linkOf(tenantId: string, matchId: string): Promise<SimulationSummary['link']> {
    const [row] = await this.ctx.db
      .select()
      .from(shareTokens)
      .where(tenantScope(shareTokens, tenantId, eq(shareTokens.matchId, matchId), eq(shareTokens.revoked, false)))
      .limit(1);
    const code = row ? currentShortCode(this.ctx.config.shareCodeSecret, row) : null;
    if (!row || !code) return null;
    return { shortCode: code, shortUrl: `${await this.baseUrl(tenantId)}/l/${code}` };
  }

  private async baseUrl(tenantId: string): Promise<string> {
    const tenant = await findTenant(this.ctx, { id: tenantId });
    return publicBaseUrlFor(this.ctx.config.publicBaseUrl, tenant?.hostnames ?? []);
  }

  /** The link of the simulation: the one of its match if there is one, otherwise a new one («Simulazione»). */
  private async ensureLink(s: Session): Promise<void> {
    const existing = await this.linkOf(s.tenantId, s.matchId);
    if (existing) {
      s.link = existing;
      return;
    }
    const { code } = await insertShareToken(this.ctx.db, this.ctx.config.shareCodeSecret, {
      tenantId: s.tenantId,
      // The long token is never shown: the simulation is opened with the short link and its QR.
      tokenHash: hashToken(generateToken()),
      matchId: s.matchId,
      label: SIMULATION_TITLE,
      expiresAt: null,
    });
    s.link = { shortCode: code, shortUrl: `${await this.baseUrl(s.tenantId)}/l/${code}` };
  }

  private summaryOf(s: Session): SimulationSummary {
    const played = Math.min(this.playedMs(s), s.plan.totalMs);
    const ended = s.status === 'stopped' || s.status === 'finished';
    const since = s.status === 'paused' ? s.pausedAt : ended ? s.endedAt : null;
    return {
      matchId: s.matchId,
      status: s.status,
      source: s.label,
      pace: s.pace,
      ...scoreOf(s.state),
      linesSent: s.sent,
      linesTotal: s.match.lines.length,
      elapsedMs: Math.round(played),
      totalMs: s.plan.totalMs,
      remainingMs: ended ? 0 : Math.max(0, Math.round(s.plan.totalMs - played)),
      startedAt: s.startedAt.toISOString(),
      endedAt: iso(s.endedAt),
      deleteAt: since ? new Date(since.getTime() + SIMULATION_RETENTION_MS).toISOString() : null,
      notice: s.notice,
      link: s.link,
    };
  }

  private playedMs(s: Session): number {
    return s.playedMs + (s.resumedAt === null ? 0 : Math.max(0, this.ctx.now().getTime() - s.resumedAt));
  }

  /** Lines due now (at least the first one). */
  private dueCount(s: Session): number {
    const played = this.playedMs(s);
    let n = 0;
    while (n < s.plan.offsetsMs.length && (s.plan.offsetsMs[n] ?? 0) <= played) n++;
    return Math.max(n, Math.min(1, s.match.lines.length));
  }

  private clearTimer(s: Session): void {
    if (s.timer !== null) this.timers.clear(s.timer);
    s.timer = null;
  }

  private end(s: Session, status: 'stopped' | 'finished', notice: string | null): void {
    s.playedMs = this.playedMs(s);
    s.resumedAt = null;
    s.status = status;
    s.endedAt = this.ctx.now();
    s.pausedAt = null;
    s.notice = notice;
    s.generation++;
    this.clearTimer(s);
  }

  /** Next send of a running simulation: when its next line is due, not sooner than SIMULATION_MIN_SEND_MS. */
  private schedule(s: Session): void {
    this.clearTimer(s);
    if (s.status !== 'running' || this.closed) return;
    if (s.sent >= s.match.lines.length) {
      this.end(s, 'finished', null);
      this.log.info({ tenantId: s.tenantId, matchId: s.matchId }, 'simulazione finita');
      return;
    }
    const now = this.ctx.now().getTime();
    const due = (s.plan.offsetsMs[s.sent] ?? 0) - this.playedMs(s);
    const wait = Math.max(due, s.lastSendAt + SIMULATION_MIN_SEND_MS - now, 0);
    const generation = s.generation;
    s.timer = this.timers.set(() => {
      s.timer = null;
      if (generation !== s.generation || s.status !== 'running') return;
      void this.enqueue(s, async () => {
        if (generation !== s.generation || s.status !== 'running') return;
        await this.append(s, Math.max(this.dueCount(s), s.sent + 1));
      }).then(
        () => {
          if (generation === s.generation) this.schedule(s);
        },
        () => undefined,
      );
    }, wait);
  }

  /** Runs a send after the ones before it; an error stops the simulation (logged, never a crash). */
  private enqueue(s: Session, send: () => Promise<void>): Promise<void> {
    const run = s.queue.then(send);
    s.queue = run.catch((err: unknown) => {
      this.log.error({ err, tenantId: s.tenantId }, 'simulazione interrotta');
      if (s.status === 'running' || s.status === 'paused') this.end(s, 'stopped', ERROR_NOTICE);
    });
    return run;
  }

  /** Sends the lines up to `upTo` after the ones the server has (`append`), as the agent. */
  private async append(s: Session, upTo: number): Promise<void> {
    const end = Math.min(upTo, s.match.lines.length);
    if (end <= s.sent) return;
    const all = s.match.lines.slice(0, end);
    await this.send(s, { kind: 'append', fromIndex: s.sent, lines: all.slice(s.sent) }, all);
  }

  /** Replaces all the lines of the server with the first `upTo` (start, restart, or when the server asks it). */
  private async snapshot(s: Session, upTo: number): Promise<void> {
    const all = s.match.lines.slice(0, upTo);
    await this.send(s, { kind: 'snapshot', fromIndex: 0, lines: all, header: s.match.header }, all);
  }

  private async send(
    s: Session,
    part: Pick<IngestRequest, 'kind' | 'fromIndex' | 'lines' | 'header'>,
    all: string[],
  ): Promise<void> {
    const source: IngestSource = { tenantId: s.tenantId, agentId: null, simulated: true };
    const contentHash = await hashScoutLines(all);
    const request = (p: typeof part): IngestRequest =>
      IngestRequestSchema.parse({ protocol: INGEST_PROTOCOL, matchKey: s.matchKey, seq: s.seq++, ...p, contentHash });
    let outcome = await applyIngest(this.ctx, source, request(part));
    if (outcome.response.status !== 'ok') {
      // The server lost the thread (or has another seq): a snapshot of every line, as the agent does.
      s.seq = Math.max(s.seq, outcome.response.seq + 1);
      outcome = await applyIngest(
        this.ctx,
        source,
        request({ kind: 'snapshot', fromIndex: 0, lines: all, header: s.match.header }),
      );
      if (outcome.response.status !== 'ok') throw new Error(`simulation ingest ${outcome.response.status}`);
    }
    s.sent = all.length;
    s.lastSendAt = this.ctx.now().getTime();
    if (outcome.published) {
      s.matchId = outcome.published.matchId;
      s.state = outcome.published.state;
    } else if (!s.matchId) {
      const stored = await this.storedMatchByKey(s);
      s.matchId = stored?.id ?? '';
      s.state = stored?.state ?? null;
    }
  }

  private async storedMatchByKey(s: Session): Promise<{ id: string; state: MatchState | null } | null> {
    const [row] = await this.ctx.db
      .select({ id: matches.id, state: matches.state })
      .from(matches)
      .where(tenantScope(matches, s.tenantId, eq(matches.matchKey, s.matchKey)))
      .limit(1);
    return row ?? null;
  }
}
