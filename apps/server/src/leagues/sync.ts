import { createHash } from 'node:crypto';
import type { LeaguePhase } from '@arenalive/shared';
import { and, eq, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger } from 'fastify';
import { writeLeagueLogoFile } from '../assetStore.js';
import type { Db } from '../db/index.js';
import { fixtures, leagueHttpCache, leagues, leagueTeams, standings, teamLogos } from '../db/index.js';
import { ImageRejected, inspectImage } from '../lib/images.js';
import type { DownloadKind, LeagueFetcher, Validators } from './fetcher.js';
import { decodePage, LeagueFetchError } from './fetcher.js';
import type { ParsedCalendar, ParsedFixture, ParsedStandings } from './legavolley.js';
import {
  calendarUrl,
  LeagueFormatError,
  LOGO_MIN_SIDE,
  logoUrl,
  MAX_PHASES,
  parseCalendar,
  parseStandings,
  parseTeam,
  standingsUrl,
  teamUrl,
} from './legavolley.js';

type LeagueRow = typeof leagues.$inferSelect;
type TeamRow = typeof leagueTeams.$inferSelect;

/**
 * Update of a championship: downloads calendar (every phase) and standings, stores them in one transaction, then
 * team pages and logos missing or older than 7 days. A network or format error leaves the stored data as they are
 * and is recorded in the row of the championship.
 */

/** `always`: standings downloaded every time; `ifChanged`: only when a match became played (match days). */
export type StandingsMode = 'always' | 'ifChanged';

export interface SyncOptions {
  standings?: StandingsMode;
}

export interface SyncResult {
  status: 'ok' | 'error';
  message: string | null;
}

export interface LeagueServiceOptions {
  db: Db;
  fetcher: LeagueFetcher;
  assetsDir: string;
  now: () => Date;
  log: FastifyBaseLogger;
  /** Called after every good update (the clubs of the clients copy their matches again); errors are only logged. */
  onUpdated?: (leagueId: string) => Promise<void>;
}

/** Key of the transaction lock (with a hash of the championship) that serializes the writes of an update. */
const LEAGUE_LOCK_KEY = 0x53494c47;
/** A lease older than this belongs to a process that died: it can be taken over. */
export const SYNC_LEASE_MS = 15 * 60_000;
/** Team pages and logos are downloaded again after a week. */
export const TEAM_DETAILS_MAX_AGE_MS = 7 * 24 * 3_600_000;

const excluded = (column: AnyPgColumn) => sql`excluded.${sql.identifier(column.name)}`;

/** Pure: name compared between standings and calendar (case, spaces and accents ignored). */
export function teamNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Downloaded {
  pages: ParsedCalendar[];
  phases: LeaguePhase[];
  standings: ParsedStandings | null;
  /** Validators to save once the data are stored (never before: a failed update must download again). */
  cache: { url: string; validators: Validators }[];
}

/** The lease of the update was taken over by another process (this one was considered dead): stop quietly. */
class LeaseLost extends Error {
  readonly code = 'LEASE_LOST';
}

/** The lease is renewed at most this often during an update (one write per minute, not per page). */
const LEASE_RENEW_MS = 60_000;

const isLeagueError = (err: unknown): err is LeagueFetchError | LeagueFormatError =>
  (err instanceof LeagueFetchError && err.code !== 'CLOSED') || err instanceof LeagueFormatError;

export class LeagueService {
  private readonly running = new Set<Promise<SyncResult>>();
  /** Value of `sync_started_at` written by the updates running here, by championship. */
  private readonly leases = new Map<string, Date>();

  constructor(private readonly o: LeagueServiceOptions) {}

  /**
   * Takes the lease of the championship and starts its update; null when the championship does not exist or another
   * update of it is running (in this or another process). `done` never rejects (an object: an async function
   * returning a promise would wait for it).
   */
  async begin(leagueId: string, options: SyncOptions = {}): Promise<{ done: Promise<SyncResult> } | null> {
    const now = this.o.now();
    const [league] = await this.o.db
      .update(leagues)
      .set({ syncStartedAt: now })
      .where(
        and(
          eq(leagues.id, leagueId),
          or(isNull(leagues.syncStartedAt), lt(leagues.syncStartedAt, new Date(now.getTime() - SYNC_LEASE_MS))),
        ),
      )
      .returning();
    if (!league) return null;
    this.leases.set(league.id, now);
    const run: Promise<SyncResult> = this.run(league, options).finally(() => {
      this.running.delete(run);
      this.leases.delete(league.id);
    });
    this.running.add(run);
    return { done: run };
  }

