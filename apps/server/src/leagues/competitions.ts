import type { ClubProfile, OurTeam } from '@arenalive/shared';
import { normalizeTeamText, resolveBranding, resolveClubProfile } from '@arenalive/shared';
import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { leagueTeams, tenantLeagues, tenants } from '../db/index.js';
import type { Tx } from '../matchLock.js';
import { tenantScope } from '../tenancy.js';
import { teamNameKey } from './sync.js';

/**
 * The other competitions of a club (cups, Supercoppa, play off… of its series, «Aggiungi competizione»): every
 * championship of the club that is not one of its series. Its team there is chosen by itself when recognized.
 */

type TeamRow = typeof leagueTeams.$inferSelect;

/** Pure: the championships of the series of a club (A3 has two groups). */
export function seriesLeagueIds(profile: Pick<ClubProfile, 'leagueId' | 'leagueIds'>): string[] {
  if (profile.leagueIds.length > 0) return profile.leagueIds;
  return profile.leagueId ? [profile.leagueId] : [];
}

/**
 * Pure: the team of the club among the teams of a competition: the same team of the site (external id) as `ref`, its
 * team in the series, otherwise the same name (with `ref` not found: none); without `ref`, the only team whose name contains the name of «nostra
 * squadra». null when none, or more than one, matches.
 */
export function findClubTeam<T extends Pick<TeamRow, 'externalId' | 'name'>>(
  candidates: readonly T[],
  ref: Pick<TeamRow, 'externalId' | 'name'> | null,
  ourTeam: OurTeam | null,
): T | null {
  if (ref) {
    const same =
      candidates.find((c) => c.externalId === ref.externalId) ??
      candidates.find((c) => teamNameKey(c.name) === teamNameKey(ref.name));
    if (same) return same;
    // The team of the series is known but not here: a short name («Perugia») could match another team.
    return null;
  }
  const name = ourTeam?.name ? normalizeTeamText(ourTeam.name) : '';
  if (!name) return null;
  const found = candidates.filter((c) => normalizeTeamText(c.name).includes(name));
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** The team of the club in its series (the first chosen), null when not chosen. */
export async function seriesTeamOf(
  db: Db | Tx,
  tenantId: string,
  seriesIds: readonly string[],
): Promise<TeamRow | null> {
  if (seriesIds.length === 0) return null;
  const [row] = await db
    .select({ team: leagueTeams })
    .from(tenantLeagues)
    .innerJoin(leagueTeams, eq(leagueTeams.id, tenantLeagues.leagueTeamId))
    .where(
      tenantScope(
        tenantLeagues,
        tenantId,
        isNotNull(tenantLeagues.leagueTeamId),
        inArray(tenantLeagues.leagueId, [...seriesIds]),
      ),
    )
    .limit(1);
  return row?.team ?? null;
}

/**
 * In the transaction of the copy of the calendar: for every other competition of the club without a team whose teams
 * are known (downloaded), the team of the club is chosen when recognized (`findClubTeam`). A competition without team
 * brings no match. Returns how many were chosen.
 */
export async function pickCompetitionTeams(tx: Tx, tenantId: string): Promise<number> {
  const [tenant] = await tx
    .select({ branding: tenants.branding, clubProfile: tenants.clubProfile })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) return 0;
  const seriesIds = seriesLeagueIds(resolveClubProfile(tenant.clubProfile));
  const missing = await tx
    .select({ leagueId: tenantLeagues.leagueId })
    .from(tenantLeagues)
    .where(
      tenantScope(
        tenantLeagues,
        tenantId,
        isNull(tenantLeagues.leagueTeamId),
        seriesIds.length > 0 ? notInArray(tenantLeagues.leagueId, seriesIds) : undefined,
      ),
    );
  if (missing.length === 0) return 0;
  const ref = await seriesTeamOf(tx, tenantId, seriesIds);
  const ourTeam = resolveBranding(tenant.branding).ourTeam;
  const candidates = await tx
    .select()
    .from(leagueTeams)
    .where(
      inArray(
        leagueTeams.leagueId,
        missing.map((m) => m.leagueId),
      ),
    );
  let chosen = 0;
  for (const m of missing) {
    const team = findClubTeam(
      candidates.filter((c) => c.leagueId === m.leagueId),
      ref,
      ourTeam,
    );
    if (!team) continue;
    await tx
      .update(tenantLeagues)
      .set({ leagueTeamId: team.id })
      .where(
        tenantScope(
          tenantLeagues,
          tenantId,
          and(eq(tenantLeagues.leagueId, m.leagueId), isNull(tenantLeagues.leagueTeamId)),
        ),
      );
    chosen++;
  }
  return chosen;
}
