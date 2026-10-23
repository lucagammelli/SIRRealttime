import type { ClubCompetitionsResponse, ClubLeagueStatus, ClubResponse, LeagueSeries } from '@arenalive/shared';
import {
  AddClubCompetitionRequestSchema,
  CLUB_COMPETITIONS_PATH,
  CLUB_MAX_LEAGUES,
  resolveClubProfile,
  SelectClubLeagueRequestSchema,
  seriesById,
  seriesCompetitions,
} from '@arenalive/shared';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { leagues, leagueTeams, tenantLeagues } from '../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { LeagueFetchError } from '../leagues/fetcher.js';
import { LeagueFormatError } from '../leagues/legavolley.js';
import { seriesLeagueIds, linkSeries } from '../leagues/seasons.js';
import { lockTenantMatches } from '../matchLock.js';
import { requireRole } from '../security.js';
import { refreshClub } from '../state.js';
import { adminTenantId, findTenant, forgetTenants, tenantScope } from '../tenancy.js';
import { clubResponse, teamOf } from './club.js';
import { leagueSyncState } from './leagues.js';

const NONE: ClubLeagueStatus = {
  state: 'none',
  message: null,
  gender: null,
  series: null,
  leagueId: null,
  leagueName: null,
  season: null,
  teams: [],
  teamId: null,
};

/**
 * The series of the club chosen from the catalog (`POST /api/admin/club/league`): the server finds the championship
 * of the season in course on the official site, adds it when it is not known (the superadmin can still add the others,
 * cups and play off, by `IdCampionato`) and downloads it in the background with the lock of the updates. The state and
 * the teams are read with `GET /api/admin/club/league`. Everything is scoped to the client of the session.
 */
