import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@arenalive/shared';

/** Random secret of 256 bit, base64url (43 characters). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex: the only form in which tokens are stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex hashes of the same length. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/** Pairing code of an agent registration: PAIRING_CODE_LENGTH characters of PAIRING_CODE_ALPHABET, from crypto. */
export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++)
    code += PAIRING_CODE_ALPHABET.charAt(randomInt(PAIRING_CODE_ALPHABET.length));
  return code;
}
