import type { Side } from '@sir/volley-stats';
import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import {
  FixtureStatusSchema,
  LeagueExternalIdSchema,
  LeagueGenderSchema,
  LeagueSeasonSchema,
  LeagueSeriesIdSchema,
  LeagueSyncStateSchema,
  StandingRowSchema,
} from './leagues.js';
import type { OurTeam } from './ourTeam.js';
import { OUR_TEAM_NAME_MAX, ourTeamSide, OurTeamSchema } from './ourTeam.js';
import { plainText } from './strings.js';

/**
 * The club of a client: the championships it plays (one or more, e.g. regular season and play off), its team in each
 * of them, the matches of that team in the calendars («Calendario») with a public link each, and the link between the
 * `.dvw` sent by an agent and the match of the calendar.
 */

/** Most championships of one client. */
export const CLUB_MAX_LEAGUES = 8;

export const ClubSideSchema = z.enum(['home', 'away']);
export type ClubSide = z.infer<typeof ClubSideSchema>;

/** A championship chosen by the client and its team there (null: not chosen yet, no matches). */
export const ClubLeagueChoiceSchema = z.strictObject({
  leagueId: z.uuid(),
  teamId: z.uuid().nullable(),
});
export type ClubLeagueChoice = z.infer<typeof ClubLeagueChoiceSchema>;

/** `PUT /api/admin/club`: the championships of the client (replaced as a whole), each at most once. */
export const UpdateClubRequestSchema = z.strictObject({
  leagues: z
    .array(ClubLeagueChoiceSchema)
    .max(CLUB_MAX_LEAGUES)
    .refine((list) => new Set(list.map((l) => l.leagueId)).size === list.length, {
      message: 'campionato ripetuto',
    }),
});
export type UpdateClubRequest = z.infer<typeof UpdateClubRequestSchema>;

/** Team of a championship as shown in the choices and in the calendar. */
export const ClubTeamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string().nullable(),
  /** Public path of the downloaded logo, null when none. */
  logoUrl: z.string().nullable(),
});
export type ClubTeam = z.infer<typeof ClubTeamSchema>;

/**
 * Pure: text that recognizes the team of the club in the `.dvw` files («nostra squadra», searched inside the team
 * names): its city without the province («Perugia (PG)» → «Perugia»), otherwise the last word of its name (the
 * sponsors change, the city stays). null when there is nothing usable.
 */
export function suggestedOurTeamName(team: { name: string; city: string | null }): string | null {
  const city = team.city
    ?.replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = team.name.trim().split(/\s+/);
  const text = city || words[words.length - 1] || '';
  return text ? text.slice(0, OUR_TEAM_NAME_MAX) : null;
}

// --- Profile of the club: series, coverage of the matches, team logos -------------------------------------------

/**
 * Matches the client broadcasts: `homeAndAway` (default: nothing is hidden unless the client chooses it) or
 * `homeOnly` (the away matches are «non trasmesse»: link not active, out of the link of the `.dvw` and of «Prossima
 * partita»). Each match can override it (`FixtureBroadcastSchema`).
 */
export const ClubCoverageSchema = z.enum(['homeAndAway', 'homeOnly']);
export type ClubCoverage = z.infer<typeof ClubCoverageSchema>;

/**
 * Logos of the teams next to their names (scoreboard, «Prossima partita», calendar, standings): `all` ours and the
 * opponent's (default), `ours` only ours, `none` no logo.
 */
export const TeamLogosModeSchema = z.enum(['all', 'ours', 'none']);
export type TeamLogosMode = z.infer<typeof TeamLogosModeSchema>;

/** Longest series of the club («Serie A1 maschile»). */
export const CLUB_SERIES_MAX = 60;

/**
 * Profile of the club (jsonb `tenants.club_profile`); name, square logo and «nostra squadra» stay in the branding.
 * Every field has a default: the empty document reads as the defaults.
 */
