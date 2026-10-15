import type { MatchState } from '@sir/volley-stats';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
    createdAt: createdAt(),
  },
  (t) => [index('tenants_hostnames_idx').using('gin', t.hostnames)],
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
    createdAt: createdAt(),
  },
  (t) => [
    index('users_tenant_idx').on(t.tenantId),
    // role::text: the new enum value cannot be used as such in the migration that adds it.
    check('users_tenant_role_check', sql`((${t.role})::text = 'superadmin') = (${t.tenantId} is null)`),
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
  },
  (t) => [index('agent_registrations_status_idx').on(t.tenantId, t.status, t.expiresAt)],
);

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
    state: jsonb('state').$type<MatchState>(),
    version: integer('version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('matches_tenant_match_key_idx').on(t.tenantId, t.matchKey),
    // One live match per client.
    uniqueIndex('matches_one_live_per_tenant_idx')
      .on(t.tenantId)
      .where(sql`${t.live}`),
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
  },
  (t) => [index('share_tokens_tenant_idx').on(t.tenantId)],
);

export const assetKind = pgEnum('asset_kind', ['logo', 'sponsor']);

/**
 * Images uploaded by a client. The file is `<ASSETS_DIR>/<tenant_id>/<sha256>` (no name chosen by the user); the
 * same file uploaded twice by a client is one row. `mime`, `width` and `height` come from the bytes.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: assetKind('kind').notNull(),
    /** sha256 hex of the file. */
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('assets_tenant_sha256_kind_idx').on(t.tenantId, t.sha256, t.kind)],
);

export const schema = {
  tenants,
  userRole,
  users,
  sessions,
  agents,
  agentRegistrationStatus,
  agentRegistrations,
  matches,
  scoutLines,
  shareTokens,
  assetKind,
  assets,
};
