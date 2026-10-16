import type { ParsedMatch } from '@sir/dvw-parser';
import { parseDvw } from '@sir/dvw-parser';
import type { FixtureCandidate, FixtureLink, ScheduledMessage, UpcomingFixture } from '@sir/shared';
import { ourTeamSide, publicTeamLogoPath, resolveBranding } from '@sir/shared';
import { and, asc, eq, gte, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from './db/index.js';
import {
  clientFixtures,
  fixtures,
  leagues,
  leagueTeams,
  matches,
  shareTokens,
  tenantLeagues,
  tenants,
} from './db/index.js';
import { generateToken, hashToken } from './lib/tokens.js';
import type { CalendarCandidate } from './leagues/match.js';
import { dvwFacts, linkFixture } from './leagues/match.js';
import { romeParts } from './leagues/romeTime.js';
import type { Tx } from './matchLock.js';
import { canStayLive, lockTenantMatches } from './matchLock.js';
import { insertShareToken } from './shareCodes.js';
import { tenantScope } from './tenancy.js';

/**
 * The club of a client and its matches of the calendar (`client_fixtures`): copied from the calendars of its
 * championships at every update and at every change of its choices, each with its public link, and linked to the
 * `.dvw` sent by the agents (`matches.client_fixture_id`).
 */

type ClientFixtureRow = typeof clientFixtures.$inferSelect;

/** The match of the calendar of a `.dvw`, as stored in `matches`. */
export interface FixtureLinkValues {
  clientFixtureId: string | null;
  fixtureLink: FixtureLink | null;
  fixtureCandidates: FixtureCandidate[] | null;
}

/** A `.dvw` linked to a match of the calendar by an update (to tell the connected clients). */
export interface LinkedMatch {
  tenantId: string;
  matchId: string;
  clientFixtureId: string;
}

const DAY_MS = 86_400_000;
const LABEL_MAX = 100;

/** Pure: `dd/mm/yyyy` in Italy. */
export function romeDateText(date: Date): string {
  const p = romeParts(date);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

/** Pure: label of the link of a match of the calendar, «Avversario – data» (the date only when known). */
export function fixtureLabel(row: Pick<ClientFixtureRow, 'ourSide' | 'homeName' | 'awayName' | 'startsAt'>): string {
  const opponent = row.ourSide === 'home' ? row.awayName : row.homeName;
  const date = row.startsAt ? ` – ${romeDateText(row.startsAt)}` : '';
  return `${opponent.slice(0, LABEL_MAX - date.length).trim()}${date}`;
}

const logoPath = (id: string | null): string | null => (id ? publicTeamLogoPath(id) : null);

/** Pure: what the public page shows of a match of the calendar before its `.dvw` arrives. */
export function upcomingOf(row: ClientFixtureRow): UpcomingFixture {
  return {
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    home: { name: row.homeName, logoUrl: logoPath(row.homeLogoId) },
    away: { name: row.awayName, logoUrl: logoPath(row.awayLogoId) },
    ourSide: row.ourSide,
    venue: row.venue,
    venueCity: row.venueCity,
    roundLabel: row.roundLabel,
    leagueName: row.leagueName,
    status: row.status,
    result: row.homeSets !== null && row.awaySets !== null ? { home: row.homeSets, away: row.awaySets } : null,
    inCalendar: row.removedAt === null,
  };
}

/** «Prossima partita» of a match of the calendar of the client; null when it is not one of the client. */
export async function scheduledMessage(
  db: Db,
  tenantId: string,
  clientFixtureId: string,
): Promise<ScheduledMessage | null> {
  const [row] = await db
    .select()
    .from(clientFixtures)
    .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, clientFixtureId)))
    .limit(1);
  return row ? { type: 'scheduled', fixture: upcomingOf(row) } : null;
}

const candidateOf = (r: ClientFixtureRow): CalendarCandidate => ({
  id: r.id,
  startsAt: r.startsAt,
  ourSide: r.ourSide,
  homeName: r.homeName,
  awayName: r.awayName,
  homeCity: r.homeCity,
  awayCity: r.awayCity,
});