export const ClubProfileSchema = z.strictObject({
  series: plainText(CLUB_SERIES_MAX).nullable().default(null),
  /** Gender and series chosen from the catalog (null: not chosen); `series` then holds the label of the catalog. */
  gender: LeagueGenderSchema.nullable().default(null),
  seriesId: LeagueSeriesIdSchema.nullable().default(null),
  /** Championship linked by the choice of the series (set by the server, `POST /api/admin/club/league`). */
  leagueId: z.uuid().nullable().default(null),
  /** Every championship of the series (A3 has two groups); `leagueId` is the first. */
  leagueIds: z.array(z.uuid()).max(CLUB_MAX_LEAGUES).default([]),
  /** A new season of the series was found and the team was not in it: the club must choose its team again. */
  newSeason: z.boolean().default(false),
  coverage: ClubCoverageSchema.default('homeAndAway'),
  teamLogos: TeamLogosModeSchema.default('all'),
});
export type ClubProfile = z.output<typeof ClubProfileSchema>;

/** Pure: a stored profile with the missing fields filled; an invalid one reads as the defaults. */
export function resolveClubProfile(document: unknown): ClubProfile {
  const parsed = ClubProfileSchema.safeParse(document ?? {});
  return parsed.success ? parsed.data : ClubProfileSchema.parse({});
}

/**
 * The part of the profile the client edits: coverage and team logos. Series, gender, championships and the notice of
 * the new season are managed by the server (`POST /api/admin/club/league`, the nightly update): they are not in the
 * request, and any such field sent is dropped.
 */
export const ClubProfileEditSchema = z.object({
  coverage: ClubCoverageSchema.default('homeAndAway'),
  teamLogos: TeamLogosModeSchema.default('all'),
});

/**
 * `PUT /api/admin/club/profile`: name shown (null: the name of the client), square logo (an image `logo` of the
 * client, null: none), «nostra squadra» of the `.dvw` files and the profile.
 */
export const UpdateClubProfileRequestSchema = z.strictObject({
  displayName: plainText(100).nullable(),
  logoMark: AssetIdSchema.nullable(),
  ourTeam: OurTeamSchema,
  profile: ClubProfileEditSchema,
});
export type UpdateClubProfileRequest = z.infer<typeof UpdateClubProfileRequestSchema>;

/** Logo of each side of a match (public path, null: no logo to show). */
export const TeamLogoPairSchema = z.object({ home: z.string().nullable(), away: z.string().nullable() });
export type TeamLogoPair = z.infer<typeof TeamLogoPairSchema>;

/**
 * Pure: the logo of a team, in this order: the one chosen for the match → the logo of the profile (only for our team)
 * → the public logo of the league → none (the blocks that have them show the initials).
 */
export function chooseTeamLogo(input: {
  ours: boolean;
  matchLogo: string | null;
  profileLogo: string | null;
  leagueLogo: string | null;
}): string | null {
  return input.matchLogo ?? (input.ours ? input.profileLogo : null) ?? input.leagueLogo ?? null;
}

/** Pure: whether the setting «Loghi delle squadre» shows the logo of our team or of the opponent. */
export function teamLogoShown(mode: TeamLogosMode, ours: boolean): boolean {
  return mode === 'all' || (mode === 'ours' && ours);
}

/** Pure: the logo to show for a team: `chooseTeamLogo`, then the setting decides (null: hidden or none). */
export function shownTeamLogo(mode: TeamLogosMode, input: Parameters<typeof chooseTeamLogo>[0]): string | null {
  return teamLogoShown(mode, input.ours) ? chooseTeamLogo(input) : null;
}

/**
 * Logos of a match for its public messages, already chosen (`chooseTeamLogo`) and filtered by the setting: `our` and
 * `opponent`, the side of the club in the calendar (null: no match of the calendar) and «nostra squadra» to find
 * our side in the `.dvw`.
 */
export interface MatchLogoInfo {
  our: string | null;
  opponent: string | null;
  calendarSide: ClubSide | null;
  ourTeam: OurTeam;
}

