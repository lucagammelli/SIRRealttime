import { parseDvw } from '@arenalive/dvw-parser';
import type {
  CalendarResponse,
  ClubFixture,
  ClubLeagueOption,
  ClubResponse,
  ClubSyncResponse,
  ClubTeam,
  ClubTeamsResponse,
  PendingMatch,
  ScheduleResponse,
} from '@arenalive/shared';
import {
  adminAssetPath,
  clubFixtureState,
  IdParamSchema,
  LinkMatchFixtureRequestSchema,
  movedByLeague,
  publicTeamLogoPath,
  resolveBranding,
  resolveClubProfile,
  suggestedOurTeamName,
  UpdateClubProfileRequestSchema,
  UpdateClubRequestSchema,
} from '@arenalive/shared';
import { and, asc, count, desc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { adminLogos, broadcastOf, clubLook, effectiveStartSql, publicSchedule, upcomingOf } from '../club.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import {
  assets,
  clientFixtures,
  leagues,
  leagueTeams,
  matches,
  shareTokens,
  tenantLeagues,
  tenants,
} from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { seriesLeagueIds } from '../leagues/seasons.js';
import { dvwDayKey, parseDvwDate } from '../leagues/match.js';
import { canStayLive, lockTenantMatches } from '../matchLock.js';
import { requireRole } from '../security.js';
import { ensureShortCode } from '../shareCodes.js';
import { announceFixture, closeNotBroadcast, refreshClub } from '../state.js';
import { lockClientAssets } from './branding.js';
import {
  adminTenantId,
  findTenant,
  forgetTenants,
  hostTenant,
  publicBaseUrlFor,
  tenantDisplayName,
  tenantScope,
} from '../tenancy.js';
import { leagueSyncState } from './leagues.js';

type TeamRow = typeof leagueTeams.$inferSelect;
type LeagueRow = typeof leagues.$inferSelect;

/** Most `.dvw` to confirm listed in «Calendario» (the most recent). */
const PENDING_LIST_LIMIT = 50;

export const teamOf = (t: TeamRow): ClubTeam => ({
  id: t.id,
  name: t.name,
  city: t.city,
  logoUrl: t.logoId ? publicTeamLogoPath(t.logoId) : null,
});

/** Cache of the browsers for the public schedule (the server keeps its own copy for the same time). */
const SCHEDULE_BROWSER_CACHE = 'public, max-age=60';

/**
 * Public data of the club of the client of the hostname for the blocks «Prossima partita» and «Classifica»: no token,
 * public data only (teams, logos, time, venue, short links, standings), never anything of the matches. Without a
 * club: empty, valid answer.
 */
export function clubPublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/public/tenant/schedule',
    { config: perMinute(ctx.rateLimits.public) },
    async (request, reply): Promise<ScheduleResponse> => {
      const tenant = await hostTenant(ctx, request);
      if (!tenant) throw notFound();
      let schedule = ctx.caches.schedule.get(tenant.id);
      if (!schedule) {
        const base = publicBaseUrlFor(ctx.config.publicBaseUrl, tenant.hostnames);
        schedule = await publicSchedule(ctx.db, ctx.config.shareCodeSecret, tenant.id, base, ctx.now());
        ctx.caches.schedule.set(tenant.id, schedule);
      }
      void reply.header('cache-control', SCHEDULE_BROWSER_CACHE);
      return schedule;
    },
  );
}

/**
 * The club of the client (admin): its championships and teams («Club»), its matches of the calendar with their links
 * and the `.dvw` to confirm («Calendario»). The championships are common to every client and added by the superadmin
 * (`POST /api/admin/leagues`): a client chooses among the known ones. Every query on the data of the client goes
 * through `tenantScope`.
 */
