import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db/index.js';
import { shareTokens } from './db/index.js';
import { deriveShortCode, shortCodeLookupHash } from './lib/shortCode.js';
import { hashesEqual } from './lib/tokens.js';

type ShareRow = typeof shareTokens.$inferSelect;
type NewShareRow = Omit<typeof shareTokens.$inferInsert, 'id' | 'shortCodeHash' | 'shortCodeSalt'>;

/**
 * Salts tried before giving up. Two links share a code with probability about n²/2⁴¹ (n links): a second salt is
 * already very unlikely, the limit only stops an endless loop.
 */
export const MAX_SHORT_CODE_SALT = 16;

export class ShortCodeError extends Error {
  readonly code = 'SHORT_CODE_UNAVAILABLE';
}

/** True for the PostgreSQL error of a unique constraint (also when wrapped by Drizzle in `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 4; depth++) {
    if ('code' in e && e.code === '23505') return true;
    e = 'cause' in e ? e.cause : undefined;
  }
  return false;
}

/** Pure: short code of a row when its stored hash matches the current secret, else null (none yet, secret changed). */
export function currentShortCode(
  secret: string,
  row: Pick<ShareRow, 'id' | 'shortCodeHash' | 'shortCodeSalt'>,
): string | null {
  if (!row.shortCodeHash) return null;
  const code = deriveShortCode(secret, row.id, row.shortCodeSalt);
  return hashesEqual(shortCodeLookupHash(secret, code), row.shortCodeHash) ? code : null;
}

/**
 * New public link with its short code: the id is chosen here so the code (HMAC of the id) is known before the
 * insert; only its keyed hash (`shortCodeLookupHash`) is stored. A collision with the code of another link moves to the next salt.
 */
export async function insertShareToken(
  db: Db,
  secret: string,
  values: NewShareRow,
): Promise<{ row: ShareRow; code: string }> {
  const id = randomUUID();
  for (let salt = 0; salt < MAX_SHORT_CODE_SALT; salt++) {
    const code = deriveShortCode(secret, id, salt);
    const [row] = await db
      .insert(shareTokens)
      .values({ ...values, id, shortCodeHash: shortCodeLookupHash(secret, code), shortCodeSalt: salt })
      .onConflictDoNothing({ target: shareTokens.shortCodeHash })
      .returning();
    if (row) return { row, code };
  }
  throw new ShortCodeError('nessun codice breve libero');
}

/**
 * Short code of an existing link, assigned (or assigned again, after a change of SHARE_CODE_SECRET) when the stored
 * hash does not match the current secret. Returns the code and the row as stored.
 */
export async function ensureShortCode(db: Db, secret: string, row: ShareRow): Promise<{ row: ShareRow; code: string }> {
  const current = currentShortCode(secret, row);
  if (current) return { row, code: current };
  for (let salt = 0; salt < MAX_SHORT_CODE_SALT; salt++) {
    const code = deriveShortCode(secret, row.id, salt);
    const hash = shortCodeLookupHash(secret, code);
    const [taken] = await db
      .select({ id: shareTokens.id })
      .from(shareTokens)
      .where(eq(shareTokens.shortCodeHash, hash))
      .limit(1);
    if (taken && taken.id !== row.id) continue;
    try {
      const [updated] = await db
        .update(shareTokens)
        .set({ shortCodeHash: hash, shortCodeSalt: salt })
        .where(and(eq(shareTokens.id, row.id), eq(shareTokens.tenantId, row.tenantId)))
        .returning();
      return { row: updated ?? row, code };
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new ShortCodeError('nessun codice breve libero');
}

/**
 * At the start of the server: every link not revoked gets a short code matching SHARE_CODE_SECRET (the links created
 * before the short codes, and all of them after a change of the secret). Errors are logged, never fatal.
 */
export async function syncShortCodes(db: Db, secret: string, log: FastifyBaseLogger): Promise<number> {
  const rows = await db.select().from(shareTokens).where(eq(shareTokens.revoked, false));
  let changed = 0;
  for (const row of rows) {
    if (currentShortCode(secret, row)) continue;
    try {
      await ensureShortCode(db, secret, row);
      changed++;
    } catch (err) {
      log.error({ err, shareTokenId: row.id }, 'codice breve non assegnato');
    }
  }
  if (changed > 0) log.info({ count: changed }, 'codici brevi dei link pubblici assegnati');
  return changed;
}