/**
 * Pure: the logos of the two sides of a `.dvw`. Our side: «nostra squadra» recognized in the file, otherwise the
 * side of the club in the calendar; unknown: no logos (never one on the wrong team).
 */
export function matchTeamLogos(
  info: MatchLogoInfo,
  teams: Record<Side, { name: string | null; code: string | null }>,
): TeamLogoPair {
  const ours = ourTeamSide(teams, info.ourTeam) ?? info.calendarSide;
  if (ours === 'home') return { home: info.our, away: info.opponent };
  if (ours === 'away') return { home: info.opponent, away: info.our };
  return { home: null, away: null };
}

/** A known championship (added by the superadmin) that a client can choose. */
export const ClubLeagueOptionSchema = z.object({
  id: z.uuid(),
  externalId: LeagueExternalIdSchema,
  season: LeagueSeasonSchema,
  /** Official name, null until the first good update. */
  name: z.string().nullable(),
  teamCount: z.number().int().nonnegative(),
  sync: LeagueSyncStateSchema,
});
export type ClubLeagueOption = z.infer<typeof ClubLeagueOptionSchema>;

export const ClubLeagueSchema = z.object({
  league: ClubLeagueOptionSchema,
  team: ClubTeamSchema.nullable(),
});
export type ClubLeague = z.infer<typeof ClubLeagueSchema>;

/** `GET /api/admin/club` (and the answer of PUT). */
export const ClubResponseSchema = z.object({
  /** Name shown for the club (display name of the graphics, otherwise the name of the client). */
  name: z.string(),
  /** Square or horizontal logo of the graphics, null when none. */
  logoUrl: z.string().nullable(),
  /** Name chosen by the client (display name of the graphics), null: the name of the client. */
  displayName: z.string().nullable().default(null),
  /** Square logo of the graphics (id of an image of the client), null when none. */
  logoMark: AssetIdSchema.nullable().default(null),
  /** «Nostra squadra» of the graphics (filled from the team of the club when it was empty). */
  ourTeam: OurTeamSchema,
  /** Series, coverage of the matches and team logos (missing in an older answer: the defaults). */
  profile: ClubProfileSchema.prefault({}),
  leagues: z.array(ClubLeagueSchema),
  /** Every known championship (the ones that can be chosen). */
  available: z.array(ClubLeagueOptionSchema),
});
export type ClubResponse = z.infer<typeof ClubResponseSchema>;

/** `GET /api/admin/club/leagues/:id/teams`. */
export const ClubTeamsResponseSchema = z.object({ teams: z.array(ClubTeamSchema) });
export type ClubTeamsResponse = z.infer<typeof ClubTeamsResponseSchema>;

/** `POST /api/admin/club/sync`: updates started and championships already being updated. */
export const ClubSyncResponseSchema = z.object({
  started: z.number().int().nonnegative(),
  busy: z.number().int().nonnegative(),
});
export type ClubSyncResponse = z.infer<typeof ClubSyncResponseSchema>;

/**
 * Link between a match (`.dvw`) and the calendar: `auto` found by the server, `manual` chosen by the admin,
 * `pending` to be confirmed (none or more candidates, or a doubtful one), `none` not a match of the calendar
 * (friendly match), chosen by the admin.
 */
export const FixtureLinkSchema = z.enum(['auto', 'manual', 'pending', 'none']);
export type FixtureLink = z.infer<typeof FixtureLinkSchema>;

/**
 * State of a match of the club in «Calendario»: `scheduled` not started, `live` being played (a `.dvw` is live),
 * `finished`, `postponed`, `pending` a `.dvw` of that day waits for a confirmation, `removed` no longer in the
 * calendar of the league (its link stays).
 */
export const ClubFixtureStateSchema = z.enum(['scheduled', 'live', 'finished', 'postponed', 'pending', 'removed']);
export type ClubFixtureState = z.infer<typeof ClubFixtureStateSchema>;