  /** Updates a championship and waits for the end; `busy` when it is already being updated. */
  async syncLeague(leagueId: string, options: SyncOptions = {}): Promise<SyncResult | 'busy'> {
    const run = await this.begin(leagueId, options);
    return run ? run.done : 'busy';
  }

  /** Resolves when no update started here is running. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  /** Stops the downloads in progress (server shutdown): the running updates end with an error. */
  close(): void {
    this.o.fetcher.close();
  }

  /**
   * Renews the lease of a long update (at most once a minute), only while it is still ours; throws LeaseLost when
   * another process has taken it over.
   */
  private async renewLease(leagueId: string): Promise<void> {
    const lease = this.leases.get(leagueId);
    if (!lease) throw new LeaseLost('lease missing');
    const now = this.o.now();
    if (now.getTime() - lease.getTime() < LEASE_RENEW_MS) return;
    const renewed = await this.o.db
      .update(leagues)
      .set({ syncStartedAt: now })
      .where(and(eq(leagues.id, leagueId), eq(leagues.syncStartedAt, lease)))
      .returning({ id: leagues.id });
    if (renewed.length === 0) throw new LeaseLost('lease taken over');
    this.leases.set(leagueId, now);
  }

  private async run(league: LeagueRow, options: SyncOptions): Promise<SyncResult> {
    const { log } = this.o;
    let result: SyncResult;
    try {
      const downloaded = await this.download(league, options.standings ?? 'always');
      await this.store(league, downloaded);
      let warnings: string | null;
      try {
        warnings = await this.refreshTeams(league.id);
      } catch (err) {
        if (err instanceof LeaseLost) throw err;
        // Calendar and standings are stored: a failure on teams or logos is a warning, not a failed update.
        log.error({ err, leagueId: league.id }, 'squadre e loghi del campionato non aggiornati');
        warnings = 'Aggiornato con avvisi: squadre e loghi non aggiornati (errore interno)';
      }
      result = { status: 'ok', message: warnings };
      try {
        await this.o.onUpdated?.(league.id);
      } catch (err) {
        log.error({ err, leagueId: league.id }, 'partite dei club non aggiornate dopo il campionato');
      }
      log.info(
        { leagueId: league.id, pages: downloaded.pages.length, standings: downloaded.standings !== null },
        'campionato aggiornato',
      );
    } catch (err) {
      if (err instanceof LeaseLost) {
        // The outcome belongs to the process that took the lease over: nothing is written here.
        log.warn({ leagueId: league.id }, 'aggiornamento del campionato ripreso da un altro processo');
        return { status: 'error', message: 'Aggiornamento ripreso da un altro processo' };
      }
      if (isLeagueError(err)) {
        result = { status: 'error', message: err.message };
        log.warn({ leagueId: league.id, code: err.code, reason: err.message }, 'aggiornamento del campionato fallito');
      } else {
        result = { status: 'error', message: 'Errore interno durante l’aggiornamento' };
        log.error({ err, leagueId: league.id }, 'aggiornamento del campionato fallito');
      }
    }
    try {
      const at = this.o.now();
      await this.o.db
        .update(leagues)
        .set({
          syncStartedAt: null,
          lastSyncAt: at,
          lastStatus: result.status,
          lastMessage: result.message,
          ...(result.status === 'ok' ? { lastSuccessAt: at } : {}),
        })
        // Only while the lease is still ours: a process that took it over writes its own outcome.
        .where(and(eq(leagues.id, league.id), eq(leagues.syncStartedAt, this.leases.get(league.id) ?? at)));
    } catch (err) {
      log.error({ err, leagueId: league.id }, 'esito dell’aggiornamento del campionato non salvato');
    }
    return result;
  }

  private async validators(url: string): Promise<Validators | null> {
    const [row] = await this.o.db.select().from(leagueHttpCache).where(eq(leagueHttpCache.url, url)).limit(1);
    return row ? { etag: row.etag, lastModified: row.lastModified } : null;
  }

  private async saveValidators(entries: { url: string; validators: Validators }[]): Promise<void> {
    const useful = entries.filter((e) => e.validators.etag !== null || e.validators.lastModified !== null);
    if (useful.length === 0) return;
    await this.o.db
      .insert(leagueHttpCache)
      .values(useful.map((e) => ({ url: e.url, ...e.validators, updatedAt: this.o.now() })))
      .onConflictDoUpdate({
        target: leagueHttpCache.url,
        set: {
          etag: excluded(leagueHttpCache.etag),
          lastModified: excluded(leagueHttpCache.lastModified),
          updatedAt: excluded(leagueHttpCache.updatedAt),
        },
      });
  }