export function clubRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };
  // Reading for every user of the client (`viewer` included), changes only for `admin`.
  const viewer = { config: admin.config, preHandler: requireRole(ctx, 'viewer') };

  const optionOf = (l: LeagueRow, teamCount: number): ClubLeagueOption => ({
    id: l.id,
    externalId: l.externalId,
    season: l.season,
    name: l.name,
    teamCount,
    sync: leagueSyncState(ctx, l),
  });

  const clubOf = async (tenantId: string): Promise<ClubResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    const branding = resolveBranding(tenant.branding);
    const [all, counts, choices] = await Promise.all([
      ctx.db.select().from(leagues).orderBy(desc(leagues.season), asc(leagues.externalId)),
      ctx.db.select({ id: leagueTeams.leagueId, n: count() }).from(leagueTeams).groupBy(leagueTeams.leagueId),
      ctx.db
        .select({ choice: tenantLeagues, team: leagueTeams })
        .from(tenantLeagues)
        .leftJoin(leagueTeams, eq(leagueTeams.id, tenantLeagues.leagueTeamId))
        .where(tenantScope(tenantLeagues, tenantId))
        .orderBy(asc(tenantLeagues.createdAt)),
    ]);
    const teamCount = new Map(counts.map((c) => [c.id, c.n]));
    const options = all.map((l) => optionOf(l, teamCount.get(l.id) ?? 0));
    const byId = new Map(options.map((o) => [o.id, o]));
    const logo = branding.logoMark ?? branding.logoMain;
    return {
      name: tenantDisplayName(tenant, branding),
      logoUrl: logo ? adminAssetPath(logo) : null,
      displayName: branding.displayName,
      logoMark: branding.logoMark,
      ourTeam: branding.ourTeam,
      profile: resolveClubProfile(tenant.clubProfile),
      leagues: choices.flatMap(({ choice, team }) => {
        const league = byId.get(choice.leagueId);
        return league ? [{ league, team: team ? teamOf(team) : null }] : [];
      }),
      available: options,
    };
  };

  app.get('/api/admin/club', viewer, async (request): Promise<ClubResponse> => clubOf(adminTenantId(request)));

  app.get('/api/admin/club/leagues/:id/teams', viewer, async (request): Promise<ClubTeamsResponse> => {
    adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const [league] = await ctx.db.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, id)).limit(1);
    if (!league) throw notFound();
    const rows = await ctx.db
      .select()
      .from(leagueTeams)
      .where(eq(leagueTeams.leagueId, id))
      .orderBy(asc(leagueTeams.name));
    return { teams: rows.map(teamOf) };
  });

  /**
   * Replaces the championships of the client and its team in each; «nostra squadra» of the graphics, when empty, is
   * filled from the first team chosen. Then the matches of the club are copied again (with their links).
   */
  app.put('/api/admin/club', admin, async (request): Promise<ClubResponse> => {
    const tenantId = adminTenantId(request);
    const body = validate(UpdateClubRequestSchema, request.body);
    // A team chosen in one championship of the series (a group of A3) takes away the other ones of the series.
    const stored = await findTenant(ctx, { id: tenantId });
    const seriesIds = new Set(stored ? seriesLeagueIds(resolveClubProfile(stored.clubProfile)) : []);
    const ofSeries = body.leagues.filter((l) => seriesIds.has(l.leagueId));
    const keep = ofSeries.find((l) => l.teamId !== null);
    if (keep) body.leagues = body.leagues.filter((l) => !seriesIds.has(l.leagueId) || l === keep);
    const ids = body.leagues.map((l) => l.leagueId);
    const known = ids.length
      ? await ctx.db.select({ id: leagues.id }).from(leagues).where(inArray(leagues.id, ids))
      : [];
    if (known.length !== ids.length) throw badRequest('Richiesta non valida: campionato');
    const chosenTeams: TeamRow[] = [];
    for (const choice of body.leagues) {
      if (!choice.teamId) continue;
      const [team] = await ctx.db
        .select()
        .from(leagueTeams)
        .where(and(eq(leagueTeams.id, choice.teamId), eq(leagueTeams.leagueId, choice.leagueId)))
        .limit(1);
      if (!team) throw badRequest('Richiesta non valida: squadra');
      chosenTeams.push(team);
    }
    let brandingChanged = false;
    await ctx.db.transaction(async (tx) => {
      await tx
        .delete(tenantLeagues)
        .where(tenantScope(tenantLeagues, tenantId, ids.length ? notInArray(tenantLeagues.leagueId, ids) : undefined));
      for (const choice of body.leagues) {
        await tx
          .insert(tenantLeagues)
          .values({ tenantId, leagueId: choice.leagueId, leagueTeamId: choice.teamId })
          .onConflictDoUpdate({
            target: [tenantLeagues.tenantId, tenantLeagues.leagueId],
            set: { leagueTeamId: choice.teamId },
          });
      }
      const first = chosenTeams[0];
      const [row] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, tenantId));
      const branding = resolveBranding(row?.branding);
      const suggested = first ? suggestedOurTeamName(first) : null;
      if (suggested && branding.ourTeam.code === null && branding.ourTeam.name === null) {
        await tx
          .update(tenants)
          .set({ branding: { ...branding, ourTeam: { code: null, name: suggested } } })
          .where(eq(tenants.id, tenantId));
        brandingChanged = true;
      }
    });
    if (brandingChanged) forgetTenants(ctx);
    await refreshClub(ctx, tenantId);
    request.log.info({ tenantId, userId: request.user?.id, leagues: ids.length }, 'campionati del club salvati');
    return clubOf(tenantId);
  });

  /** «Aggiorna calendario»: updates the championships of the client (only those), in the background. */
  app.post(
    '/api/admin/club/sync',
    { config: perMinute(ctx.rateLimits.leagueSync), preHandler: admin.preHandler },
    async (request, reply): Promise<ClubSyncResponse> => {
      const tenantId = adminTenantId(request);
      const choices = await ctx.db
        .select({ leagueId: tenantLeagues.leagueId })
        .from(tenantLeagues)
        .where(tenantScope(tenantLeagues, tenantId));
      let started = 0;
      let busy = 0;
      for (const c of choices) {
        if (await ctx.leagues.begin(c.leagueId, { standings: 'always' })) started++;
        else busy++;
      }
      // What is already downloaded is copied at once; each update copies again when it ends.
      await refreshClub(ctx, tenantId);
      request.log.info({ tenantId, userId: request.user?.id, started, busy }, 'aggiornamento del calendario del club');
      void reply.code(202);
      return { started, busy };
    },
  );

  /**
   * Profile of the club: name shown, square logo (an image `logo` of the client), «nostra squadra» (all three in the
   * branding) and series, coverage, team logos (`tenants.club_profile`). The public pages see it at once: the links of
   * the matches no longer broadcast stop working and their spectators are disconnected.
   */
  app.put('/api/admin/club/profile', admin, async (request): Promise<ClubResponse> => {
    const tenantId = adminTenantId(request);
    const body = validate(UpdateClubProfileRequestSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      if (body.logoMark) {
        const [asset] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(tenantScope(assets, tenantId, eq(assets.id, body.logoMark), eq(assets.kind, 'logo')))
          .limit(1);
        if (!asset) throw badRequest('Richiesta non valida: logoMark');
      }
      const [row] = await tx
        .select({ branding: tenants.branding, clubProfile: tenants.clubProfile })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (!row) throw notFound();
      // Gender, series, championships and the notice of the new season are the server's: kept from the database.
      const profile = {
        ...resolveClubProfile(row.clubProfile),
        coverage: body.profile.coverage,
        teamLogos: body.profile.teamLogos,
      };
      const branding = {
        ...resolveBranding(row.branding),
        displayName: body.displayName,
        logoMark: body.logoMark,
        ourTeam: body.ourTeam,
      };
      await tx.update(tenants).set({ branding, clubProfile: profile }).where(eq(tenants.id, tenantId));
    });
    forgetTenants(ctx);
    // «Nostra squadra» and the coverage change the link of the `.dvw` still to confirm: looked for again at once.
    await refreshClub(ctx, tenantId);
    await closeNotBroadcast(ctx, tenantId);
    request.log.info({ tenantId, userId: request.user?.id }, 'profilo del club salvato');
    return clubOf(tenantId);
  });

  app.get('/api/admin/calendar', viewer, async (request): Promise<CalendarResponse> => {
    const tenantId = adminTenantId(request);
    const tenant = await findTenant(ctx, { id: tenantId });
    const base = publicBaseUrlFor(ctx.config.publicBaseUrl, tenant?.hostnames ?? []);
    const look = await clubLook(ctx.db, tenantId);
    const [rows, links, linked, pendingRows, leagueRows] = await Promise.all([
      ctx.db
        .select()
        .from(clientFixtures)
        .where(tenantScope(clientFixtures, tenantId))
        .orderBy(
          sql`${effectiveStartSql} asc nulls last`,
          // `n<official number>`: by number (shorter first), not as text.
          sql`length(${clientFixtures.fixtureExternalId})`,
          asc(clientFixtures.fixtureExternalId),
        ),
      ctx.db
        .select()
        .from(shareTokens)
        .where(tenantScope(shareTokens, tenantId, isNotNull(shareTokens.clientFixtureId)))
        .orderBy(desc(shareTokens.createdAt)),
      ctx.db
        .select()
        .from(matches)
        .where(tenantScope(matches, tenantId, isNotNull(matches.clientFixtureId)))
        .orderBy(desc(matches.live), sql`${matches.liveSince} desc nulls last`, desc(matches.updatedAt)),
      ctx.db
        .select()
        .from(matches)
        .where(tenantScope(matches, tenantId, eq(matches.fixtureLink, 'pending')))
        .orderBy(desc(matches.updatedAt))
        .limit(PENDING_LIST_LIMIT),
      ctx.db
        .select({ id: leagues.id, name: leagues.name, season: leagues.season })
        .from(leagues)
        .innerJoin(clientFixtures, eq(clientFixtures.leagueId, leagues.id))
        .where(tenantScope(clientFixtures, tenantId))
        .groupBy(leagues.id),
    ]);
    const leagueById = new Map(leagueRows.map((l) => [l.id, l]));
    const matchOf = new Map<string, (typeof linked)[number]>();
    for (const m of linked) if (m.clientFixtureId && !matchOf.has(m.clientFixtureId)) matchOf.set(m.clientFixtureId, m);
    const linkOf = new Map<string, ClubFixture['link']>();
    for (const l of links) {
      if (!l.clientFixtureId) continue;
      if (l.revoked) {
        // A match whose link was revoked may have a new one (option switched on again): the valid one is shown,
        // otherwise the newest revoked one.
        if (!linkOf.has(l.clientFixtureId))
          linkOf.set(l.clientFixtureId, { id: l.id, revoked: true, shortCode: null, shortUrl: null });
        continue;
      }
      const { code } = await ensureShortCode(ctx.db, ctx.config.shareCodeSecret, l);
      linkOf.set(l.clientFixtureId, { id: l.id, revoked: false, shortCode: code, shortUrl: `${base}/l/${code}` });
    }
    const pending: PendingMatch[] = pendingRows.map((m) => {
      const date = m.header ? parseDvwDate(parseDvw(m.header).match.date) : null;
      return {
        id: m.id,
        matchKey: m.matchKey,
        live: m.live,
        homeName: m.state?.teams.home.name ?? null,
        awayName: m.state?.teams.away.name ?? null,
        date: date ? dvwDayKey(date) : null,
        createdAt: m.createdAt.toISOString(),
        candidates: m.fixtureCandidates ?? [],
      };
    });
    const doubtful = new Set(pending.flatMap((p) => p.candidates.map((c) => c.clientFixtureId)));
    const list: ClubFixture[] = rows.map((r) => {
      const m = matchOf.get(r.id);
      const league = r.leagueId ? leagueById.get(r.leagueId) : undefined;
      const match = m
        ? {
            id: m.id,
            live: m.live,
            status: m.state?.status ?? null,
            homeName: m.state?.teams.home.name ?? null,
            awayName: m.state?.teams.away.name ?? null,
            setsWon: m.state ? { home: m.state.setsWon.home, away: m.state.setsWon.away } : null,
            link: m.fixtureLink ?? 'auto',
          }
        : null;
      return {
        // The admin sees every logo, whatever «Loghi delle squadre».
        ...upcomingOf(r, adminLogos(look)),
        id: r.id,
        officialStartsAt: r.startsAt ? r.startsAt.toISOString() : null,
        dateOverridden: r.overrideStartsAt !== null,
        dateOverriddenAt: r.overriddenAt ? r.overriddenAt.toISOString() : null,
        movedByLeague: movedByLeague(r),
        league: r.leagueId ? { id: r.leagueId, name: league?.name ?? r.leagueName, season: league?.season ?? 0 } : null,
        origin: r.origin,
        kind: r.manualKind,
        broadcast: r.broadcast,
        broadcasted: broadcastOf(r, look.coverage),
        hidden: r.hidden,
        logos: {
          our: r.ourLogoAssetId ? { id: r.ourLogoAssetId, url: adminAssetPath(r.ourLogoAssetId) } : null,
          opponent: r.opponentLogoAssetId
            ? { id: r.opponentLogoAssetId, url: adminAssetPath(r.opponentLogoAssetId) }
            : null,
        },
        state: clubFixtureState({
          removed: r.removedAt !== null,
          fixtureStatus: r.status,
          match: match ? { live: match.live, status: match.status } : null,
          pending: !match && doubtful.has(r.id),
        }),
        link: linkOf.get(r.id) ?? null,
        match,
      };
    });
    return { fixtures: list, pending };
  });

  /**
   * The match of the calendar of a `.dvw` chosen by the admin (null: «nessuna», a friendly match). A live `.dvw`
   * stays live only if no other one is live in the chosen group (the court on air is never switched off by a
   * confirmation); the clients of the links involved are told at once.
   */
  app.put('/api/admin/matches/:id/fixture', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(LinkMatchFixtureRequestSchema, request.body);
    const previous = await ctx.db.transaction(async (tx) => {
      await lockTenantMatches(tx, tenantId);
      const [m] = await tx
        .select({ id: matches.id, live: matches.live, clientFixtureId: matches.clientFixtureId })
        .from(matches)
        // A simulated match is never linked to the calendar.
        .where(tenantScope(matches, tenantId, eq(matches.id, id), eq(matches.simulated, false)))
        .limit(1);
      if (!m) throw notFound();
      if (body.clientFixtureId) {
        const [f] = await tx
          .select({ id: clientFixtures.id })
          .from(clientFixtures)
          .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, body.clientFixtureId)))
          .limit(1);
        if (!f) throw badRequest('Richiesta non valida: clientFixtureId');
      }
      // The match already live in the chosen group keeps its link: a confirmation never switches it off.
      const live = m.live && (await canStayLive(tx, tenantId, m.id, body.clientFixtureId));
      await tx
        .update(matches)
        .set({ clientFixtureId: body.clientFixtureId, fixtureLink: body.clientFixtureId ? 'manual' : 'none', live })
        .where(tenantScope(matches, tenantId, eq(matches.id, m.id)));
      return m.clientFixtureId;
    });
    for (const cf of new Set([previous, body.clientFixtureId])) if (cf) await announceFixture(ctx, tenantId, cf);
    request.log.info(
      { matchId: id, clientFixtureId: body.clientFixtureId, userId: request.user?.id },
      'partita abbinata',
    );
    return reply.code(204).send();
  });
}