/** Pure: state of a match of the club from the calendar and from the `.dvw` linked to it (if any). */
export function clubFixtureState(input: {
  removed: boolean;
  fixtureStatus: z.infer<typeof FixtureStatusSchema>;
  match: { live: boolean; status: 'notStarted' | 'inProgress' | 'finished' | null } | null;
  pending: boolean;
}): ClubFixtureState {
  const { match } = input;
  if (match?.status === 'finished') return 'finished';
  if (match?.live) return 'live';
  if (input.removed) return 'removed';
  if (input.fixtureStatus === 'played') return 'finished';
  if (input.pending) return 'pending';
  if (input.fixtureStatus === 'postponed') return 'postponed';
  return 'scheduled';
}

export const ClubFixtureTeamSchema = z.object({ name: z.string(), logoUrl: z.string().nullable() });
export type ClubFixtureTeam = z.infer<typeof ClubFixtureTeamSchema>;

/** Sets of a played match (official result or the `.dvw`). */
export const ClubFixtureResultSchema = z.object({
  home: z.number().int().min(0).max(5),
  away: z.number().int().min(0).max(5),
});

/**
 * A match of the calendar as the public page shows it before the start («Prossima partita»): only public data of the
 * league (teams, logos, time, venue).
 */
export const UpcomingFixtureSchema = z.object({
  /** Start in UTC (`effectiveStartsAt`: the one changed by hand, otherwise the official one); null when not set yet. */
  startsAt: z.iso.datetime().nullable(),
  home: ClubFixtureTeamSchema,
  away: ClubFixtureTeamSchema,
  /** Side of the club. */
  ourSide: ClubSideSchema,
  venue: z.string().nullable(),
  venueCity: z.string().nullable(),
  /** Round as written by the league («1ª Giornata Andata»). */
  roundLabel: z.string(),
  leagueName: z.string().nullable(),
  status: FixtureStatusSchema,
  /** Official result when played without a `.dvw` here; null otherwise. */
  result: ClubFixtureResultSchema.nullable(),
  /** False when the match is no longer in the calendar of the league. */
  inCalendar: z.boolean(),
});
export type UpcomingFixture = z.infer<typeof UpcomingFixtureSchema>;

export const ClubFixtureLinkSchema = z.object({
  id: z.uuid(),
  revoked: z.boolean(),
  /** Short code and URL (`<base>/l/<code>`); null for a revoked link. */
  shortCode: z.string().nullable(),
  shortUrl: z.url().nullable(),
});

export const ClubFixtureMatchSchema = z.object({
  id: z.uuid(),
  live: z.boolean(),
  status: z.enum(['notStarted', 'inProgress', 'finished']).nullable(),
  homeName: z.string().nullable(),
  awayName: z.string().nullable(),
  setsWon: ClubFixtureResultSchema.nullable(),
  link: FixtureLinkSchema,
});

/** Where a match of the club comes from: the calendar of a championship, or added by the client. */
export const FixtureOriginSchema = z.enum(['league', 'manual']);
export type FixtureOrigin = z.infer<typeof FixtureOriginSchema>;

/** Kind of a match added by the client. */
export const ManualFixtureKindSchema = z.enum(['friendly', 'cup', 'other']);
export type ManualFixtureKind = z.infer<typeof ManualFixtureKindSchema>;

/** Round label of a match added by the client (its «giornata»). */
export const MANUAL_FIXTURE_LABEL: Record<ManualFixtureKind, string> = {
  friendly: 'Amichevole',
  cup: 'Coppa',
  other: 'Partita',
};

/**
 * Broadcast of one match: `auto` follows the coverage of the profile, `on` «Trasmessa» and `off` «Non trasmessa»
 * whatever the coverage.
 */
export const FixtureBroadcastSchema = z.enum(['auto', 'on', 'off']);
export type FixtureBroadcast = z.infer<typeof FixtureBroadcastSchema>;

/**
 * Pure: whether a match of the club is broadcast. A hidden match never is; otherwise the choice of the match, and with
 * `auto` the coverage (`homeOnly`: only the home matches).
 */
