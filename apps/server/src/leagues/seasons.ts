import type { ClubProfile, LeagueSeries } from '@arenalive/shared';
import { CLUB_MAX_LEAGUES, resolveClubProfile, seriesById } from '@arenalive/shared';
import { eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { leagues, leagueTeams, tenantLeagues, tenants } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { refreshClub } from '../state.js';
import { forgetTenants, tenantScope } from '../tenancy.js';
import type { CatalogChampionship } from './catalog.js';
import { teamNameKey } from './sync.js';

type LeagueRow = typeof leagues.$inferSelect;

/** Pure: the championships of the series of a club (A3 has two groups). */
export function seriesLeagueIds(profile: Pick<ClubProfile, 'leagueId' | 'leagueIds'>): string[] {
  if (profile.leagueIds.length > 0) return profile.leagueIds;
  return profile.leagueId ? [profile.leagueId] : [];
}

/**
 * Adds the championships of a series (known ones are reused) and links them to the club: the ones of the series chosen
 * before go away; if the club already has a team in one of them, only that championship stays. The profile keeps
 * gender, series and championships. Returns the rows of the championships of the series.
 */
export async function linkSeries(
  ctx: AppContext,
  tenantId: string,
  series: LeagueSeries,
  found: readonly CatalogChampionship[],
): Promise<LeagueRow[]> {
  await ctx.db
    .insert(leagues)
    .values(found.map((c) => ({ provider: 'legavolley' as const, externalId: c.externalId, season: c.season })))
    .onConflictDoNothing({ target: [leagues.provider, leagues.externalId] });
  const rows = await ctx.db
    .select()
    .from(leagues)
    .where(
      inArray(
        leagues.externalId,
        found.map((c) => c.externalId),
      ),
    );
  const ordered = found.flatMap((c) => rows.filter((r) => r.externalId === c.externalId));
  const ids = ordered.map((r) => r.id);
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select({ clubProfile: tenants.clubProfile }).from(tenants).where(eq(tenants.id, tenantId));
    const profile = resolveClubProfile(row?.clubProfile);
    const previous = seriesLeagueIds(profile).filter((id) => !ids.includes(id));
    if (previous.length > 0)
      await tx
        .delete(tenantLeagues)
        .where(tenantScope(tenantLeagues, tenantId, inArray(tenantLeagues.leagueId, previous)));
    const mine = await tx.select().from(tenantLeagues).where(tenantScope(tenantLeagues, tenantId));
    const withTeam = mine.filter((m) => ids.includes(m.leagueId) && m.leagueTeamId !== null);
    const toLink = withTeam.length > 0 ? [] : ids.filter((id) => !mine.some((m) => m.leagueId === id));
    if (mine.length + toLink.length > CLUB_MAX_LEAGUES) throw badRequest('Troppi campionati: togline uno dal Club');
    if (toLink.length > 0)
      await tx
        .insert(tenantLeagues)
        .values(toLink.map((leagueId) => ({ tenantId, leagueId, leagueTeamId: null })))
        .onConflictDoNothing({ target: [tenantLeagues.tenantId, tenantLeagues.leagueId] });
    await tx
      .update(tenants)
      .set({
        clubProfile: {
          ...profile,
          gender: series.gender,
          seriesId: series.id,
          series: series.label,
          leagueId: ids[0] ?? null,
          leagueIds: ids,
          newSeason: false,
        },
      })
      .where(eq(tenants.id, tenantId));
  });
  return ordered;
}

/**
 * New season: for the clubs with a series, when the catalog now names other championships for it, they are added and
 * downloaded; once ready the club moves to them with the same team (same external id, otherwise same name). When the
 * team is not there the old championship stays and the profile says `newSeason` («Nuova stagione: scegli di nuovo la
 * squadra»). Runs in the nightly update; errors of a club are logged and do not stop the others.
 */
