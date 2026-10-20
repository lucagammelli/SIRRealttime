import type { FixtureCandidate, LeaguePhase, SetScore } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** jsonb configuration document of a client, `{}` by default; its shape is checked by the schemas of `@sir/shared`. */
const tenantConfig = (name: string) =>
  jsonb(name)
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`);

/** Clients (tenants): every other table belongs to one of them. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** Lower case, without port; unique among all the clients (checked by the routes under a lock). */
    hostnames: text('hostnames')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    branding: tenantConfig('branding'),
    layout: tenantConfig('layout'),
    intermissions: tenantConfig('intermissions'),
    overlays: tenantConfig('overlays'),
    /** Profile of the club: series, coverage of the matches, team logos (`resolveClubProfile` of `@sir/shared`). */
    clubProfile: tenantConfig('club_profile'),
    /** Most active agents of the client (given by the superadmin); past it a registration cannot be enabled. */
    agentQuota: integer('agent_quota').notNull().default(1),
    /**
     * «Link e QR per singola partita» (given by the superadmin): links of the matches of the calendar and «partita
     * fissa». Off: only the channel of the club (switching it off revokes those links for good).
     */
    matchLinksEnabled: boolean('match_links_enabled').notNull().default(false),
    /** When the guided first setup was finished or dismissed for good by an admin; null: still to do. */
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('tenants_hostnames_idx').using('gin', t.hostnames),
    // Same limits of AgentQuotaSchema (0-AGENT_QUOTA_MAX): an answer out of the schema would hide the list of clients.
    check('tenants_agent_quota_check', sql`${t.agentQuota} between 0 and 100`),
  ],
);

/** Order of the values: as added by the migrations (`superadmin` came last). */
export const userRole = pgEnum('user_role', ['admin', 'viewer', 'superadmin']);

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** null only for a superadmin (check constraint). */
    tenantId: uuid('tenant_id').references(() => tenants.id),
    /** Always lower case; unique among all the clients. */
    email: text('email').notNull().unique(),
    /** argon2id. */
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull(),
    /** A disabled user cannot log in and has no sessions (set by an admin of the client or by the superadmin). */
    disabled: boolean('disabled').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('users_tenant_idx').on(t.tenantId),
    // role::text: the new enum value cannot be used as such in the migration that adds it.
    check('users_tenant_role_check', sql`((${t.role})::text = 'superadmin') = (${t.tenantId} is null)`),
  ],
);

/**
 * One-time links sent to a user: `invite` (first password, 72 h) and `reset` (new password, 1 h). Only the sha256 of
 * the token is stored. A used, replaced or cancelled link is deleted; a user with an `invite` row has not chosen its
 * password yet.
 */
export const userTokens = pgTable(
  'user_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** sha256 hex of the token in the link. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One link per user and kind: a new one replaces the old one.
    uniqueIndex('user_tokens_user_kind_idx').on(t.userId, t.kind),
    check('user_tokens_kind_check', sql`${t.kind} in ('invite', 'reset')`),
  ],
);

/**
 * Mail server for invitations and password resets: one row for the whole system (set by the superadmin). The password
 * is encrypted (AES-256-GCM, key SETTINGS_ENCRYPTION_KEY) and never sent back to the portal.
 */
export const mailSettings = pgTable(
  'mail_settings',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    /** `none`, `starttls` or `tls`. */
    security: text('security').$type<'none' | 'starttls' | 'tls'>().notNull(),
    username: text('username').notNull().default(''),
    /** `v1.<iv>.<tag>.<ciphertext>` (base64url); null: no password. */
    passwordEnc: text('password_enc'),
    fromName: text('from_name').notNull(),
    fromEmail: text('from_email').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('mail_settings_singleton_check', sql`${t.singleton}`),
    check('mail_settings_security_check', sql`${t.security} in ('none', 'starttls', 'tls')`),
    check('mail_settings_port_check', sql`${t.port} between 1 and 65535`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** sha256 hex of the cookie token. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Client chosen by a superadmin (`POST /api/admin/active-tenant`); null for the others. */
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** sha256 hex of the bearer token. */
    tokenHash: text('token_hash').notNull().unique(),
    revoked: boolean('revoked').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** End of the validity of the registration (the ingest answers 401 after it); null: no expiry. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('agents_tenant_idx').on(t.tenantId)],
);

export const agentRegistrationStatus = pgEnum('agent_registration_status', [
  'pending',
  'approved',
  'rejected',
  'consumed',
]);

/** Self-registration requests of agents (`expired` is not stored: it is derived from `expiresAt`). */
export const agentRegistrations = pgTable(
  'agent_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Client of the hostname the request came to: the agent is created there. */
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** sha256 hex of the registration secret kept by the agent. */
    secretHash: text('secret_hash').notNull().unique(),
    pairingCode: text('pairing_code').notNull(),
    /** Client address of the request (shown to the admin). */
    ip: text('ip'),
    status: agentRegistrationStatus('status').notNull().default('pending'),
    /** Agent created when the token was delivered (`consumed`). */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Time of the approval or rejection. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Validity chosen at the approval, copied to the agent when it collects its token; null: no expiry. */
    agentExpiresAt: timestamp('agent_expires_at', { withTimezone: true }),
  },
  (t) => [index('agent_registrations_status_idx').on(t.tenantId, t.status, t.expiresAt)],
);

export const fixtureLink = pgEnum('fixture_link', ['auto', 'manual', 'pending', 'none']);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Client of the agent that sent the match. */
    tenantId: tenantId(),
    /** Unique within the client. */
    matchKey: text('match_key').notNull(),
    /** Text of the DVW file before `[3SCOUT]`; null until the first snapshot. */
    header: text('header'),
    lineCount: integer('line_count').notNull().default(0),
    contentHash: text('content_hash'),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(-1),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    live: boolean('live').notNull().default(false),
    /** Last time the match became live (null: never live since the column exists); the live link follows the latest. */
    liveSince: timestamp('live_since', { withTimezone: true }),
    state: jsonb('state').$type<MatchState>(),
    version: integer('version').notNull().default(0),
    /** Match of the calendar of the club this `.dvw` belongs to (null: none, or not found yet). */
    clientFixtureId: uuid('client_fixture_id').references((): AnyPgColumn => clientFixtures.id, {
      onDelete: 'set null',
    }),
    /** How `client_fixture_id` was chosen; null: not evaluated (no club configured when the header arrived). */
    fixtureLink: fixtureLink('fixture_link'),
    /** Candidates of a `pending` link, best first (the admin chooses among them in «Calendario»). */
    fixtureCandidates: jsonb('fixture_candidates').$type<FixtureCandidate[]>(),
    /**
     * Played by the simulation of the server (`src/simulation/`): never live, never linked to the calendar, out of the
     * channel and of the lists; deleted 6 hours after its end.
     */
    simulated: boolean('simulated').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('matches_tenant_match_key_idx').on(t.tenantId, t.matchKey),
    // One live match per match of the calendar, and one among the matches without one (per client).
    uniqueIndex('matches_one_live_per_fixture_idx')
      .on(t.clientFixtureId)
      .where(sql`${t.live} and ${t.clientFixtureId} is not null`),
    uniqueIndex('matches_one_live_unlinked_idx')
      .on(t.tenantId)
      .where(sql`${t.live} and ${t.clientFixtureId} is null`),
    index('matches_client_fixture_idx').on(t.clientFixtureId),
    index('matches_simulated_idx')
      .on(t.tenantId)
      .where(sql`${t.simulated}`),
  ],
);

export const scoutLines = pgTable(
  'scout_lines',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.idx] })],
);

export const shareTokens = pgTable(
  'share_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The link works only on the hostnames of this client. */
    tenantId: tenantId(),
    /** sha256 hex of the public token. */
    tokenHash: text('token_hash').notNull().unique(),
    /** null: the link follows the live match of the client. */
    matchId: uuid('match_id').references(() => matches.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** null: no expiry. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: createdAt(),
    /**
     * Keyed hash (`shortCodeLookupHash`: HMAC with a key derived from SHARE_CODE_SECRET) of the short code (`/l/<code>`). The code is never stored: it is the HMAC of the id with
     * SHARE_CODE_SECRET (and `short_code_salt`), so the admin can see it again. null: not assigned yet (links
     * created before the short codes get one at the server start or at the next list).
     */
    shortCodeHash: text('short_code_hash').unique(),
    /** Counter mixed into the HMAC: raised only when the code of salt 0 collides with the one of another link. */
    shortCodeSalt: integer('short_code_salt').notNull().default(0),
    /**
     * Match of the calendar of the club (link created by the server, one per match): before the start the link shows
     * «Prossima partita», then the `.dvw` linked to it. null for the links created by hand.
     */
    clientFixtureId: uuid('client_fixture_id').references((): AnyPgColumn => clientFixtures.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => [
    index('share_tokens_tenant_idx').on(t.tenantId),
    uniqueIndex('share_tokens_client_fixture_idx')
      .on(t.clientFixtureId)
      // One valid link per match: a revoked one leaves room for a new one (option switched on again).
      .where(sql`${t.clientFixtureId} is not null and not ${t.revoked}`),
  ],
);

export const assetKind = pgEnum('asset_kind', ['logo', 'sponsor']);

/**
 * Images uploaded by a client. The file is `<ASSETS_DIR>/<tenant_id>/<sha256>` (no name chosen by the user); the
 * same file uploaded twice by a client is one row. `mime`, `width` and `height` come from the bytes.
 */
/**
 * Sponsors of a client: name (unique in the client), optional `https://` website, place in its list. Their images are
 * the rows of `assets` with their `sponsor_id`.
 */
