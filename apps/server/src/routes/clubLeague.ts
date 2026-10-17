import type { ClubLeagueStatus } from '@sir/shared';
import { resolveClubProfile, SelectClubLeagueRequestSchema, seriesById } from '@sir/shared';
import { asc, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { leagues, leagueTeams, tenantLeagues } from '../db/index.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { LeagueFetchError } from '../leagues/fetcher.js';
import { LeagueFormatError } from '../leagues/legavolley.js';
import { seriesLeagueIds, linkSeries } from '../leagues/seasons.js';
import { requireRole } from '../security.js';
import { refreshClub } from '../state.js';
import { adminTenantId, findTenant, forgetTenants, tenantScope } from '../tenancy.js';
import { teamOf } from './club.js';
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
      let found;
      try {
        found = await ctx.catalog.resolve(series);
      } catch (err) {
        if (err instanceof LeagueFormatError) throw new HttpError(502, 'LEAGUE_FORMAT', err.message);
        if (err instanceof LeagueFetchError)
          throw new HttpError(502, 'LEAGUE_UNAVAILABLE', 'Il sito della Lega non risponde: riprova tra poco');
        throw err;
      }
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
