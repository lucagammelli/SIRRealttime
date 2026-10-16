import type { ParsedMatch } from '@sir/dvw-parser';
import { parseDvw } from '@sir/dvw-parser';
import type {
  FixtureCandidate,
  FixtureLink,
  ScheduledMessage,
  ScheduleFixture,
  ScheduleResponse,
  ScheduleStandings,
  UpcomingFixture,
} from '@sir/shared';
import { EMPTY_SCHEDULE, ourTeamSide, publicTeamLogoPath, resolveBranding, SCHEDULE_MAX_FIXTURES } from '@sir/shared';
import { and, asc, eq, gt, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from './db/index.js';
import {
  clientFixtures,
  fixtures,
  leagues,
  leagueTeams,
  matches,
  shareTokens,
  standings,
  tenantLeagues,
  tenants,
} from './db/index.js';
import { generateToken, hashToken } from './lib/tokens.js';
import type { CalendarCandidate } from './leagues/match.js';
import { dvwFacts, linkFixture } from './leagues/match.js';
import { romeParts } from './leagues/romeTime.js';
import type { Tx } from './matchLock.js';
import { canStayLive, lockTenantMatches } from './matchLock.js';
import { ensureShortCode, insertShareToken } from './shareCodes.js';
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

/** A match that began this long ago and has no `.dvw` yet is still «coming» (the page of the club waits for it). */
const SCHEDULE_GRACE_MS = 4 * 3_600_000;
/** Matches of the calendar read to find the first ones that are still to be played. */
const SCHEDULE_CANDIDATES = 20;

/**
 * Public data of the club of a client for the blocks «Prossima partita» and «Classifica»: its next
 * SCHEDULE_MAX_FIXTURES matches still to play (the ones with a `.dvw` being played now are flagged `live`; the ones
 * already played or finished are left out) with their short link, and the standings of its main championship: the
 * one of its next match (the nearest in time among its championships), otherwise the first with standings.
 * Public data only; without a club it is empty.
 */
export async function publicSchedule(
  db: Db,
  secret: string,
  tenantId: string,
  baseUrl: string,
  now: Date,
): Promise<ScheduleResponse> {
  const choices = await db
    .select({ leagueId: tenantLeagues.leagueId, teamId: tenantLeagues.leagueTeamId, name: leagues.name })
    .from(tenantLeagues)
    .innerJoin(leagues, eq(leagues.id, tenantLeagues.leagueId))
    .where(tenantScope(tenantLeagues, tenantId, sql`${tenantLeagues.leagueTeamId} is not null`))
    .orderBy(asc(tenantLeagues.createdAt));
  if (choices.length === 0) return EMPTY_SCHEDULE;
  const rows = await db
    .select()
    .from(clientFixtures)
    .where(
      tenantScope(
        clientFixtures,
        tenantId,
        isNull(clientFixtures.removedAt),
        eq(clientFixtures.status, 'scheduled'),
        gte(clientFixtures.startsAt, new Date(now.getTime() - SCHEDULE_GRACE_MS)),
      ),
    )
    .orderBy(asc(clientFixtures.startsAt), asc(clientFixtures.id))
    .limit(SCHEDULE_CANDIDATES);
  const ids = rows.map((r) => r.id);
  const [links, played] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(shareTokens)
          .where(
            tenantScope(
              shareTokens,
              tenantId,
              inArray(shareTokens.clientFixtureId, ids),
              eq(shareTokens.revoked, false),
              or(isNull(shareTokens.expiresAt), gt(shareTokens.expiresAt, now)),
            ),
          ),
        db
          .select({
            clientFixtureId: matches.clientFixtureId,
            live: matches.live,
            status: sql<string | null>`${matches.state}->>'status'`,
          })
          .from(matches)
          .where(tenantScope(matches, tenantId, inArray(matches.clientFixtureId, ids))),
      ])
    : [[], []];
  const live = new Set(played.filter((m) => m.live).map((m) => m.clientFixtureId));
  const finished = new Set(played.filter((m) => m.status === 'finished').map((m) => m.clientFixtureId));
  const linkOf = new Map(links.map((l) => [l.clientFixtureId, l]));
  const fixtureList: ScheduleFixture[] = [];
  for (const row of rows) {
    if (fixtureList.length >= SCHEDULE_MAX_FIXTURES) break;
    // A finished `.dvw` stays «live» as the link of the client; the match is over all the same.
    if (finished.has(row.id)) continue;
    const link = linkOf.get(row.id);
    const code = link ? (await ensureShortCode(db, secret, link)).code : null;
    const { startsAt, home, away, ourSide, venue, venueCity, roundLabel, leagueName } = upcomingOf(row);
    fixtureList.push({
      startsAt,
      home,
      away,
      ourSide,
      venue,
      venueCity,
      roundLabel,
      leagueName,
      live: live.has(row.id),
      shortUrl: code ? `${baseUrl}/l/${code}` : null,
    });
  }
  // Main championship: the one of the nearest match, then the others in the order the client chose them.
  const first = rows[0]?.leagueId;
  const order = [...choices].sort((a, b) => Number(b.leagueId === first) - Number(a.leagueId === first));
  let standingsOut: ScheduleStandings | null = null;
  for (const choice of order) {
    const list = await db
      .select({ s: standings, logoId: leagueTeams.logoId })
      .from(standings)
      .leftJoin(leagueTeams, eq(leagueTeams.id, standings.teamId))
      .where(eq(standings.leagueId, choice.leagueId))
      .orderBy(asc(standings.position));
    if (list.length === 0) continue;
    standingsOut = {
      leagueName: choice.name,
      updatedAt: list[0]?.s.updatedAt.toISOString() ?? null,
      rows: list.map(({ s, logoId }) => ({
        position: s.position,
        teamName: s.teamName,
        points: s.points,
        played: s.played,
        won: s.won,
        lost: s.lost,
        setsWon: s.setsWon,
        setsLost: s.setsLost,
        logoUrl: logoPath(logoId),
        ours: s.teamId !== null && s.teamId === choice.teamId,
      })),
    };
    break;
  }
  return { fixtures: fixtureList, standings: standingsOut };
}
