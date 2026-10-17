import type { MatchState, MatchStatus } from '@sir/volley-stats';
import { z } from 'zod';
import { MatchKeySchema } from './ingest.js';
import { MatchStateSchema } from './messages.js';
import { PairingCodeSchema } from './registration.js';
import { PASSWORD_MIN_LENGTH, PasswordSchema, UserCredentialsSchema } from './credentials.js';
import { plainText } from './strings.js';
import { AgentQuotaSchema, TenantRefSchema } from './tenant.js';

/** Long public share token: random ≥ 128 bit, base64url (`/live/<token>`). */
export const LONG_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/**
 * Short code of a public link (`/l/<code>`): SHORT_CODE_LENGTH characters of PAIRING_CODE_ALPHABET (no 0/O, 1/I),
 * 40 bit. Canonical form: upper case, no dash; shown as `K7M2-QX9P`.
 */
export const SHORT_CODE_LENGTH = 8;
export const SHORT_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
/** Accepted input: also lower case and with a dash in the middle (`k7m2-qx9p`). */
export const SHORT_CODE_INPUT_PATTERN = /^[A-HJ-NP-Za-hj-np-z2-9]{4}-?[A-HJ-NP-Za-hj-np-z2-9]{4}$/;

/** Pure: canonical short code of an input (upper case, dash removed), or null when it is not a short code. */
export function normalizeShortCode(input: string): string | null {
  return SHORT_CODE_INPUT_PATTERN.test(input) ? input.replace('-', '').toUpperCase() : null;
}