export const sponsors = pgTable(
  'sponsors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    website: text('website'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sponsors_tenant_name_idx').on(t.tenantId, t.name),
    check('sponsors_name_check', sql`char_length(${t.name}) between 1 and 80`),
    check('sponsors_website_check', sql`${t.website} is null or ${t.website} like 'https://%'`),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: assetKind('kind').notNull(),
    /** Sponsor of the same client the image belongs to (checked by the server); null: none. */
    sponsorId: uuid('sponsor_id').references((): AnyPgColumn => sponsors.id, { onDelete: 'set null' }),
    /** sha256 hex of the file. */
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('assets_tenant_sha256_kind_idx').on(t.tenantId, t.sha256, t.kind),
    index('assets_sponsor_idx').on(t.sponsorId),
  ],
);

// --- Championships (common to every client: public data of the official sites) ---------------------------------

export const leagueProvider = pgEnum('league_provider', ['legavolley']);
export const leagueSyncStatus = pgEnum('league_sync_status', ['never', 'ok', 'error']);
export const fixtureStatus = pgEnum('fixture_status', ['scheduled', 'played', 'postponed']);

/** Championships downloaded from a provider (on legavolley.it `external_id` is the `IdCampionato`, one per season). */
export const leagues = pgTable(
  'leagues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: leagueProvider('provider').notNull(),
    externalId: integer('external_id').notNull(),
    /** First year of the season (2025 = 2025/2026). */
    season: integer('season').notNull(),
    /** Official name, null until the first good update. */
    name: text('name'),
    phases: jsonb('phases')
      .$type<LeaguePhase[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Last attempt and last good update; status and message of the last attempt (the data stay the good ones). */
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastStatus: leagueSyncStatus('last_status').notNull().default('never'),
    lastMessage: text('last_message'),
    /** Lease of the running update (null: none); an old lease (crashed process) is taken over. */
    syncStartedAt: timestamp('sync_started_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('leagues_provider_external_idx').on(t.provider, t.externalId)],
);

/**
 * Logos of the platform (one row per slot, `left` and `right`), loaded by the superadmin and checked by `inspectImage`
 * (at most 150×50 px); the file is `<ASSETS_DIR>/_system/<sha256>`. The id changes at every upload (public path).
 */
export const systemLogos = pgTable(
  'system_logos',
  {
    slot: text('slot').primaryKey(),
    id: uuid('id').notNull().unique().defaultRandom(),
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('system_logos_slot_check', sql`${t.slot} in ('left', 'right')`),
    check('system_logos_size_check', sql`${t.width} between 1 and 150 and ${t.height} between 1 and 50`),
  ],
);

/** Downloaded team logos, checked by `inspectImage`; the file is `<ASSETS_DIR>/_leagues/<sha256>`. */
export const teamLogos = pgTable('team_logos', {
  id: uuid('id').primaryKey().defaultRandom(),
  sha256: text('sha256').notNull().unique(),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  bytes: integer('bytes').notNull(),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
});

const leagueId = () =>
  uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' });

export const leagueTeams = pgTable(
  'league_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: leagueId(),
    /** Id of the team on the provider (on legavolley.it one per season). */
    externalId: integer('external_id').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    city: text('city'),
    venue: text('venue'),
    venueAddress: text('venue_address'),
    logoId: uuid('logo_id').references(() => teamLogos.id, { onDelete: 'set null' }),
    /** Last download of the team page and of the logo (refreshed after 7 days). */
    detailsFetchedAt: timestamp('details_fetched_at', { withTimezone: true }),
    logoFetchedAt: timestamp('logo_fetched_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('league_teams_league_external_idx').on(t.leagueId, t.externalId)],
);

/** Matches of the calendar of a championship. */
export const fixtures = pgTable(
  'fixtures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: leagueId(),
    /** Stable within the championship: `n<official number>`, otherwise phase, round and teams. */
    externalId: text('external_id').notNull(),
    number: integer('number'),
    phaseId: integer('phase_id').notNull(),
    phase: text('phase').notNull(),
    round: integer('round'),
    roundLabel: text('round_label').notNull(),
    /** Official start in UTC; null when not set yet. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    homeTeamId: uuid('home_team_id')
      .notNull()
      .references(() => leagueTeams.id, { onDelete: 'cascade' }),
    awayTeamId: uuid('away_team_id')
      .notNull()
      .references(() => leagueTeams.id, { onDelete: 'cascade' }),
    venue: text('venue'),
    venueCity: text('venue_city'),
    venueAddress: text('venue_address'),
    status: fixtureStatus('status').notNull(),
    homeSets: integer('home_sets'),
    awaySets: integer('away_sets'),
    setScores: jsonb('set_scores').$type<SetScore[]>(),
    providerMatchId: integer('provider_match_id'),
    note: text('note'),
    /** sha256 of the downloaded values: an update that changes nothing does not touch the row. */
    contentHash: text('content_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fixtures_league_external_idx').on(t.leagueId, t.externalId),
    index('fixtures_starts_at_idx').on(t.startsAt),
  ],
);

/** Standings of a championship as last downloaded (replaced as a whole). */
export const standings = pgTable(
  'standings',
  {
    leagueId: leagueId(),
    position: integer('position').notNull(),
    /** Team with the same name in the calendar; null when none. */
    teamId: uuid('team_id').references(() => leagueTeams.id, { onDelete: 'set null' }),
    teamName: text('team_name').notNull(),
    points: integer('points').notNull(),
    played: integer('played').notNull(),
    won: integer('won').notNull(),
    lost: integer('lost').notNull(),
    setsWon: integer('sets_won').notNull(),
    setsLost: integer('sets_lost').notNull(),
    pointsFor: integer('points_for').notNull(),
    pointsAgainst: integer('points_against').notNull(),
    setRatio: real('set_ratio'),
    pointRatio: real('point_ratio'),
    /** Matches by result: 3-0, 3-1, 3-2, 2-3, 1-3, 0-3. */
    byResult: jsonb('by_result').$type<number[]>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.position] })],
);

