import { z } from 'zod';
import { hasNoControlChars, safeString } from './strings.js';

/** Email of a user: lower case (unique among all the clients). */
export const EmailSchema = z
  .email()
  .max(254)
  .refine(hasNoControlChars, { message: 'caratteri di controllo non ammessi' })
  .transform((e) => e.toLowerCase());

/** Password of at least `min` characters (stored only as an argon2id hash). */
export const PasswordSchema = (min: number) => safeString().min(min).max(1024);

/** Minimum length of a new password. */
export const PASSWORD_MIN_LENGTH = 12;

/** Email and password of a new user (also the first user of a new client). */
export const UserCredentialsSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema(PASSWORD_MIN_LENGTH),
});
export type UserCredentials = z.infer<typeof UserCredentialsSchema>;

/**
 * Email (and optionally the password) of a new user (also the first user of a new client). Without a password the
 * user gets an invitation: a link by email (or to copy, without a mail server) to choose the first password.
 */
export const InvitableUserSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema(PASSWORD_MIN_LENGTH).optional(),
});
export type InvitableUser = z.infer<typeof InvitableUserSchema>;

/** Hours an invitation link stays valid. */
export const INVITE_TTL_HOURS = 72;
/** Hours a password reset link stays valid. */
export const RESET_TTL_HOURS = 1;

/** Format of the one-time tokens of the links (generateToken of the server: 256 bit, base64url). */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
export const LinkTokenSchema = z.string().regex(LINK_TOKEN_PATTERN);

/**
 * What happened to the mail of an invitation: `sent`; `not_configured` (no mail server set in «Posta») or `failed`
 * (the server did not take it): in these two cases `link` is the link to copy and send by hand.
 */
export const InviteDeliverySchema = z.object({
  mail: z.enum(['sent', 'not_configured', 'failed']),
  link: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type InviteDelivery = z.infer<typeof InviteDeliverySchema>;

/** What the page of a link (invitation or reset) shows before asking for the password. */
export const LinkInfoSchema = z.object({
  kind: z.enum(['invite', 'reset']),
  email: z.string(),
  /** Name of the client (null for a superadmin). */
  tenantName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type LinkInfo = z.infer<typeof LinkInfoSchema>;

/** `POST /api/auth/invite/accept` and `POST /api/auth/password-reset/confirm`. */
export const SetPasswordRequestSchema = z.object({
  token: LinkTokenSchema,
  password: PasswordSchema(PASSWORD_MIN_LENGTH),
});
export type SetPasswordRequest = z.infer<typeof SetPasswordRequestSchema>;

/** `POST /api/auth/password-reset/request`. */
export const PasswordResetRequestSchema = z.object({ email: EmailSchema });
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/** The one answer of the request of a password reset: the same whether the email exists or not. */
export const PasswordResetAnswerSchema = z.object({ ok: z.literal(true) });

/** Link to copy (`POST /api/admin/users/:id/reset-link`). */
export const ResetLinkResponseSchema = z.object({ link: z.string(), expiresAt: z.iso.datetime() });
export type ResetLinkResponse = z.infer<typeof ResetLinkResponseSchema>;