export function clubLeagueRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };
  const viewer = { config: admin.config, preHandler: requireRole(ctx, 'viewer') };

  const statusOf = async (tenantId: string): Promise<ClubLeagueStatus> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    const profile = resolveClubProfile(tenant.clubProfile);
    const none = { ...NONE, gender: profile.gender, series: profile.seriesId };
    const ids = seriesLeagueIds(profile);
    if (ids.length === 0) return none;
    const rows = await ctx.db.select().from(leagues).where(inArray(leagues.id, ids));
    const first = ids.map((id) => rows.find((r) => r.id === id)).find((r) => r !== undefined);
    if (!first) return none;
    const syncs = rows.map((r) => leagueSyncState(ctx, r));
    // Data downloaded once stay valid while a later update runs or fails.
    const state: ClubLeagueStatus['state'] = syncs.every((x) => x.lastSuccessAt !== null)
      ? 'ready'
      : syncs.some((x) => x.lastSuccessAt === null && x.status === 'error' && !x.running)
        ? 'error'
        : 'downloading';
    const [teamRows, choice] = await Promise.all([
      state === 'ready'
        ? ctx.db.select().from(leagueTeams).where(inArray(leagueTeams.leagueId, ids)).orderBy(asc(leagueTeams.name))
        : Promise.resolve([]),
      ctx.db
        .select({ teamId: tenantLeagues.leagueTeamId })
        .from(tenantLeagues)
        .where(tenantScope(tenantLeagues, tenantId, inArray(tenantLeagues.leagueId, ids))),
    ]);
    return {
      state,
      message: syncs.map((x) => x.message).find((m) => m !== null) ?? null,
      gender: profile.gender,
      series: profile.seriesId,
      leagueId: first.id,
      leagueName: first.name,
      season: first.season,
      teams: teamRows.map((t) => ({ ...teamOf(t), leagueId: t.leagueId })),
      teamId: choice.map((c) => c.teamId).find((t) => t !== null) ?? null,
    };
  };

  /** The catalog of the site as an answer: a page that changed or a site that does not answer is a clear 502. */
  const fromSite = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (err) {
      if (err instanceof LeagueFormatError) throw new HttpError(502, 'LEAGUE_FORMAT', err.message);
      if (err instanceof LeagueFetchError)
        throw new HttpError(502, 'LEAGUE_UNAVAILABLE', 'Il sito della Lega non risponde: riprova tra poco');
      throw err;
    }
  };

  /**
   * The series of the club, its championship (the first one: its page on the site lists the other competitions of
   * the series) and the `IdCampionato` of every championship of the club. 409 when no series is chosen yet.
   */
  const seriesOf = async (tenantId: string) => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    const profile = resolveClubProfile(tenant.clubProfile);
    const series: LeagueSeries | undefined = profile.seriesId ? seriesById(profile.seriesId) : undefined;
    const ids = seriesLeagueIds(profile);
    const rows = ids.length ? await ctx.db.select().from(leagues).where(inArray(leagues.id, ids)) : [];
    const first = ids.map((id) => rows.find((r) => r.id === id)).find((r) => r !== undefined);
    if (!series || !first) throw conflict('Scegli prima la serie del club');
    const mine = await ctx.db
      .select({ externalId: leagues.externalId })
      .from(tenantLeagues)
      .innerJoin(leagues, eq(leagues.id, tenantLeagues.leagueId))
      .where(tenantScope(tenantLeagues, tenantId));
    return { series, first, linked: new Set(mine.map((m) => m.externalId)) };
  };

  /** The competitions of the series of the club on the site, of the season in course, not chosen yet. */
  const competitionsOf = async (tenantId: string): Promise<ClubCompetitionsResponse> => {
    const { series, first, linked } = await seriesOf(tenantId);
    const menu = await fromSite(() => ctx.catalog.competitionsOf(first.externalId));
    return {
      competitions: seriesCompetitions(series, menu.championships)
        .filter((c) => !linked.has(c.externalId))
        .map((c) => ({ externalId: c.externalId, name: c.name, season: menu.season })),
    };
  };

  /**
   * «Aggiungi competizione»: the competitions of the series of the club on the official site (cups, Supercoppa, play
   * off… of the season in course), read from the page of its championship. Admin only (it may read the site).
   */
  app.get(CLUB_COMPETITIONS_PATH, admin, async (request): Promise<ClubCompetitionsResponse> =>
    competitionsOf(adminTenantId(request)),
  );

  /**
   * Adds one of those competitions to the club: only an `IdCampionato` of the list (checked again on the site, 400
   * otherwise), within CLUB_MAX_LEAGUES (409). The championship is added when not known (as the superadmin does) and
   * downloaded in the background; the team of the club is chosen by itself as soon as its teams are known
   * (`pickCompetitionTeams`). Answers the club (201; 200 when already chosen).
   */
  app.post(
    CLUB_COMPETITIONS_PATH,
    { config: perMinute(ctx.rateLimits.leagueSync), preHandler: admin.preHandler },
    async (request, reply): Promise<ClubResponse> => {
      const tenantId = adminTenantId(request);
      const body = validate(AddClubCompetitionRequestSchema, request.body);
      const { series, first, linked } = await seriesOf(tenantId);
      if (!linked.has(body.externalId)) {
        const menu = await fromSite(() => ctx.catalog.competitionsOf(first.externalId));
        const found = seriesCompetitions(series, menu.championships).find((c) => c.externalId === body.externalId);
        if (!found) throw badRequest('Competizione non trovata sul sito della Lega per la serie del club');
        await ctx.db
          .insert(leagues)
          .values({ provider: 'legavolley', externalId: found.externalId, season: menu.season })
          .onConflictDoNothing({ target: [leagues.provider, leagues.externalId] });
      }
      const [league] = await ctx.db.select().from(leagues).where(eq(leagues.externalId, body.externalId)).limit(1);
      if (!league) throw notFound();
      const created = await ctx.db.transaction(async (tx) => {
        // The lock of the matches of the client: also the copy of its calendar takes it.
        await lockTenantMatches(tx, tenantId);
        const [already] = await tx
          .select({ leagueId: tenantLeagues.leagueId })
          .from(tenantLeagues)
          .where(tenantScope(tenantLeagues, tenantId, eq(tenantLeagues.leagueId, league.id)))
          .limit(1);
        if (already) return false;
        const [n] = await tx.select({ n: count() }).from(tenantLeagues).where(tenantScope(tenantLeagues, tenantId));
        if ((n?.n ?? 0) >= CLUB_MAX_LEAGUES)
          throw conflict(`Al massimo ${CLUB_MAX_LEAGUES} campionati: togline uno prima di aggiungerne un altro`);
        await tx.insert(tenantLeagues).values({ tenantId, leagueId: league.id, leagueTeamId: null });
        return true;
      });
      const sync = leagueSyncState(ctx, league);
      const started =
        sync.lastSuccessAt === null &&
        !sync.running &&
        (await ctx.leagues.begin(league.id, { standings: 'always' })) !== null;
      // Already downloaded: the team is chosen now; otherwise at the end of the download (each update copies again).
      await refreshClub(ctx, tenantId);
      request.log.info(
        { tenantId, userId: request.user?.id, leagueId: league.id, externalId: league.externalId, started, created },
        'competizione aggiunta al club',
      );
      void reply.code(created ? 201 : 200);
      return clubResponse(ctx, tenantId);
    },
  );

  app.get('/api/admin/club/league', viewer, async (request): Promise<ClubLeagueStatus> => {
    return statusOf(adminTenantId(request));
  });

  app.post(
    '/api/admin/club/league',
    { config: perMinute(ctx.rateLimits.leagueSync), preHandler: admin.preHandler },
    async (request, reply): Promise<ClubLeagueStatus> => {
      const tenantId = adminTenantId(request);
      const body = validate(SelectClubLeagueRequestSchema, request.body);
      const series = seriesById(body.series);
      if (!series || series.gender !== body.gender) throw badRequest('Richiesta non valida: serie');
      const found = await fromSite(() => ctx.catalog.resolve(series));
      const rows = await linkSeries(ctx, tenantId, series, found);
      forgetTenants(ctx);
      // Already downloaded (by another club or the superadmin): reused. Otherwise the download starts now, in the
      // background (the lease of the update is the lock: nothing starts twice).
      let started = 0;
      for (const league of rows) {
        const sync = leagueSyncState(ctx, league);
        if (sync.lastSuccessAt === null && !sync.running)
          if ((await ctx.leagues.begin(league.id, { standings: 'always' })) !== null) started++;
      }
      await refreshClub(ctx, tenantId);
      request.log.info(
        { tenantId, userId: request.user?.id, leagues: rows.map((r) => r.id), series: series.id, started },
        'serie del club scelta',
      );
      const status = await statusOf(tenantId);
      void reply.code(status.state === 'downloading' ? 202 : 200);
      return status;
    },
  );
}