/** ETag and Last-Modified of the pages and logos downloaded, sent back as If-None-Match / If-Modified-Since. */
export const leagueHttpCache = pgTable('league_http_cache', {
  url: text('url').primaryKey(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Club of a client: its championships, its team there and its matches of the calendar ---------------------------

/** Championships of a client and its team in each (null: not chosen yet). */
export const tenantLeagues = pgTable(
  'tenant_leagues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id),
    leagueTeamId: uuid('league_team_id').references(() => leagueTeams.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tenant_leagues_tenant_league_idx').on(t.tenantId, t.leagueId),
    index('tenant_leagues_league_idx').on(t.leagueId),
  ],
);

export const clubSide = pgEnum('club_side', ['home', 'away']);
export const fixtureOrigin = pgEnum('fixture_origin', ['league', 'manual']);
export const manualFixtureKind = pgEnum('manual_fixture_kind', ['friendly', 'cup', 'other']);
export const fixtureBroadcast = pgEnum('fixture_broadcast', ['auto', 'on', 'off']);

/**
 * Matches of the team of the club in its championships, with a copy of what is shown (the row of `fixtures` can be
 * deleted by an update of the calendar: this one stays, with its link, marked `removed_at`).
 */
export const clientFixtures = pgTable(
  'client_fixtures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** null only for a match added by the client (`origin` manual; check constraint). */
    leagueId: uuid('league_id').references(() => leagues.id),
    /** `fixtures.external_id`: stable within the championship; `manual:<id>` for a match added by the client. */
    fixtureExternalId: text('fixture_external_id').notNull(),
    origin: fixtureOrigin('origin').notNull().default('league'),
    /** Kind of a match added by the client; null for a downloaded one. */
    manualKind: manualFixtureKind('manual_kind'),
    /** «Trasmessa» / «Non trasmessa» chosen for this match, over the coverage of the profile (`auto`). */
    broadcast: fixtureBroadcast('broadcast').notNull().default('auto'),
    /** Hidden by the client (only downloaded matches: the ones added by hand are deleted). */
    hidden: boolean('hidden').notNull().default(false),
    /** Logos chosen for this match (images of the client); null: the default one. */
    ourLogoAssetId: uuid('our_logo_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    opponentLogoAssetId: uuid('opponent_logo_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    /** null when the match is no longer in the calendar. */
    fixtureId: uuid('fixture_id').references(() => fixtures.id, { onDelete: 'set null' }),
    /** Time the match left the calendar (or the team of the club changed); null while it is there. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    /** Official start (league); for a match added by hand it is its date. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    /** Start chosen by the client for a downloaded match: the update of the calendar never touches it. */
    overrideStartsAt: timestamp('override_starts_at', { withTimezone: true }),
    /** Time of the change by hand; null without one. */
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    /** Official start when the client changed the date (to tell that the league moved the match since). */
    overrideOfficialStartsAt: timestamp('override_official_starts_at', { withTimezone: true }),
    ourSide: clubSide('our_side').notNull(),
    homeName: text('home_name').notNull(),
    awayName: text('away_name').notNull(),
    /** City of the teams (team page of the league), used to recognize them in the `.dvw`. */
    homeCity: text('home_city'),
    awayCity: text('away_city'),
    homeLogoId: uuid('home_logo_id').references(() => teamLogos.id, { onDelete: 'set null' }),
    awayLogoId: uuid('away_logo_id').references(() => teamLogos.id, { onDelete: 'set null' }),
    venue: text('venue'),
    venueCity: text('venue_city'),
    roundLabel: text('round_label').notNull(),
    leagueName: text('league_name'),
    status: fixtureStatus('status').notNull(),
    homeSets: integer('home_sets'),
    awaySets: integer('away_sets'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('client_fixtures_tenant_fixture_idx').on(t.tenantId, t.leagueId, t.fixtureExternalId),
    index('client_fixtures_tenant_starts_idx').on(t.tenantId, t.startsAt),
    check('client_fixtures_origin_league_check', sql`(${t.origin} = 'manual') = (${t.leagueId} is null)`),
  ],
);

/**
 * One visit to a public page (statistics): kept 90 days, then only the totals of `view_daily` stay. No IP, no user
 * agent, no id of the spectator: the id of the visit lives only in the memory of the server until the visit ends.
 * Simulated matches are never recorded.
 */
export const pageViews = pgTable(
  'page_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** Link opened; null when the link was deleted since. */
    shareTokenId: uuid('share_token_id').references(() => shareTokens.id, { onDelete: 'set null' }),
    clientFixtureId: uuid('client_fixture_id').references((): AnyPgColumn => clientFixtures.id, {
      onDelete: 'set null',
    }),
    /** Match followed when the visit ended; null: none yet («Prossima partita»). */
    matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    seconds: integer('seconds').notNull(),
    device: text('device').notNull(),
    source: text('source').notNull(),
    app: boolean('app').notNull(),
    /** Day of `started_at` in Rome (`YYYY-MM-DD`): the unit of the daily totals. */
    day: date('day', { mode: 'string' }).notNull(),
  },
  (t) => [
    index('page_views_tenant_day_idx').on(t.tenantId, t.day),
    check('page_views_device_check', sql`${t.device} in ('tv', 'tablet', 'phone')`),
    check('page_views_source_check', sql`${t.source} in ('qr', 'link')`),
    check('page_views_seconds_check', sql`${t.seconds} >= 0`),
  ],
);

/** Spectators connected to a match, sampled every minute (only minutes with at least one). */
export const viewerPeaks = pgTable(
  'viewer_peaks',
  {
    tenantId: tenantId(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    /** Start of the minute. */
    minute: timestamp('minute', { withTimezone: true }).notNull(),
    viewers: integer('viewers').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.minute] }),
    index('viewer_peaks_tenant_day_idx').on(t.tenantId, t.day),
    check('viewer_peaks_viewers_check', sql`${t.viewers} > 0`),
  ],
);

/** Totals of a day (Rome) per link and match, written when the detail of `page_views` is older than 90 days. */
export const viewDaily = pgTable(
  'view_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    day: date('day', { mode: 'string' }).notNull(),
    shareTokenId: uuid('share_token_id').references(() => shareTokens.id, { onDelete: 'set null' }),
    matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
    visits: integer('visits').notNull(),
    qrVisits: integer('qr_visits').notNull(),
    appVisits: integer('app_visits').notNull(),
    tvVisits: integer('tv_visits').notNull(),
    tabletVisits: integer('tablet_visits').notNull(),
    phoneVisits: integer('phone_visits').notNull(),
    seconds: bigint('seconds', { mode: 'number' }).notNull(),
    peak: integer('peak').notNull(),
  },
  (t) => [index('view_daily_tenant_day_idx').on(t.tenantId, t.day)],
);

export const schema = {
  tenants,
  userRole,
  users,
  userTokens,
  mailSettings,
  sessions,
  agents,
  agentRegistrationStatus,
  agentRegistrations,
  matches,
  scoutLines,
  shareTokens,
  assetKind,
  sponsors,
  assets,
  leagueProvider,
  leagueSyncStatus,
  fixtureStatus,
  leagues,
  teamLogos,
  leagueTeams,
  fixtures,
  standings,
  leagueHttpCache,
  fixtureLink,
  tenantLeagues,
  clubSide,
  fixtureOrigin,
  manualFixtureKind,
  fixtureBroadcast,
  clientFixtures,
  pageViews,
  viewerPeaks,
  viewDaily,
};
