import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { decodeDvw, parseDvw } from '@sir/dvw-parser';
import { SCOUT_SECTION_MARKER, splitDvwText } from '@sir/shared';

/** Header and scout lines of a DVW file, as sent to the server. */
export interface DvwContent {
  header: string;
  lines: string[];
}

const slug = (value: string | undefined, max: number): string =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);

const shortHash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 10);

/**
 * Pure: key of the match, stable across the rewrites of the file. Built from date and time of [3MATCH] and the team
 * codes of [3TEAMS] (normalized) plus a short hash; without them, from the file name. Always matches `MatchKeySchema`
 * and is lowercase (no collisions on case-insensitive file systems).
 */
export function deriveMatchKey(header: string, filePath: string): string {
  const parsed = parseDvw(header);
  const fields = [parsed.match.date, parsed.match.time, parsed.home?.code, parsed.away?.code].map((f) =>
    (f ?? '').trim().replace(/\s+/g, ' ').toLowerCase(),
  );
  const [date, time, home, away] = fields;
  if (date || time) {
    const readable = [slug(date, 12), slug(time, 10), slug(home, 20), slug(away, 20)].filter((s) => s !== '');
    return `${readable.join('_')}_${shortHash(fields.join('\u0000'))}`;
  }
  // win32.basename splits on both \ and /.
  const name = win32.basename(filePath).replace(/\.dvw$/i, '');
  return `file_${slug(name, 60) || 'dvw'}_${shortHash(name.toLowerCase())}`;
}

export type DvwRead =
  /** Never sent (empty file, no `[3SCOUT]` section): wait for the next write. */
  | { kind: 'incomplete'; reason: string }
  /** `endsWithNewline` false: DataVolley may still be writing the file. */
  | { kind: 'content'; content: DvwContent; endsWithNewline: boolean };

// stessa regola di splitDvwText in @sir/shared (la regex non è esportata, shared non si tocca da qui)
const MARKER_LINE = /^[ \t]*\[3SCOUT\][ \t]*$/m;

/** Pure: decodes a read of the file (Windows-1252 or UTF-8) into header and scout lines. */
export function readDvw(bytes: Uint8Array): DvwRead {
  if (bytes.length === 0) return { kind: 'incomplete', reason: 'file vuoto' };
  const text = decodeDvw(bytes);
  if (!MARKER_LINE.test(text)) return { kind: 'incomplete', reason: `sezione ${SCOUT_SECTION_MARKER} assente` };
  const { header, scoutLines } = splitDvwText(text);
  return { kind: 'content', content: { header, lines: scoutLines }, endsWithNewline: /\n$/.test(text) };
}

/**
 * Pure: why a read could be a half-written file, compared with the content last queued for the same match
 * (`base`), or `null` if it can be sent. A suspicious read is sent only when the same bytes are read again at the
 * next stable read: this protects from destructive snapshots and still lets real deletions through.
 */
export function suspicion(
  read: { content: DvwContent; endsWithNewline: boolean },
  base: DvwContent | null,
): string | null {
  if (!read.endsWithNewline) return 'file senza a capo finale';
  if (base && read.content.lines.length < base.lines.length) {
    return `righe scout diminuite da ${base.lines.length} a ${read.content.lines.length}`;
  }
  return null;
}

/** sha256 hex of raw bytes (to recognise the same read twice). */
export const bytesHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