export function isFixtureBroadcast(input: {
  ourSide: ClubSide;
  broadcast: FixtureBroadcast;
  hidden: boolean;
  coverage: ClubCoverage;
}): boolean {
  if (input.hidden) return false;
  if (input.broadcast !== 'auto') return input.broadcast === 'on';
  return input.coverage === 'homeAndAway' || input.ourSide === 'home';
}

/**
 * Pure: the start of a match of the club that every feature uses (countdown, «Prossima partita», channel, links,
 * `.dvw` matching, update plan): the date changed by hand when there is one, otherwise the official one of the league.
 */
export function effectiveStartsAt<T extends Date | string>(f: {
  startsAt: T | null;
  overrideStartsAt: T | null;
}): T | null {
  return f.overrideStartsAt ?? f.startsAt;
}

const timeOf = (value: Date | string | null): number | null => (value === null ? null : new Date(value).getTime());

/**
 * Pure: whether the league moved a match whose date was changed by hand: the official date now differs from the one
 * it had when the client changed the date. Never for a match without a change by hand.
 */
export function movedByLeague(f: {
  startsAt: Date | string | null;
  overrideStartsAt: Date | string | null;
  overrideOfficialStartsAt: Date | string | null;
}): boolean {
  return f.overrideStartsAt !== null && timeOf(f.startsAt) !== timeOf(f.overrideOfficialStartsAt);
}

/**
 * `PUT /api/admin/calendar/fixtures/:id/date` (every match): the date and time chosen by hand (UTC), or null to go back
 * to the official date of the league.
 */
export const FixtureDateRequestSchema = z.strictObject({ startsAt: z.iso.datetime().nullable() });
export type FixtureDateRequest = z.infer<typeof FixtureDateRequestSchema>;

/** Body of `POST /api/admin/calendar/fixtures` and `PUT /api/admin/calendar/fixtures/:id` (matches added by hand). */
export const ManualFixtureRequestSchema = z.strictObject({
  kind: ManualFixtureKindSchema,
  /** Start in UTC (the page sends the local date and time of the admin converted). */
  startsAt: z.iso.datetime(),
  opponent: plainText(100),
  /** Logo of the opponent (an image `logo` of the client), null: none. */
  opponentLogo: AssetIdSchema.nullable(),
  ourSide: ClubSideSchema,
  venue: plainText(100).nullable(),
  venueCity: plainText(100).nullable(),
});
export type ManualFixtureRequest = z.infer<typeof ManualFixtureRequestSchema>;

/** Answer of `POST /api/admin/calendar/fixtures`: the new match (its link and QR are in «Calendario»). */
export const CreatedFixtureResponseSchema = z.object({ id: z.uuid() });
export type CreatedFixtureResponse = z.infer<typeof CreatedFixtureResponseSchema>;

/**
 * `PATCH /api/admin/calendar/fixtures/:id/settings` (every match): broadcast, hidden (only a downloaded match: one
 * added by hand is deleted instead) and the logos of this match (an image `logo` of the client; null: back to the
 * default one). At least one field.
 */
export const FixtureSettingsRequestSchema = z
  .strictObject({
    broadcast: FixtureBroadcastSchema.optional(),
    hidden: z.boolean().optional(),
    ourLogo: AssetIdSchema.nullable().optional(),
    opponentLogo: AssetIdSchema.nullable().optional(),
  })
  .refine((r) => Object.values(r).some((v) => v !== undefined), { message: 'nessun campo da modificare' });
export type FixtureSettingsRequest = z.infer<typeof FixtureSettingsRequestSchema>;

