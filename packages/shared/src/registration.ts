import { z } from 'zod';
import { plainText } from './strings.js';

/**
 * Self-registration of an agent (pairing of a device): the agent asks with a name, an admin approves it from the
 * portal after checking the pairing code, the agent receives its token once.
 */

/** Characters of the pairing code: upper case letters and digits without the ambiguous ones (0/O, 1/I). */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;
export const PairingCodeSchema = z
  .string()
  .length(PAIRING_CODE_LENGTH)
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);

/** Registration secret and agent token: random 256 bit, base64url (same format as the other tokens). */
const SecretSchema = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);

/** Body of `POST /api/agents/registrations` (public). */
export const CreateRegistrationRequestSchema = z.object({ name: plainText(100) });
export type CreateRegistrationRequest = z.infer<typeof CreateRegistrationRequestSchema>;

/**
 * Answer to the creation. `secret` is kept by the agent and sent as `Authorization: Bearer <secret>` to
 * `POST /api/agents/registrations/status`; the server stores only its hash. `pairingCode` is shown on the PC.
 */
export const CreateRegistrationResponseSchema = z.object({
  registrationId: z.uuid(),
  secret: SecretSchema,
  pairingCode: PairingCodeSchema,
  expiresAt: z.iso.datetime(),
});
export type CreateRegistrationResponse = z.infer<typeof CreateRegistrationResponseSchema>;

/**
 * Answer of `POST /api/agents/registrations/status`.
 * - `pending`: waiting for the admin;
 * - `approved`: the clear agent token, returned only on the first query after the approval;
 * - `consumed`: the token was already delivered (it is never returned again; if lost, register again);
 * - `rejected`: refused by the admin;
 * - `expired`: not approved, or approved but not collected, within the expiry.
 */
export const RegistrationStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), expiresAt: z.iso.datetime() }),
  z.object({ status: z.literal('approved'), token: SecretSchema, agentId: z.uuid() }),
  z.object({ status: z.literal('consumed') }),
  z.object({ status: z.literal('rejected') }),
  z.object({ status: z.literal('expired') }),
]);
export type RegistrationStatusResponse = z.infer<typeof RegistrationStatusResponseSchema>;

/**
 * `error` of the 401 of `POST /api/ingest` when the registration of the agent has expired (validity chosen at the
 * approval): the agent shows it and proposes to register again.
 */
export const AGENT_EXPIRED_ERROR = 'Registrazione scaduta: registrati di nuovo';