  /** Downloads a page; null when not modified since the saved validators. */
  private async page(
    url: URL,
    conditional: boolean,
  ): Promise<{ text: string; url: string; validators: Validators } | null> {
    const key = url.toString();
    const res = await this.o.fetcher.get(url, 'page', conditional ? await this.validators(key) : null);
    if (res.status === 'not-modified') return null;
    return { text: decodePage(res.body, res.contentType), url: key, validators: res.validators };
  }

  private checkPage(league: LeagueRow, season: number, championshipId: number | null): void {
    if (season !== league.season || (championshipId !== null && championshipId !== league.externalId))
      throw new LeagueFormatError(
        `Il sito mostra un altro campionato (IdCampionato ${championshipId ?? '?'}, stagione ${season}/${season + 1}): ` +
          'controlla IdCampionato e stagione',
      );
  }

  private async download(league: LeagueRow, mode: StandingsMode): Promise<Downloaded> {
    const pages: ParsedCalendar[] = [];
    const cache: Downloaded['cache'] = [];
    let phases = league.phases;
    const done = new Set<number>();
    if (phases.length === 0) {
      // First update (or a championship without phases): the page without IdFase lists the phases.
      const first = await this.page(calendarUrl(league.season, league.externalId), false);
      if (!first) throw new LeagueFormatError('Risposta inattesa del sito');
      const parsed = parseCalendar(first.text);
      this.checkPage(league, parsed.season, parsed.championshipId);
      pages.push(parsed);
      phases = parsed.phases;
      done.add(parsed.phaseId);
    }
    const pending = phases.map((p) => p.id).filter((id) => !done.has(id));
    for (let phaseId = pending.shift(); phaseId !== undefined; phaseId = pending.shift()) {
      done.add(phaseId);
      if (done.size > MAX_PHASES) throw new LeagueFormatError('Troppe fasi nel calendario');
      await this.renewLease(league.id);
      const res = await this.page(calendarUrl(league.season, league.externalId, phaseId), true);
      if (!res) continue;
      const parsed = parseCalendar(res.text);
      this.checkPage(league, parsed.season, parsed.championshipId);
      if (parsed.phaseId !== phaseId) throw new LeagueFormatError(`Il sito non mostra la fase ${phaseId} richiesta`);
      pages.push(parsed);
      cache.push({ url: res.url, validators: res.validators });
      phases = parsed.phases;
      for (const p of parsed.phases) if (!done.has(p.id) && !pending.includes(p.id)) pending.push(p.id);
    }
    let parsedStandings: ParsedStandings | null = null;
    if (mode === 'always' || (await this.newlyPlayed(league.id, pages))) {
      await this.renewLease(league.id);
      const res = await this.page(standingsUrl(league.season, league.externalId), true);
      if (res) {
        parsedStandings = parseStandings(res.text);
        this.checkPage(league, parsedStandings.season, parsedStandings.championshipId);
        cache.push({ url: res.url, validators: res.validators });
      }
    }
    return { pages, phases, standings: parsedStandings, cache };
  }

  /** True when a downloaded match is played and was not played in the stored calendar. */
  private async newlyPlayed(leagueId: string, pages: ParsedCalendar[]): Promise<boolean> {
    const played = pages.flatMap((p) => p.fixtures).filter((f) => f.status === 'played');
    if (played.length === 0) return false;
    const stored = await this.o.db
      .select({ externalId: fixtures.externalId, status: fixtures.status })
      .from(fixtures)
      .where(eq(fixtures.leagueId, leagueId));
    const before = new Map(stored.map((s) => [s.externalId, s.status]));
    return played.some((f) => before.get(f.externalId) !== 'played');
  }

