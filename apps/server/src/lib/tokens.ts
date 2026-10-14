import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
