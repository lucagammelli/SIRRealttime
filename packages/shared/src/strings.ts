import { z } from 'zod';

/** Pure: true when `text` has no NUL character (PostgreSQL text cannot store it). */
export function hasNoNul(text: string): boolean {
  return !text.includes('\u0000');
}

/** Pure: true when `text` has no control character U+0000-U+001F or U+007F. */
export function hasNoControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/** Pure: true when a JSON value contains a string (or object key) with a NUL character. */
export function containsNul(value: unknown): boolean {
  if (typeof value === 'string') return !hasNoNul(value);
  if (Array.isArray(value)) return value.some(containsNul);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, v]) => !hasNoNul(key) || containsNul(v));
  }
  return false;
}

/** String from outside the system: any text except NUL. */
export const safeString = () => z.string().refine(hasNoNul, { message: 'carattere NUL non ammesso' });

/** Single-line text from outside (names, labels, emails): trimmed, no control characters. */
export const plainText = (max: number) =>
  z.string().trim().min(1).max(max).refine(hasNoControlChars, { message: 'caratteri di controllo non ammessi' });
