import type {
  LeagueDetailResponse,
  LeagueFixture,
  LeagueListResponse,
  LeagueSummary,
  LeagueSyncState,
  LeagueTeam,
  StandingRow,
} from '@sir/shared';
import {
  AssetMimeSchema,
  CreateLeagueRequestSchema,
  IdParamSchema,
  LeagueProviderSchema,
  publicTeamLogoPath,
} from '@sir/shared';
import { asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { readLeagueLogoFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { fixtures, leagues, leagueTeams, standings, teamLogos } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { leaguesWithClubMatches } from '../club.js';
import { romeDayAt } from '../leagues/romeTime.js';
import { nextSyncAt } from '../leagues/scheduler.js';
import { SYNC_LEASE_MS } from '../leagues/sync.js';
import { requireRole } from '../security.js';
import { IMMUTABLE_CACHE, SVG_CSP } from './branding.js';

type LeagueRow = typeof leagues.$inferSelect;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Outcome of the last update of a championship and whether one is running now (its lease is not older than 15 min). */
export function leagueSyncState(ctx: AppContext, l: LeagueRow): LeagueSyncState {
  const running = l.syncStartedAt !== null && ctx.now().getTime() - l.syncStartedAt.getTime() < SYNC_LEASE_MS;
  return {
    status: l.lastStatus,
    message: l.lastMessage,
    at: iso(l.lastSyncAt),
    lastSuccessAt: iso(l.lastSuccessAt),
    running,
  };
}

/** Championships with a match of a club today (Rome day): updated every 10 minutes. */
async function matchTodaySet(ctx: AppContext): Promise<Set<string>> {
  const day = romeDayAt(ctx.now(), 0);
  return leaguesWithClubMatches(ctx.db, day.at, day.nextDay);
}

function summary(
  ctx: AppContext,
  l: LeagueRow,
  teamCount: number,
  fixtureCount: number,
  today: Set<string>,
): LeagueSummary {
  const matchToday = today.has(l.id);
  return {
    id: l.id,
    provider: LeagueProviderSchema.parse(l.provider),
    externalId: l.externalId,
    season: l.season,
    name: l.name,
    phases: l.phases,
    teamCount,
    fixtureCount,
    sync: leagueSyncState(ctx, l),
    createdAt: l.createdAt.toISOString(),
    plan: {
      nextSyncAt: ctx.config.leagueSync
        ? nextSyncAt(ctx.now(), { lastSyncAt: l.lastSyncAt, matchToday }).toISOString()
        : null,
      matchToday,
    },
  };
}

async function counts(ctx: AppContext): Promise<{ teams: Map<string, number>; fixtures: Map<string, number> }> {
  const [t, f] = await Promise.all([
    ctx.db.select({ id: leagueTeams.leagueId, n: count() }).from(leagueTeams).groupBy(leagueTeams.leagueId),
    ctx.db.select({ id: fixtures.leagueId, n: count() }).from(fixtures).groupBy(fixtures.leagueId),
  ]);
  return { teams: new Map(t.map((r) => [r.id, r.n])), fixtures: new Map(f.map((r) => [r.id, r.n])) };
}

async function summaryOf(ctx: AppContext, id: string): Promise<LeagueSummary> {
  const [row] = await ctx.db.select().from(leagues).where(eq(leagues.id, id)).limit(1);
  if (!row) throw notFound();
  const [[t], [f], today] = await Promise.all([
    ctx.db.select({ n: count() }).from(leagueTeams).where(eq(leagueTeams.leagueId, id)),
    ctx.db.select({ n: count() }).from(fixtures).where(eq(fixtures.leagueId, id)),
    matchTodaySet(ctx),
  ]);
  return summary(ctx, row, t?.n ?? 0, f?.n ?? 0, today);
}

/**
 * Championships downloaded from the official sites (common to every client): superadmin only for now. The update
 * («Aggiorna ora») runs in the background: the answer is 202 with `sync.running` true.
 */
export function leagueRoutes(app: FastifyInstance, ctx: AppContext): void {
  const superadmin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'superadmin') };

  app.get('/api/admin/leagues', superadmin, async (): Promise<LeagueListResponse> => {
    const [rows, c, today] = await Promise.all([
      ctx.db.select().from(leagues).orderBy(desc(leagues.season), asc(leagues.externalId)),
      counts(ctx),
      matchTodaySet(ctx),
    ]);
    return {
      leagues: rows.map((l) => summary(ctx, l, c.teams.get(l.id) ?? 0, c.fixtures.get(l.id) ?? 0, today)),
    };
  });

  app.post('/api/admin/leagues', superadmin, async (request, reply): Promise<LeagueSummary> => {
    const body = validate(CreateLeagueRequestSchema, request.body);
    const [row] = await ctx.db
      .insert(leagues)
      .values({ provider: body.provider, externalId: body.externalId, season: body.season })
      .onConflictDoNothing({ target: [leagues.provider, leagues.externalId] })
      .returning();
    if (!row) throw conflict('Campionato già presente');
    request.log.info({ leagueId: row.id, externalId: row.externalId, season: row.season }, 'campionato aggiunto');
    void reply.code(201);
    return summary(ctx, row, 0, 0, new Set());
  });

  app.get('/api/admin/leagues/:id', superadmin, async (request): Promise<LeagueDetailResponse> => {
    const { id } = validate(IdParamSchema, request.params);
    const league = await summaryOf(ctx, id);
    const [teamRows, fixtureRows, standingRows] = await Promise.all([
      ctx.db.select().from(leagueTeams).where(eq(leagueTeams.leagueId, id)).orderBy(asc(leagueTeams.name)),
      ctx.db
        .select()
        .from(fixtures)
        .where(eq(fixtures.leagueId, id))
        .orderBy(asc(fixtures.number), asc(fixtures.startsAt), asc(fixtures.externalId)),
      ctx.db.select().from(standings).where(eq(standings.leagueId, id)).orderBy(asc(standings.position)),
    ]);
    const teamsById = new Map(teamRows.map((t) => [t.id, t]));
    const ref = (teamId: string) => {
      const t = teamsById.get(teamId);
      // The foreign key keeps every team of a match in the same championship.
      if (!t) throw new Error('fixture team missing');
      return { teamId, externalId: t.externalId, name: t.name };
    };
    const teams: LeagueTeam[] = teamRows.map((t) => ({
      id: t.id,
      externalId: t.externalId,
      name: t.name,
      shortName: t.shortName,
      city: t.city,
      venue: t.venue,
      venueAddress: t.venueAddress,
      logoUrl: t.logoId ? publicTeamLogoPath(t.logoId) : null,
    }));
    const list: LeagueFixture[] = fixtureRows.map((f) => ({
      id: f.id,
      externalId: f.externalId,
      number: f.number,
      phaseId: f.phaseId,
      phase: f.phase,
      round: f.round,
      roundLabel: f.roundLabel,
      startsAt: iso(f.startsAt),
      home: ref(f.homeTeamId),
      away: ref(f.awayTeamId),
      venue: f.venue,
      venueCity: f.venueCity,
      status: f.status,
      result:
        f.homeSets !== null && f.awaySets !== null
          ? { homeSets: f.homeSets, awaySets: f.awaySets, sets: f.setScores ?? null }
          : null,
      providerMatchId: f.providerMatchId,
      note: f.note,
      updatedAt: f.updatedAt.toISOString(),
    }));
    const rows: StandingRow[] = standingRows.map((s) => ({
      position: s.position,
      teamId: s.teamId,
      teamName: s.teamName,
      points: s.points,
      played: s.played,
      won: s.won,
      lost: s.lost,
      setsWon: s.setsWon,
      setsLost: s.setsLost,
      pointsFor: s.pointsFor,
      pointsAgainst: s.pointsAgainst,
      setRatio: s.setRatio,
      pointRatio: s.pointRatio,
    }));
    return {
      league,
      teams,
      fixtures: list,
      standings: rows,
      standingsUpdatedAt: iso(standingRows[0]?.updatedAt ?? null),
    };
  });

  /** «Aggiorna ora»: 202 with the update started, 409 when one is already running. */
  app.post(
    '/api/admin/leagues/:id/sync',
    { config: perMinute(ctx.rateLimits.leagueSync), preHandler: superadmin.preHandler },
    async (request, reply): Promise<LeagueSummary> => {
      const { id } = validate(IdParamSchema, request.params);
      await summaryOf(ctx, id);
      const run = await ctx.leagues.begin(id, { standings: 'always' });
      if (!run) throw conflict('Aggiornamento già in corso');
      request.log.info({ leagueId: id, userId: request.user?.id }, 'aggiornamento del campionato avviato');
      void reply.code(202);
      return summaryOf(ctx, id);
    },
  );
}

/**
 * Downloaded team logos: public (the same for every client), type from the database (recognized from the bytes at
 * download), never sniffed; SVG with a CSP that blocks scripts and loads. The id changes with the file: cached a year.
 */
export function leaguePublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/public/team-logos/:id', { config: perMinute(ctx.rateLimits.public) }, async (request, reply) => {
    const params = IdParamSchema.safeParse(request.params);
    if (!params.success) throw notFound();
    const [row] = await ctx.db.select().from(teamLogos).where(eq(teamLogos.id, params.data.id)).limit(1);
    const mime = row ? AssetMimeSchema.safeParse(row.mime) : null;
    if (!row || !mime?.success) throw notFound();
    const file = await readLeagueLogoFile(ctx.config.assetsDir, row.sha256);
    if (!file) {
      request.log.warn({ logoId: row.id }, 'file di un logo di squadra mancante');
      throw notFound();
    }
    void reply
      .header('content-type', mime.data === 'image/svg+xml' ? 'image/svg+xml; charset=utf-8' : mime.data)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('cache-control', IMMUTABLE_CACHE);
    if (mime.data === 'image/svg+xml') void reply.header('content-security-policy', SVG_CSP);
    return reply.send(file);
  });
}
