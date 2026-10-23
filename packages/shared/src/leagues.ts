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

// --- Catalog of the series a club can choose -----------------------------------------------------------------

/** Gender of a championship: the female one is in the model but not available yet («Presto disponibile»). */
export const LeagueGenderSchema = z.enum(['M', 'F']);
export type LeagueGender = z.infer<typeof LeagueGenderSchema>;

export const LEAGUE_GENDERS: readonly { id: LeagueGender; label: string; available: boolean }[] = [
  { id: 'M', label: 'Maschile', available: true },
  { id: 'F', label: 'Femminile', available: false },
];

/** Series of the catalog (the same ids in the profile of the club and in the requests). */
export const LEAGUE_SERIES_IDS = ['superlega', 'a2', 'a3'] as const;
export const LeagueSeriesIdSchema = z.enum(LEAGUE_SERIES_IDS);
export type LeagueSeriesId = z.infer<typeof LeagueSeriesIdSchema>;

export interface LeagueSeries {
  id: LeagueSeriesId;
  gender: LeagueGender;
  label: string;
  /** Words (normalized) the name of the championship in the menu of the official site must contain. */
  words: readonly string[];
}

export const LEAGUE_SERIES: readonly LeagueSeries[] = [
  { id: 'superlega', gender: 'M', label: 'SuperLega', words: ['superlega'] },
  { id: 'a2', gender: 'M', label: 'Serie A2', words: ['a2'] },
  { id: 'a3', gender: 'M', label: 'Serie A3', words: ['a3'] },
];

/** Pure: the series of the catalog for a gender, in menu order. */
export const seriesOfGender = (gender: LeagueGender): LeagueSeries[] =>
  LEAGUE_SERIES.filter((s) => s.gender === gender);

/** Pure: a series of the catalog by id. */
export const seriesById = (id: string): LeagueSeries | undefined => LEAGUE_SERIES.find((s) => s.id === id);

/**
 * `POST /api/admin/club/league`: the series chosen by the club. Only the male gender is available today; the series
 * must be one of the catalog.
 */
export const SelectClubLeagueRequestSchema = z.strictObject({
  gender: z.literal('M'),
  series: LeagueSeriesIdSchema,
});
export type SelectClubLeagueRequest = z.infer<typeof SelectClubLeagueRequestSchema>;

/** Pure: text compared between names of the site and the catalog (case, accents and punctuation ignored). */
export function normalizeLeagueText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Words that exclude a championship from the series (cups, play off, female ones): they are other championships. */
const EXCLUDED_WORDS = ['coppa', 'supercoppa', 'play', 'playoff', 'playout', 'promozione', 'femminile', 'challenge'];

/** An option of the menu «Campionato» of the calendar of the official site. */
export interface ChampionshipOption {
  externalId: number;
  name: string;
}

/**
 * Pure: the championships of a series among the options of the menu «Campionato»: the name must contain the words of the
 * series and none of the excluded ones; the «Regular Season» ones are preferred (A3 has two groups, both returned),
 * otherwise the first match. Empty when the menu has no such option.
 */
export function pickSeriesChampionships<T extends ChampionshipOption>(
  series: LeagueSeries,
  options: readonly T[],
): T[] {
  const candidates = options.filter((o) => {
    const words = normalizeLeagueText(o.name).split(' ');
    return series.words.every((w) => words.includes(w)) && !EXCLUDED_WORDS.some((w) => words.includes(w));
  });
  const regular = candidates.filter((o) => normalizeLeagueText(o.name).includes('regular season'));
  return regular.length > 0 ? regular : candidates.slice(0, 1);
}

/** Pure: the first championship of `pickSeriesChampionships`, null when none. */
export const pickSeriesChampionship = <T extends ChampionshipOption>(
  series: LeagueSeries,
  options: readonly T[],
): T | null => pickSeriesChampionships(series, options)[0] ?? null;

/**
 * Kinds of the other competitions of a series (cups, play off…), from the most specific: a competition of a new
 * season takes the place of the one of the same kind of the season before («Del Monte Supercoppa» 2025 → «Supercoppa
 * A1» 2026). The sponsors in the names change every year, the kind stays.
 */
const COMPETITION_KINDS: readonly { kind: string; words: readonly string[] }[] = [
  { kind: 'supercoppa', words: ['supercoppa'] },
  { kind: 'coppa italia', words: ['coppa italia'] },
  { kind: 'play off 5', words: ['play off 5', 'playoff 5'] },
  { kind: 'play off', words: ['play off', 'playoff'] },
  { kind: 'play out', words: ['play out', 'playout'] },
  { kind: 'challenge', words: ['challenge'] },
  { kind: 'promozione', words: ['promozione'] },
  { kind: 'coppa', words: ['coppa'] },
];

/** Pure: the kind of a competition from its name (`COMPETITION_KINDS`), null when none (no automatic change of season). */
export function competitionKind(name: string): string | null {
  const text = ` ${normalizeLeagueText(name)} `;
  return COMPETITION_KINDS.find((k) => k.words.some((w) => text.includes(` ${w} `)))?.kind ?? null;
}

/**
 * Pure: the other competitions of a series among the options of the menu «Campionato» of the page of its championship
 * (the site lists there the competitions of the same category: cups, Supercoppa, play off…): every option except the
 * championships of the series (`pickSeriesChampionships`, A3: both groups).
 */
export function seriesCompetitions<T extends ChampionshipOption>(series: LeagueSeries, options: readonly T[]): T[] {
  const own = new Set(pickSeriesChampionships(series, options).map((o) => o.externalId));
  return options.filter((o) => !own.has(o.externalId));
}
