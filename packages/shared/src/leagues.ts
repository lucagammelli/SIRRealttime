import { z } from 'zod';

/**
 * Championships (leagues), their teams, calendar and standings, downloaded from the official site of the provider.
 * The data are public and the same for every client: they are stored once and shown by the admin area (later by the
 * pages of the clients).
 */

/** Official sources: today only Lega Pallavolo Serie A (www.legavolley.it). */
export const LeagueProviderSchema = z.enum(['legavolley']);
export type LeagueProvider = z.infer<typeof LeagueProviderSchema>;

/** Largest numeric id accepted from a provider (championship, team, match): far above the ids of today. */
export const LEAGUE_MAX_EXTERNAL_ID = 99_999_999;
export const LeagueExternalIdSchema = z.number().int().positive().max(LEAGUE_MAX_EXTERNAL_ID);

/** First year of a season (2025 = season 2025/2026); the Lega archive starts in 1945. */
export const LeagueSeasonSchema = z.number().int().min(1945).max(2100);

/** Pure: label of a season, `2025` → `2025/2026`. */
export const seasonLabel = (season: number): string => `${season}/${season + 1}`;

/**
 * `POST /api/admin/leagues`: a championship of the provider (on legavolley.it the `IdCampionato` of the calendar,
 * different for every season) and its season, checked against the downloaded page at the first update.
 */
export const CreateLeagueRequestSchema = z.strictObject({
  provider: LeagueProviderSchema,
  externalId: LeagueExternalIdSchema,
  season: LeagueSeasonSchema,
});
export type CreateLeagueRequest = z.infer<typeof CreateLeagueRequestSchema>;

/** Outcome of the last update: `never` until the first one. */
export const LeagueSyncStatusSchema = z.enum(['never', 'ok', 'error']);
export type LeagueSyncStatus = z.infer<typeof LeagueSyncStatusSchema>;

export const LeagueSyncStateSchema = z.object({
  status: LeagueSyncStatusSchema,
  /** Error of the last update, or a warning of a good one (for example a logo rejected); null when none. */
  message: z.string().nullable(),
  /** Time of the last attempt. */
  at: z.iso.datetime().nullable(),
  /** Time of the last good update (its data are the ones shown). */
  lastSuccessAt: z.iso.datetime().nullable(),
  /** An update is running now. */
  running: z.boolean(),
});
export type LeagueSyncState = z.infer<typeof LeagueSyncStateSchema>;

/** Phase of a championship as listed by the provider (Andata, Ritorno, Quarti, …). */
export const LeaguePhaseSchema = z.object({ id: z.number().int().nonnegative(), name: z.string() });
export type LeaguePhase = z.infer<typeof LeaguePhaseSchema>;

export const LeagueSummarySchema = z.object({
  id: z.uuid(),
  provider: LeagueProviderSchema,
  externalId: LeagueExternalIdSchema,
  season: LeagueSeasonSchema,
  /** Official name; null until the first good update. */
  name: z.string().nullable(),
  phases: z.array(LeaguePhaseSchema),
  teamCount: z.number().int().nonnegative(),
  fixtureCount: z.number().int().nonnegative(),
  sync: LeagueSyncStateSchema,
  createdAt: z.iso.datetime(),
  /**
   * Planning of the automatic updates: next one (null: automatic updates off, LEAGUE_SYNC=off) and whether a club
   * has a match of the championship today (then every 10 minutes, otherwise once a night).
   */
  plan: z
    .object({ nextSyncAt: z.iso.datetime().nullable(), matchToday: z.boolean() })
    .default({ nextSyncAt: null, matchToday: false }),
});
export type LeagueSummary = z.infer<typeof LeagueSummarySchema>;

/** `GET /api/admin/leagues`. */
export const LeagueListResponseSchema = z.object({ leagues: z.array(LeagueSummarySchema) });
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