/**
 * Under the lock of the client: the match of the calendar of a parsed `.dvw` (`linkFixture`), among the matches of
 * the club still in the calendar around the date of the file; null when the client has no match of the calendar at
 * all (no club configured: nothing to decide).
 */
export async function evaluateFixtureLink(
  tx: Tx,
  tenantId: string,
  parsed: ParsedMatch,
): Promise<FixtureLinkValues | null> {
  const [any] = await tx
    .select({ id: clientFixtures.id })
    .from(clientFixtures)
    .where(tenantScope(clientFixtures, tenantId))
    .limit(1);
  if (!any) return null;
  const [tenant] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, tenantId));
  const facts = dvwFacts(parsed);
  facts.ourSide = ourTeamSide(facts.teams, resolveBranding(tenant?.branding).ourTeam);
  let window;
  if (facts.date) {
    const day = Date.UTC(facts.date.year, facts.date.month - 1, facts.date.day);
    window = and(
      gte(clientFixtures.startsAt, new Date(day - 2 * DAY_MS)),
      lt(clientFixtures.startsAt, new Date(day + 3 * DAY_MS)),
    );
  }
  const rows = await tx
    .select()
    .from(clientFixtures)
    .where(tenantScope(clientFixtures, tenantId, isNull(clientFixtures.removedAt), window))
    // Deterministic order: candidates with the same score are always proposed in the same order.
    .orderBy(asc(clientFixtures.startsAt), asc(clientFixtures.id));
  const outcome = linkFixture(facts, rows.map(candidateOf));
  return outcome.kind === 'linked'
    ? { clientFixtureId: outcome.clientFixtureId, fixtureLink: 'auto', fixtureCandidates: outcome.candidates }
    : { clientFixtureId: null, fixtureLink: 'pending', fixtureCandidates: outcome.candidates };
}

/**
 * Copies the matches of the team of the club from the calendars of its championships into `client_fixtures`
 * (idempotent: one row per match, updated in place), marks `removed_at` the ones no longer there (their link stays),
 * gives a public link to every match that has none, and looks again for the match of the calendar of the `.dvw`
 * still to confirm. One client at a time (lock of its live matches). Returns the `.dvw` linked now.
 */
export async function refreshClientFixtures(
  db: Db,
  secret: string,
  tenantId: string,
  now: Date,
): Promise<LinkedMatch[]> {
  return db.transaction(async (tx) => {
    await lockTenantMatches(tx, tenantId);
    const home = alias(leagueTeams, 'home_team');
    const away = alias(leagueTeams, 'away_team');
    const choices = await tx
      .select({ leagueId: tenantLeagues.leagueId, teamId: tenantLeagues.leagueTeamId, leagueName: leagues.name })
      .from(tenantLeagues)
      .innerJoin(leagues, eq(leagues.id, tenantLeagues.leagueId))
      .where(tenantScope(tenantLeagues, tenantId));
    const kept: string[] = [];
    for (const choice of choices) {
      const teamId = choice.teamId;
      if (!teamId) continue;
      const rows = await tx
        .select({ f: fixtures, home, away })
        .from(fixtures)
        .innerJoin(home, eq(home.id, fixtures.homeTeamId))
        .innerJoin(away, eq(away.id, fixtures.awayTeamId))
        .where(
          and(
            eq(fixtures.leagueId, choice.leagueId),
            or(eq(fixtures.homeTeamId, teamId), eq(fixtures.awayTeamId, teamId)),
          ),
        );
      if (rows.length === 0) continue;
      const values = rows.map(({ f, home: h, away: a }) => ({
        tenantId,
        leagueId: choice.leagueId,
        fixtureExternalId: f.externalId,
        fixtureId: f.id,
        removedAt: null,
        startsAt: f.startsAt,
        ourSide: f.homeTeamId === teamId ? ('home' as const) : ('away' as const),
        homeName: h.name,
        awayName: a.name,
        homeCity: h.city,
        awayCity: a.city,
        homeLogoId: h.logoId,
        awayLogoId: a.logoId,
        venue: f.venue,
        venueCity: f.venueCity,
        roundLabel: f.roundLabel,
        leagueName: choice.leagueName,
        status: f.status,
        homeSets: f.homeSets,
        awaySets: f.awaySets,
        updatedAt: now,
      }));
      const saved = await tx
        .insert(clientFixtures)
        .values(values)
        .onConflictDoUpdate({
          target: [clientFixtures.tenantId, clientFixtures.leagueId, clientFixtures.fixtureExternalId],
          set: Object.fromEntries(
            UPDATED_COLUMNS.map((key) => [key, sql`excluded.${sql.identifier(clientFixtures[key].name)}`]),
          ),
        })
        .returning({ id: clientFixtures.id });
      kept.push(...saved.map((r) => r.id));
    }
    await tx
      .update(clientFixtures)
      .set({ removedAt: now, updatedAt: now })
      .where(
        tenantScope(
          clientFixtures,
          tenantId,
          isNull(clientFixtures.removedAt),
          kept.length > 0 ? notInArray(clientFixtures.id, kept) : undefined,
        ),
      );
    await ensureFixtureLinks(tx, secret, tenantId);
    return relinkPending(tx, tenantId);
  });
}

