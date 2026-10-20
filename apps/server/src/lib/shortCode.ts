import { createHmac } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@arenalive/shared';

/** Bits of a short code: 8 characters of a 32-letter alphabet, 5 bits each. */
export const SHORT_CODE_BITS = SHORT_CODE_LENGTH * 5;

/**
 * Pure: short code of the public link `id`: the first 40 bits of HMAC-SHA256(secret, id) (with `:<salt>` after the id
 * when salt > 0), written with PAIRING_CODE_ALPHABET (32 letters: every 5 bits are one letter, so it is uniform).
 * Deterministic: the code is never stored, it is derived again whenever it is needed.
 */
export function deriveShortCode(secret: string, id: string, salt = 0): string {
  const mac = createHmac('sha256', secret)
    .update(salt === 0 ? id : `${id}:${salt}`, 'utf8')
    .digest();
  // 40 bits fit a safe integer.
  let value = mac.readUIntBE(0, SHORT_CODE_BITS / 8);
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code = PAIRING_CODE_ALPHABET.charAt(value % 32) + code;
    value = Math.floor(value / 32);
  }
  return code;
}

/**
 * Pure: key of the lookup hashes, derived from SHARE_CODE_SECRET (separate from the derivation of the codes). The label
 * keeps the old name of the product on purpose: the lookup hashes of the short codes are saved in the database and
 * restored from the old production; another label would break every short link (QR codes) already given out.
 */
function lookupKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('sirrealtime:short-code-lookup-key', 'utf8').digest();
}

/**
 * Pure: the only form in which a short code is stored and looked up: HMAC-SHA256(key derived from the secret,
 * `lookup:<code>`), hex. Keyed, so a copy of the database alone does not allow testing the 2⁴⁰ codes offline.
 */
export function shortCodeLookupHash(secret: string, code: string): string {
  return createHmac('sha256', lookupKey(secret)).update(`lookup:${code}`, 'utf8').digest('hex');
}
