import type { MatchState, MatchStatus } from '@sir/volley-stats';
import { z } from 'zod';
import { MatchKeySchema } from './ingest.js';
import { hasNoControlChars, plainText, safeString } from './strings.js';

/** Public share token: random ≥ 128 bit, base64url. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
export const ShareTokenParamSchema = z.object({ token: z.string().regex(SHARE_TOKEN_PATTERN) });

export const IdParamSchema = z.object({ id: z.uuid() });

export const UserRoleSchema = z.enum(['admin', 'viewer']);
export type UserRole = z.infer<typeof UserRoleSchema>;

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

export const MeResponseSchema = z.object({ id: z.uuid(), email: z.string(), role: UserRoleSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const CreateUserRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema(PASSWORD_MIN_LENGTH),
  role: UserRoleSchema,
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