/** A match of the club in «Calendario» (`GET /api/admin/calendar`). */
export const ClubFixtureSchema = UpcomingFixtureSchema.extend({
  id: z.uuid(),
  /** Championship of the match; null for a match added by hand. */
  league: z.object({ id: z.uuid(), name: z.string().nullable(), season: LeagueSeasonSchema }).nullable(),
  origin: FixtureOriginSchema.default('league'),
  /** Official start of the league in UTC (a downloaded match; for one added by hand it is its own date). */
  officialStartsAt: z.iso.datetime().nullable().default(null),
  /** The date was changed by hand: `startsAt` is that one and it is no longer updated from the league. */
  dateOverridden: z.boolean().default(false),
  /** Time of the change by hand, null when none. */
  dateOverriddenAt: z.iso.datetime().nullable().default(null),
  /** The league moved the match after the change by hand (`movedByLeague`): the official date is not the old one. */
  movedByLeague: z.boolean().default(false),
  /** Kind of a match added by hand, null for a downloaded one. */
  kind: ManualFixtureKindSchema.nullable().default(null),
  broadcast: FixtureBroadcastSchema.default('auto'),
  /** Broadcast now (`isFixtureBroadcast`): otherwise the link is not active. */
  broadcasted: z.boolean().default(true),
  hidden: z.boolean().default(false),
  /** Logos chosen for this match (images of the client), null: the default one. */
  logos: z
    .object({
      our: z.object({ id: AssetIdSchema, url: z.string() }).nullable(),
      opponent: z.object({ id: AssetIdSchema, url: z.string() }).nullable(),
    })
    .default({ our: null, opponent: null }),
  state: ClubFixtureStateSchema,
  link: ClubFixtureLinkSchema.nullable(),
  /** `.dvw` linked to this match (the live one or the last one), null when none. */
  match: ClubFixtureMatchSchema.nullable(),
});
export type ClubFixture = z.infer<typeof ClubFixtureSchema>;

/** A candidate of a match to confirm, with its similarity (0-1). */
export const FixtureCandidateSchema = z.object({ clientFixtureId: z.uuid(), score: z.number().min(0).max(1) });
export type FixtureCandidate = z.infer<typeof FixtureCandidateSchema>;

/** A `.dvw` whose match of the calendar must be confirmed by the admin. */
export const PendingMatchSchema = z.object({
  id: z.uuid(),
  matchKey: z.string(),
  live: z.boolean(),
  homeName: z.string().nullable(),
  awayName: z.string().nullable(),
  /** Date written in the `.dvw` (`YYYY-MM-DD`), null when missing or not readable. */
  date: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Best candidates first (at most a few); empty when no match of the calendar fits. */
  candidates: z.array(FixtureCandidateSchema),
});
export type PendingMatch = z.infer<typeof PendingMatchSchema>;

export const CalendarResponseSchema = z.object({
  fixtures: z.array(ClubFixtureSchema),
  pending: z.array(PendingMatchSchema),
});
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;

/** `PUT /api/admin/matches/:id/fixture`: the match of the calendar of a `.dvw`, or null for «nessuna (amichevole)». */
export const LinkMatchFixtureRequestSchema = z.strictObject({ clientFixtureId: z.uuid().nullable() });
export type LinkMatchFixtureRequest = z.infer<typeof LinkMatchFixtureRequestSchema>;

/** Most matches of the club in `GET /api/public/tenant/schedule` (the block shows the first one that is not live). */
export const SCHEDULE_MAX_FIXTURES = 3;

/** A coming match of the club as the public blocks show it: teams, logos, time, venue and the short link of the match. */
export const ScheduleFixtureSchema = UpcomingFixtureSchema.pick({
  startsAt: true,
  home: true,
  away: true,
  ourSide: true,
  venue: true,
  venueCity: true,
  roundLabel: true,
  leagueName: true,
}).extend({
  /** A `.dvw` of this match is being played now (the block «Prossima partita» skips it). */
  live: z.boolean(),
  /**
   * Short public link of the match (`<base>/l/<code>`), the one of its QR; null when revoked. Without «Link e QR per
   * singola partita» the short link of the channel of the club (null when the client has none).
   */
  shortUrl: z.url().nullable(),
});
export type ScheduleFixture = z.infer<typeof ScheduleFixtureSchema>;

