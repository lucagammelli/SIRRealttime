import type { MatchState, MatchStatus } from '@sir/volley-stats';
import { z } from 'zod';
import { MatchKeySchema } from './ingest.js';
import { MatchStateSchema } from './messages.js';
import { PairingCodeSchema } from './registration.js';
import { hasNoControlChars, plainText, safeString } from './strings.js';
import { TenantRefSchema } from './tenant.js';

/** Public share token: random ≥ 128 bit, base64url. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
export const ShareTokenParamSchema = z.object({ token: z.string().regex(SHARE_TOKEN_PATTERN) });

export const IdParamSchema = z.object({ id: z.uuid() });

/** `superadmin`: no client, creates the clients and works on any of them; `admin`/`viewer`: users of one client. */
export const UserRoleSchema = z.enum(['superadmin', 'admin', 'viewer']);
export type UserRole = z.infer<typeof UserRoleSchema>;
/** Roles that can be given from the admin area (a superadmin comes only from ADMIN_EMAIL). */
export const TenantUserRoleSchema = z.enum(['admin', 'viewer']);
export type TenantUserRole = z.infer<typeof TenantUserRoleSchema>;

const EmailSchema = z
  .email()
  .max(254)
  .refine(hasNoControlChars, { message: 'caratteri di controllo non ammessi' })
  .transform((e) => e.toLowerCase());
const PasswordSchema = (min: number) => safeString().min(min).max(1024);
/** Minimum length of a new password. */
export const PASSWORD_MIN_LENGTH = 12;

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

export const CreateUserRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema(PASSWORD_MIN_LENGTH),
  role: TenantUserRoleSchema,
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: UserRoleSchema,
  createdAt: z.iso.datetime(),
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
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

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

/** `matchId` null: the link follows the live match. `expiresAt` null: no expiry. */
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
  expiresAt: z.iso.datetime().nullable(),
  revoked: z.boolean(),
  createdAt: z.iso.datetime(),
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
