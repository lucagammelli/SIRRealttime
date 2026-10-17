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
