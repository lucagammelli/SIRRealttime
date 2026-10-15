import type { MatchState } from '@sir/volley-stats';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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

export const userRole = pgEnum('user_role', ['admin', 'viewer']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always lower case. */
  email: text('email').notNull().unique(),
  /** argon2id. */
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** sha256 hex of the cookie token. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** sha256 hex of the bearer token. */
  tokenHash: text('token_hash').notNull().unique(),
  revoked: boolean('revoked').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
});

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
  (t) => [index('agent_registrations_status_idx').on(t.status, t.expiresAt)],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchKey: text('match_key').notNull().unique(),
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
    uniqueIndex('matches_one_live_idx')
      .on(t.live)
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

export const shareTokens = pgTable('share_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** sha256 hex of the public token. */
  tokenHash: text('token_hash').notNull().unique(),
  /** null: the link follows the live match. */
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  /** null: no expiry. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: createdAt(),
});

export const schema = {
  userRole,
  users,
  sessions,
  agents,
  agentRegistrationStatus,
  agentRegistrations,
  matches,
  scoutLines,
  shareTokens,
};