  private async store(league: LeagueRow, d: Downloaded): Promise<void> {
    const now = this.o.now();
    await this.o.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LEAGUE_LOCK_KEY}, hashtext(${league.id}))`);
      const name = d.pages[0]?.name;
      if (name !== undefined) await tx.update(leagues).set({ name, phases: d.phases }).where(eq(leagues.id, league.id));

      const teams = new Map<number, string>();
      for (const page of d.pages)
        for (const t of page.teams) if (!teams.has(t.externalId)) teams.set(t.externalId, t.name);
      if (teams.size > 0)
        await tx
          .insert(leagueTeams)
          .values([...teams].map(([externalId, teamName]) => ({ leagueId: league.id, externalId, name: teamName })))
          .onConflictDoUpdate({
            target: [leagueTeams.leagueId, leagueTeams.externalId],
            set: { name: excluded(leagueTeams.name), updatedAt: now },
            setWhere: sql`${leagueTeams.name} is distinct from ${excluded(leagueTeams.name)}`,
          });
      const teamRows = await tx
        .select({ id: leagueTeams.id, externalId: leagueTeams.externalId, name: leagueTeams.name })
        .from(leagueTeams)
        .where(eq(leagueTeams.leagueId, league.id));
      const teamId = new Map(teamRows.map((t) => [t.externalId, t.id]));

      for (const page of d.pages) {
        // A phase that now reads empty keeps its stored matches (a calendar never loses all its matches).
        if (page.fixtures.length === 0) continue;
        const unique = new Map(page.fixtures.map((f) => [f.externalId, f]));
        const values = [...unique.values()].map((f) => fixtureValues(league.id, f, teamId, now));
        await tx
          .insert(fixtures)
          .values(values)
          .onConflictDoUpdate({
            target: [fixtures.leagueId, fixtures.externalId],
            set: Object.fromEntries(FIXTURE_UPDATED_COLUMNS.map((key) => [key, excluded(fixtures[key])])),
            setWhere: sql`${fixtures.contentHash} <> ${excluded(fixtures.contentHash)}`,
          });
        await tx
          .delete(fixtures)
          .where(
            and(
              eq(fixtures.leagueId, league.id),
              eq(fixtures.phaseId, page.phaseId),
              notInArray(fixtures.externalId, [...unique.keys()]),
            ),
          );
      }

      if (d.standings && d.standings.rows.length > 0) {
        const byName = new Map(teamRows.map((t) => [teamNameKey(t.name), t.id]));
        await tx.delete(standings).where(eq(standings.leagueId, league.id));
        const rows = new Map(d.standings.rows.map((r) => [r.position, r]));
        await tx.insert(standings).values(
          [...rows.values()].map((r) => ({
            leagueId: league.id,
            position: r.position,
            teamId: byName.get(teamNameKey(r.teamName)) ?? null,
            teamName: r.teamName,
            points: r.points,
            played: r.played,
            won: r.won,
            lost: r.lost,
            setsWon: r.setsWon,
            setsLost: r.setsLost,
            pointsFor: r.pointsFor,
            pointsAgainst: r.pointsAgainst,
            setRatio: r.setRatio,
            pointRatio: r.pointRatio,
            byResult: r.byResult,
            updatedAt: now,
          })),
        );
      }
    });
    await this.saveValidators(d.cache);
  }

  /** Team pages and logos missing or older than 7 days; returns a warning for the ones that failed (or null). */
  private async refreshTeams(leagueId: string): Promise<string | null> {
    const cutoff = new Date(this.o.now().getTime() - TEAM_DETAILS_MAX_AGE_MS);
    const stale = (at: Date | null) => at === null || at < cutoff;
    const teams = await this.o.db.select().from(leagueTeams).where(eq(leagueTeams.leagueId, leagueId));
    let pageFailures = 0;
    let logoFailures = 0;
    let logoMissing = 0;
    for (const team of teams) {
      await this.renewLease(leagueId);
      if (stale(team.detailsFetchedAt)) {
        try {
          await this.refreshTeamPage(team);
        } catch (err) {
          if (!isLeagueError(err)) throw err;
          pageFailures++;
          this.o.log.warn({ teamId: team.id, reason: err.message }, 'pagina della squadra non letta');
        }
      }
      if (stale(team.logoFetchedAt)) {
        try {
          if ((await this.refreshLogo(team)) === 'missing') logoMissing++;
        } catch (err) {
          if (!isLeagueError(err)) throw err;
          logoFailures++;
          this.o.log.warn({ teamId: team.id, reason: err.message }, 'logo della squadra non salvato');
        }
      }
    }
    const parts = [
      pageFailures > 0 ? `${pageFailures} pagine squadra non lette` : null,
      logoFailures > 0 ? `${logoFailures} loghi non validi o non scaricati` : null,
      logoMissing > 0 ? `${logoMissing} loghi assenti sul sito` : null,
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? `Aggiornato con avvisi: ${parts.join(', ')}` : null;
  }

  private async refreshTeamPage(team: TeamRow): Promise<void> {
    const res = await this.page(teamUrl(team.externalId), team.venue !== null);
    const now = this.o.now();
    if (res) {
      const parsed = parseTeam(res.text);
      await this.o.db
        .update(leagueTeams)
        .set({
          venue: parsed.venue,
          venueAddress: parsed.venueAddress,
          city: parsed.city,
          detailsFetchedAt: now,
          updatedAt: now,
        })
        .where(eq(leagueTeams.id, team.id));
      await this.saveValidators([{ url: res.url, validators: res.validators }]);
    } else await this.o.db.update(leagueTeams).set({ detailsFetchedAt: now }).where(eq(leagueTeams.id, team.id));
  }

  /**
   * Downloads the logo, checks it from its bytes (PNG, JPEG, WebP, strict SVG) and stores it by its sha256;
   * `missing` for the placeholder of the site (the stored logo, if any, stays).
   */
  private async refreshLogo(team: TeamRow): Promise<'stored' | 'unchanged' | 'missing'> {
    const url = logoUrl(team.externalId);
    const kind: DownloadKind = 'logo';
    const res = await this.o.fetcher.get(url, kind, team.logoId ? await this.validators(url.toString()) : null);
    const now = this.o.now();
    if (res.status === 'not-modified') {
      await this.o.db.update(leagueTeams).set({ logoFetchedAt: now }).where(eq(leagueTeams.id, team.id));
      return 'unchanged';
    }
    let info;
    try {
      info = inspectImage(res.body);
    } catch (err) {
      if (!(err instanceof ImageRejected)) throw err;
      // Tried again next week; the logo already stored (if any) stays.
      await this.o.db.update(leagueTeams).set({ logoFetchedAt: now }).where(eq(leagueTeams.id, team.id));
      throw new LeagueFormatError(`Logo non valido (${err.message})`);
    }
    if (info.width < LOGO_MIN_SIDE || info.height < LOGO_MIN_SIDE) {
      await this.o.db.update(leagueTeams).set({ logoFetchedAt: now }).where(eq(leagueTeams.id, team.id));
      return 'missing';
    }
    const sha256 = createHash('sha256').update(res.body).digest('hex');
    await writeLeagueLogoFile(this.o.assetsDir, sha256, res.body);
    const [logo] = await this.o.db
      .insert(teamLogos)
      .values({ sha256, mime: info.mime, width: info.width, height: info.height, bytes: res.body.length })
      .onConflictDoUpdate({ target: teamLogos.sha256, set: { downloadedAt: now } })
      .returning({ id: teamLogos.id });
    if (!logo) throw new Error('logo not stored');
    await this.o.db
      .update(leagueTeams)
      .set({ logoId: logo.id, logoFetchedAt: now, updatedAt: now })
      .where(eq(leagueTeams.id, team.id));
    await this.saveValidators([{ url: url.toString(), validators: res.validators }]);
    return 'stored';
  }
}

/** Columns rewritten when a downloaded match differs from the stored one. */
const FIXTURE_UPDATED_COLUMNS = [
  'number',
  'phaseId',
  'phase',
  'round',
  'roundLabel',
  'startsAt',
  'homeTeamId',
  'awayTeamId',
  'venue',
  'venueCity',
  'venueAddress',
  'status',
  'homeSets',
  'awaySets',
  'setScores',
  'providerMatchId',
  'note',
  'contentHash',
  'updatedAt',
] as const;

function fixtureValues(
  leagueId: string,
  f: ParsedFixture,
  teamId: Map<number, string>,
  now: Date,
): typeof fixtures.$inferInsert {
  const home = teamId.get(f.home.externalId);
  const away = teamId.get(f.away.externalId);
  if (!home || !away) throw new Error('fixture team not stored');
  return {
    leagueId,
    externalId: f.externalId,
    number: f.number,
    phaseId: f.phaseId,
    phase: f.phase,
    round: f.round,
    roundLabel: f.roundLabel,
    startsAt: f.startsAt ? new Date(f.startsAt) : null,
    homeTeamId: home,
    awayTeamId: away,
    venue: f.venue,
    venueCity: f.venueCity,
    venueAddress: f.venueAddress,
    status: f.status,
    homeSets: f.homeSets,
    awaySets: f.awaySets,
    setScores: null,
    providerMatchId: f.providerMatchId,
    note: f.note,
    contentHash: createHash('sha256').update(JSON.stringify(f)).digest('hex'),
    updatedAt: now,
  };
}
