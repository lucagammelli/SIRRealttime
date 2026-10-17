import { z } from 'zod';
import { EmailSchema, PasswordSchema } from './credentials.js';
import { hasNoControlChars, plainText } from './strings.js';

/** Connection security of the mail server: none, STARTTLS (usually port 587) or TLS from the start (port 465). */
export const SMTP_SECURITIES = ['none', 'starttls', 'tls'] as const;
export const SmtpSecuritySchema = z.enum(SMTP_SECURITIES);
export type SmtpSecurity = z.infer<typeof SmtpSecuritySchema>;

/** Mail server settings as the portal sees them: never the password, only whether it is set. */
export const MailSettingsSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecuritySchema,
  username: z.string(),
  passwordSet: z.boolean(),
  fromName: z.string(),
  fromEmail: z.string(),
  /** Host and sender are set: invitations and password resets go by email. */
  configured: z.boolean(),
  /** SETTINGS_ENCRYPTION_KEY is set on the server: without it the password cannot be saved. */
  encryptionAvailable: z.boolean(),
});
export type MailSettings = z.infer<typeof MailSettingsSchema>;

/**
 * `PUT /api/admin/mail-settings`. `password`: a new one replaces the saved one; missing keeps it;
 * `clearPassword: true` removes it.
 */
export const UpdateMailSettingsRequestSchema = z.strictObject({
  host: plainText(253),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecuritySchema,
  username: z.string().trim().max(254).refine(hasNoControlChars).default(''),
  password: PasswordSchema(1).optional(),
  clearPassword: z.boolean().optional(),
  fromName: plainText(100),
  fromEmail: EmailSchema,
});
export type UpdateMailSettingsRequest = z.infer<typeof UpdateMailSettingsRequestSchema>;

/** Result of «Invia una mail di prova»: `message` is always ready to be shown. */
export const MailTestResponseSchema = z.object({ ok: z.boolean(), message: z.string() });
export type MailTestResponse = z.infer<typeof MailTestResponseSchema>;