/** Columns rewritten when a match of the club is copied again. */
const UPDATED_COLUMNS = [
  'fixtureId',
  'removedAt',
  'startsAt',
  'ourSide',
  'homeName',
  'awayName',
  'homeCity',
  'awayCity',
  'homeLogoId',
  'awayLogoId',
  'venue',
  'venueCity',
  'roundLabel',
  'leagueName',
  'status',
  'homeSets',
  'awaySets',
  'updatedAt',
] as const;

/**
 * A public link for every match of the club without one (one per match: unique index). The long token is drawn and
 * thrown away (only its hash is stored, as for every link): these links are used by their short code and QR.
 */
async function ensureFixtureLinks(tx: Tx, secret: string, tenantId: string): Promise<void> {
  const missing = await tx
    .select({ row: clientFixtures })
    .from(clientFixtures)
    .leftJoin(shareTokens, eq(shareTokens.clientFixtureId, clientFixtures.id))
    .where(tenantScope(clientFixtures, tenantId, isNull(shareTokens.id), isNull(clientFixtures.removedAt)));
  for (const { row } of missing) {
    await insertShareToken(tx, secret, {
      tenantId,
      tokenHash: hashToken(generateToken()),
      matchId: null,
      clientFixtureId: row.id,
      label: fixtureLabel(row),
      expiresAt: null,
    });
  }
}

/** The `.dvw` still to confirm, looked for again in the calendar (it may have changed); the ones linked now. */
async function relinkPending(tx: Tx, tenantId: string): Promise<LinkedMatch[]> {
  const pending = await tx
    .select({ id: matches.id, header: matches.header, live: matches.live })
    .from(matches)
    .where(tenantScope(matches, tenantId, eq(matches.fixtureLink, 'pending')));
  const linked: LinkedMatch[] = [];
  if (pending.length === 0) return linked;
  for (const m of pending) {
    if (m.header === null) continue;
    const values = await evaluateFixtureLink(tx, tenantId, parseDvw(m.header));
    if (!values) continue;
    // Linked now to a match of the calendar already live on another `.dvw`: that one stays live, this one not.
    const live = m.live && (await canStayLive(tx, tenantId, m.id, values.clientFixtureId));
    await tx
      .update(matches)
      .set({ ...values, live })
      .where(eq(matches.id, m.id));
    if (values.clientFixtureId) linked.push({ tenantId, matchId: m.id, clientFixtureId: values.clientFixtureId });
  }
  return linked;
}

/** Clients that chose a championship. */
export async function tenantsOfLeague(db: Db, leagueId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tenantId: tenantLeagues.tenantId })
    .from(tenantLeagues)
    .where(eq(tenantLeagues.leagueId, leagueId));
  return rows.map((r) => r.tenantId);
}

/** Championships with a match of a club in `[from, to)` (the scheduler updates them every 10 minutes). */
export async function leaguesWithClubMatches(db: Db, from: Date, to: Date): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ leagueId: clientFixtures.leagueId })
    .from(clientFixtures)
    .where(and(gte(clientFixtures.startsAt, from), lt(clientFixtures.startsAt, to), isNull(clientFixtures.removedAt)));
  return new Set(rows.map((r) => r.leagueId));
}
