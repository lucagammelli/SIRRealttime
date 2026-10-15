import { describe, expect, it } from 'vitest';
import {
  formatShortCode,
  normalizeShortCode,
  SHARE_TOKEN_PATTERN,
  SHORT_CODE_LENGTH,
  SHORT_CODE_PATTERN,
  ShareTokenParamSchema,
  ShortCodeSchema,
} from './admin.js';
import { PAIRING_CODE_ALPHABET } from './registration.js';

describe('short code', () => {
  it('uses exactly the pairing alphabet', () => {
    for (const c of PAIRING_CODE_ALPHABET) expect(SHORT_CODE_PATTERN.test(c.repeat(SHORT_CODE_LENGTH))).toBe(true);
    for (const c of '01IOio_') expect(normalizeShortCode(`${c}7M2QX9P`)).toBeNull();
  });

  it('normalizes lower case and the dash in the middle', () => {
    expect(normalizeShortCode('K7M2QX9P')).toBe('K7M2QX9P');
    expect(normalizeShortCode('k7m2-qx9p')).toBe('K7M2QX9P');
    expect(ShortCodeSchema.parse('K7m2-Qx9p')).toBe('K7M2QX9P');
    expect(normalizeShortCode('K7M-2QX9P')).toBeNull();
    expect(normalizeShortCode('K7M2--QX9P')).toBeNull();
    expect(normalizeShortCode('K7M2QX9')).toBeNull();
    expect(normalizeShortCode('K7M2QX9PA')).toBeNull();
    expect(formatShortCode('K7M2QX9P')).toBe('K7M2-QX9P');
  });

  it('tells a long token from a short code in the path', () => {
    const long = 'A'.repeat(43);
    expect(ShareTokenParamSchema.parse({ token: long }).token).toEqual({ kind: 'token', value: long });
    expect(ShareTokenParamSchema.parse({ token: 'k7m2-qx9p' }).token).toEqual({ kind: 'code', value: 'K7M2QX9P' });
    expect(ShareTokenParamSchema.safeParse({ token: 'K7M2QX9' }).success).toBe(false);
    expect(ShareTokenParamSchema.safeParse({ token: 'K7M2/QX9P' }).success).toBe(false);
    for (const ok of [long, 'K7M2QX9P', 'k7m2-qx9p']) expect(SHARE_TOKEN_PATTERN.test(ok)).toBe(true);
    for (const bad of ['short', 'K7M2QX9O', `${'A'.repeat(40)}/..`, `K7M2QX9P${'A'.repeat(5)}`])
      expect(SHARE_TOKEN_PATTERN.test(bad)).toBe(false);
  });
});