/** A row of the standings as the public block shows it (the numbers are the ones of the league site). */
export const ScheduleStandingRowSchema = StandingRowSchema.pick({
  position: true,
  teamName: true,
  points: true,
  played: true,
  won: true,
  lost: true,
  setsWon: true,
  setsLost: true,
}).extend({
  logoUrl: z.string().nullable(),
  /** The team of the club. */
  ours: z.boolean(),
});
export type ScheduleStandingRow = z.infer<typeof ScheduleStandingRowSchema>;

export const ScheduleStandingsSchema = z.object({
  leagueName: z.string().nullable(),
  /** Time the standings were stored, null when unknown. */
  updatedAt: z.iso.datetime().nullable(),
  rows: z.array(ScheduleStandingRowSchema),
});
export type ScheduleStandings = z.infer<typeof ScheduleStandingsSchema>;

/**
 * `GET /api/public/tenant/schedule`: public data of the club of the client of the hostname for the blocks «Prossima
 * partita» and «Classifica». Without a club: no matches and no standings (the blocks stay hidden).
 */
export const ScheduleResponseSchema = z.object({
  fixtures: z.array(ScheduleFixtureSchema).max(SCHEDULE_MAX_FIXTURES),
  standings: ScheduleStandingsSchema.nullable(),
});
export type ScheduleResponse = z.infer<typeof ScheduleResponseSchema>;

export const EMPTY_SCHEDULE: ScheduleResponse = { fixtures: [], standings: null };

/** Rows of the standings of a block: `top` the first N, `all` every row, `around` the club ±2 positions. */
export const STANDINGS_SCOPES = ['top', 'all', 'around'] as const;
export type StandingsScope = (typeof STANDINGS_SCOPES)[number];
/** Rows around the team of the club in the scope `around`, on each side. */
export const STANDINGS_AROUND = 2;

/**
 * Pure: the rows to show. `top`: the first `count`; `all`: every row; `around`: the team of the club and
 * STANDINGS_AROUND rows on each side (the window slides to keep the same number of rows near the ends); without the
 * team of the club it is the first rows.
 */
export function standingsRowsToShow(
  rows: readonly ScheduleStandingRow[],
  scope: StandingsScope,
  count: number,
): ScheduleStandingRow[] {
  if (scope === 'all') return [...rows];
  if (scope === 'around') {
    const at = rows.findIndex((r) => r.ours);
    const size = 2 * STANDINGS_AROUND + 1;
    if (at !== -1) {
      const start = Math.max(0, Math.min(at - STANDINGS_AROUND, rows.length - size));
      return rows.slice(start, start + size);
    }
  }
  return rows.slice(0, count);
}

/**
 * Download state of the championship of the series chosen by the club (`POST` and `GET /api/admin/club/league`):
 * `none` (no series chosen), `downloading` (calendar, standings, teams and logos on their way), `ready`, `error`.
 */
export const ClubLeagueStateSchema = z.enum(['none', 'downloading', 'ready', 'error']);
export type ClubLeagueState = z.infer<typeof ClubLeagueStateSchema>;

export const ClubLeagueStatusSchema = z.object({
  state: ClubLeagueStateSchema,
  /** Error of the download, or a warning of a good one; null when none. */
  message: z.string().nullable(),
  gender: LeagueGenderSchema.nullable(),
  series: LeagueSeriesIdSchema.nullable(),
  leagueId: z.uuid().nullable(),
  /** Official name and season of the championship, null until known. */
  leagueName: z.string().nullable(),
  season: LeagueSeasonSchema.nullable(),
  /** Teams of the championship (of all its groups), only when `ready`; each with the championship it is in. */
  teams: z.array(ClubTeamSchema.extend({ leagueId: z.uuid() })),
  /** The team of the club in this championship (null: not chosen). */
  teamId: z.uuid().nullable(),
});
export type ClubLeagueStatus = z.infer<typeof ClubLeagueStatusSchema>;