export async function advanceSeasons(ctx: AppContext, log: FastifyBaseLogger): Promise<void> {
  const rows = await ctx.db.select({ id: tenants.id, clubProfile: tenants.clubProfile }).from(tenants);
  for (const t of rows) {
    const profile = resolveClubProfile(t.clubProfile);
    const series = profile.seriesId ? seriesById(profile.seriesId) : undefined;
    if (!series) continue;
    try {
      await advanceClub(ctx, t.id, profile, series);
    } catch (err) {
      log.warn({ err, tenantId: t.id }, 'cambio di stagione del club non riuscito');
    }
  }
}

async function advanceClub(
  ctx: AppContext,
  tenantId: string,
  profile: ClubProfile,
  series: LeagueSeries,
): Promise<void> {
  const current = seriesLeagueIds(profile);
  const found = await ctx.catalog.resolve(series);
  const known = await ctx.db
    .select()
    .from(leagues)
    .where(
      inArray(
        leagues.externalId,
        found.map((c) => c.externalId),
      ),
    );
  if (known.length === found.length && known.every((k) => current.includes(k.id)) && current.length === known.length)
    return;
  if (profile.newSeason) return;
  // The new championships are added (without touching the club) and downloaded now.
  await ctx.db
    .insert(leagues)
    .values(found.map((c) => ({ provider: 'legavolley' as const, externalId: c.externalId, season: c.season })))
    .onConflictDoNothing({ target: [leagues.provider, leagues.externalId] });
  const next = await ctx.db
    .select()
    .from(leagues)
    .where(
      inArray(
        leagues.externalId,
        found.map((c) => c.externalId),
      ),
    );
  for (const l of next) if (l.lastSuccessAt === null) await ctx.leagues.syncLeague(l.id, { standings: 'always' });
  const fresh = await ctx.db
    .select()
    .from(leagues)
    .where(
      inArray(
        leagues.id,
        next.map((l) => l.id),
      ),
    );
  if (fresh.some((l) => l.lastSuccessAt === null)) return; // tried again the next night
  const ids = fresh.map((l) => l.id);
  // The team of the club in the old season.
  const [old] = await ctx.db
    .select({ team: leagueTeams })
    .from(tenantLeagues)
    .innerJoin(leagueTeams, eq(leagueTeams.id, tenantLeagues.leagueTeamId))
    .where(
      tenantScope(
        tenantLeagues,
        tenantId,
        isNotNull(tenantLeagues.leagueTeamId),
        inArray(tenantLeagues.leagueId, current),
      ),
    )
    .limit(1);
  const candidates = await ctx.db.select().from(leagueTeams).where(inArray(leagueTeams.leagueId, ids));
  const same = old
    ? (candidates.find((c) => c.externalId === old.team.externalId) ??
      candidates.find((c) => teamNameKey(c.name) === teamNameKey(old.team.name)))
    : undefined;
  await ctx.db.transaction(async (tx) => {
    if (same) {
      await tx
        .delete(tenantLeagues)
        .where(
          tenantScope(
            tenantLeagues,
            tenantId,
            inArray(tenantLeagues.leagueId, current),
            notInArray(tenantLeagues.leagueId, [same.leagueId]),
          ),
        );
      await tx
        .insert(tenantLeagues)
        .values({ tenantId, leagueId: same.leagueId, leagueTeamId: same.id })
        .onConflictDoUpdate({
          target: [tenantLeagues.tenantId, tenantLeagues.leagueId],
          set: { leagueTeamId: same.id },
        });
    }
    const [row] = await tx.select({ clubProfile: tenants.clubProfile }).from(tenants).where(eq(tenants.id, tenantId));
    const latest = resolveClubProfile(row?.clubProfile);
    await tx
      .update(tenants)
      .set({
        clubProfile: same
          ? { ...latest, leagueId: ids[0] ?? null, leagueIds: ids, newSeason: false }
          : { ...latest, newSeason: true },
      })
      .where(eq(tenants.id, tenantId));
  });
  forgetTenants(ctx);
  await refreshClub(ctx, tenantId);
}