/** Pure: a canonical short code as shown to people (`K7M2-QX9P`). */
export function formatShortCode(code: string): string {
  const half = SHORT_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** Short code as typed or scanned, normalized to the canonical form. */
export const ShortCodeSchema = z
  .string()
  .regex(SHORT_CODE_INPUT_PATTERN)
  .transform((v) => v.replace('-', '').toUpperCase());

/**
 * Path parameter of the public pages and routes: a long share token or a short code (the two formats never overlap:
 * a long token has at least 22 characters, a short code at most 9).
 */
export const SHARE_TOKEN_PATTERN = new RegExp(
  `(?:${LONG_SHARE_TOKEN_PATTERN.source})|(?:${SHORT_CODE_INPUT_PATTERN.source})`,
);

/** What a public request carries: the long token, or the canonical short code. */
export type ShareAccess = { kind: 'token'; value: string } | { kind: 'code'; value: string };

export const ShareTokenParamSchema = z.object({
  token: z.union([
    z
      .string()
      .regex(LONG_SHARE_TOKEN_PATTERN)
      .transform((value): ShareAccess => ({ kind: 'token', value })),
    ShortCodeSchema.transform((value): ShareAccess => ({ kind: 'code', value })),
  ]),
});

export const IdParamSchema = z.object({ id: z.uuid() });

/** `superadmin`: no client, creates the clients and works on any of them; `admin`/`viewer`: users of one client. */
export const UserRoleSchema = z.enum(['superadmin', 'admin', 'viewer']);
export type UserRole = z.infer<typeof UserRoleSchema>;
/** Roles that can be given from the admin area (a superadmin comes only from ADMIN_EMAIL). */
export const TenantUserRoleSchema = z.enum(['admin', 'viewer']);
export type TenantUserRole = z.infer<typeof TenantUserRoleSchema>;

export const LoginRequestSchema = z.object({
  email: plainText(254),
  password: PasswordSchema(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Logged-in user. `tenant`: the client the admin pages work on (the user's own; for a superadmin the one chosen
 * with `POST /api/admin/active-tenant`, otherwise the client of the hostname; null if none).
 */
export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: UserRoleSchema,
  tenant: TenantRefSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const CreateUserRequestSchema = UserCredentialsSchema.extend({ role: TenantUserRoleSchema });
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

/**
 * `PATCH /api/admin/users/:id`: new role, new password (set by the admin) and/or disabled; at least one field. Every
 * change closes the sessions of the user (except the session making a change to its own password).
 */
export const UpdateUserRequestSchema = z
  .strictObject({
    role: TenantUserRoleSchema.optional(),
    password: PasswordSchema(PASSWORD_MIN_LENGTH).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((r) => r.role !== undefined || r.password !== undefined || r.disabled !== undefined, {
    message: 'nessun campo da modificare',
  });
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/** Never the password nor its hash. */
export const UserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: UserRoleSchema,
  createdAt: z.iso.datetime(),
  /** A disabled user cannot log in (missing in an older answer: active). */
  disabled: z.boolean().default(false),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const CreateAgentRequestSchema = z.object({ name: plainText(100) });
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const AgentSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  revoked: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** End of the validity of the registration (past it the ingest answers 401); null: no expiry. */
  expiresAt: z.iso.datetime().nullable().default(null),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

/**
 * Validity of an agent: `expiresAt` null «Senza scadenza», otherwise «Fino al» that time (in the future). Body of
 * `POST /api/admin/agent-registrations/:id/approve` (empty body: no expiry) and of `PATCH /api/admin/agents/:id`
 * (prolong or shorten).
 */
export const AgentValidityRequestSchema = z.strictObject({
  expiresAt: z.iso.datetime().nullable().default(null),
});
export type AgentValidityRequest = z.infer<typeof AgentValidityRequestSchema>;

/**
 * `GET /api/admin/agent-quota`: agents the client can have (given by the superadmin) and the ones counted now (not
 * revoked and not expired, plus the registrations enabled and not collected yet).
 */
export const AgentQuotaResponseSchema = z.object({ quota: AgentQuotaSchema, used: z.number().int().nonnegative() });
export type AgentQuotaResponse = z.infer<typeof AgentQuotaResponseSchema>;

/** Pure: whether an agent counts as active at `now` (not revoked, not expired). */
export function agentActive(agent: { revoked: boolean; expiresAt: string | null }, now: Date): boolean {
  return !agent.revoked && (agent.expiresAt === null || Date.parse(agent.expiresAt) > now.getTime());
}

/** State of an agent registration as stored; `expired` is derived from `expiresAt`. */
export const AgentRegistrationStateSchema = z.enum(['pending', 'approved', 'rejected', 'consumed']);
export type AgentRegistrationState = z.infer<typeof AgentRegistrationStateSchema>;

/** Registration request seen by the admin (`GET /api/admin/agent-registrations`, approve, reject). */
export const AgentRegistrationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  pairingCode: PairingCodeSchema,
  /** Address of the client that asked (as seen by the server, behind the proxy with TRUST_PROXY=true). */
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: AgentRegistrationStateSchema,
});
export type AgentRegistrationSummary = z.infer<typeof AgentRegistrationSummarySchema>;

/** The clear token is returned only here, once. */
export const CreateAgentResponseSchema = AgentSummarySchema.extend({ token: z.string() });
export type CreateAgentResponse = z.infer<typeof CreateAgentResponseSchema>;

/**
 * `matchId` null: the channel of the club («tutte le partite del calendario»: the match live now, otherwise the next
 * broadcast match with its countdown, after a match the finished one until the day of the next). `expiresAt` null:
 * no expiry.
 */
export const CreateShareTokenRequestSchema = z.object({
  label: plainText(100),
  matchId: z.uuid().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type CreateShareTokenRequest = z.infer<typeof CreateShareTokenRequestSchema>;

export const ShareTokenSummarySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  matchId: z.uuid().nullable(),
  /** Match of the calendar of the link (created by the server for every match of the club); null for the others. */
  clientFixtureId: z.uuid().nullable().default(null),
  expiresAt: z.iso.datetime().nullable(),
  revoked: z.boolean(),
  createdAt: z.iso.datetime(),
  /** Canonical short code (derived again from the id at every list); null for a revoked link. */
  shortCode: z.string().regex(SHORT_CODE_PATTERN).nullable(),
  /** `<public base URL of the client>/l/<shortCode>`; null for a revoked link. */
  shortUrl: z.url().nullable(),
});
export type ShareTokenSummary = z.infer<typeof ShareTokenSummarySchema>;

/** The clear token and its public URL (`<PUBLIC_BASE_URL>/live/<token>`) are returned only here, once. */
export const CreateShareTokenResponseSchema = ShareTokenSummarySchema.extend({ token: z.string(), url: z.url() });
export type CreateShareTokenResponse = z.infer<typeof CreateShareTokenResponseSchema>;

export interface MatchSummary {
  id: string;
  matchKey: string;
  live: boolean;
  lineCount: number;
  version: number;
  homeName: string | null;
  awayName: string | null;
  setsWon: { home: number; away: number } | null;
  status: MatchStatus | null;
  createdAt: string;
  updatedAt: string;
}

export const MatchSummarySchema = z.object({
  id: z.uuid(),
  matchKey: MatchKeySchema,
  live: z.boolean(),
  lineCount: z.int().min(0),
  version: z.int().min(0),
  homeName: z.string().nullable(),
  awayName: z.string().nullable(),
  setsWon: z.object({ home: z.int(), away: z.int() }).nullable(),
  status: z.enum(['notStarted', 'inProgress', 'finished']).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}) satisfies z.ZodType<MatchSummary>;

export interface MatchDetail extends MatchSummary {
  lastSeq: number;
  contentHash: string | null;
  state: MatchState | null;
}

/** Body of `GET /api/admin/matches/:id`. `lastSeq` is -1 before the first accepted ingest. */
export const MatchDetailSchema = MatchSummarySchema.extend({
  lastSeq: z.int().min(-1),
  contentHash: z.string().nullable(),
  state: MatchStateSchema.nullable(),
}) satisfies z.ZodType<MatchDetail>;
