import { z } from 'zod';
import {
  FixtureStatusSchema,
  LeagueExternalIdSchema,
  LeagueSeasonSchema,
  LeagueSyncStateSchema,
  StandingRowSchema,
} from './leagues.js';
import { OUR_TEAM_NAME_MAX, OurTeamSchema } from './ourTeam.js';

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
  /** «Nostra squadra» of the graphics (filled from the team of the club when it was empty). */
  ourTeam: OurTeamSchema,
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
  /** Official start in UTC; null when not set yet. */
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

/** A match of the club in «Calendario» (`GET /api/admin/calendar`). */
export const ClubFixtureSchema = UpcomingFixtureSchema.extend({
  id: z.uuid(),
  league: z.object({ id: z.uuid(), name: z.string().nullable(), season: LeagueSeasonSchema }),
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
  /** Short public link of the match (`<base>/l/<code>`), the one of its QR; null when revoked. */
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