export const LeagueTeamSchema = z.object({
  id: z.uuid(),
  externalId: LeagueExternalIdSchema,
  name: z.string(),
  shortName: z.string().nullable(),
  city: z.string().nullable(),
  venue: z.string().nullable(),
  venueAddress: z.string().nullable(),
  /** Public path of the downloaded logo (`/api/public/team-logos/<id>`), null when none. */
  logoUrl: z.string().nullable(),
});
export type LeagueTeam = z.infer<typeof LeagueTeamSchema>;

/** `scheduled`: not played yet; `played`: with a result; `postponed`: marked as postponed by the provider. */
export const FixtureStatusSchema = z.enum(['scheduled', 'played', 'postponed']);
export type FixtureStatus = z.infer<typeof FixtureStatusSchema>;

export const SetScoreSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});
export type SetScore = z.infer<typeof SetScoreSchema>;

export const FixtureResultSchema = z.object({
  homeSets: z.number().int().min(0).max(5),
  awaySets: z.number().int().min(0).max(5),
  /** Points of every set, null when the provider does not give them. */
  sets: z.array(SetScoreSchema).nullable(),
});
export type FixtureResult = z.infer<typeof FixtureResultSchema>;

export const FixtureTeamRefSchema = z.object({
  teamId: z.uuid(),
  externalId: LeagueExternalIdSchema,
  name: z.string(),
});
export type FixtureTeamRef = z.infer<typeof FixtureTeamRefSchema>;

export const LeagueFixtureSchema = z.object({
  id: z.uuid(),
  /** Stable id within the championship (official number of the match). */
  externalId: z.string(),
  /** Official number of the match, null when the provider has none. */
  number: z.number().int().positive().nullable(),
  phaseId: z.number().int().nonnegative(),
  phase: z.string(),
  /** Number of the round within the phase (1ª Giornata = 1, Gara 2 = 2), null when not written. */
  round: z.number().int().positive().nullable(),
  /** Round as written by the provider («1ª Giornata Andata», «Gara 1 Finale»). */
  roundLabel: z.string(),
  /** Official date and time in UTC; null when not set yet. */
  startsAt: z.iso.datetime().nullable(),
  home: FixtureTeamRefSchema,
  away: FixtureTeamRefSchema,
  venue: z.string().nullable(),
  venueCity: z.string().nullable(),
  status: FixtureStatusSchema,
  /** null until played. */
  result: FixtureResultSchema.nullable(),
  /** Id of the match sheet of the provider, present once played. */
  providerMatchId: LeagueExternalIdSchema.nullable(),
  note: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type LeagueFixture = z.infer<typeof LeagueFixtureSchema>;

export const StandingRowSchema = z.object({
  position: z.number().int().positive(),
  /** Team of the championship with this name; null when the name is not one of the calendar. */
  teamId: z.uuid().nullable(),
  teamName: z.string(),
  points: z.number().int(),
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  setsWon: z.number().int().nonnegative(),
  setsLost: z.number().int().nonnegative(),
  pointsFor: z.number().int().nonnegative(),
  pointsAgainst: z.number().int().nonnegative(),
  /** Set and point quotients as given by the provider; null when not computed yet («-»). */
  setRatio: z.number().nonnegative().nullable(),
  pointRatio: z.number().nonnegative().nullable(),
});
export type StandingRow = z.infer<typeof StandingRowSchema>;

/** `GET /api/admin/leagues/:id`. */
export const LeagueDetailResponseSchema = z.object({
  league: LeagueSummarySchema,
  teams: z.array(LeagueTeamSchema),
  fixtures: z.array(LeagueFixtureSchema),
  standings: z.array(StandingRowSchema),
  /** Time the standings were stored, null when none. */
  standingsUpdatedAt: z.iso.datetime().nullable(),
});
export type LeagueDetailResponse = z.infer<typeof LeagueDetailResponseSchema>;

/** Public path of a downloaded team logo. */
export const publicTeamLogoPath = (id: string): string => `/api/public/team-logos/${id}`;
