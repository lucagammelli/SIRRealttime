import { extractScoutLines } from '@sir/dvw-parser';
import { z } from 'zod';
import { hasNoNul } from './strings.js';

/** Version of the agent→server ingest protocol. */
export const INGEST_PROTOCOL = 1;
/** Limits of an ingest request (also enforced by the server). */
export const INGEST_MAX_LINES = 5000;
export const INGEST_MAX_LINE_LENGTH = 2000;
export const INGEST_MAX_HEADER_LENGTH = 512 * 1024;
/** Body size limits of `POST /api/ingest`: bytes on the wire (possibly gzip) and after decompression. */
export const INGEST_MAX_WIRE_BYTES = 2 * 1024 * 1024;
export const INGEST_MAX_DECODED_BYTES = 8 * 1024 * 1024;

/** Line that opens the scout section of a DVW file. */
export const SCOUT_SECTION_MARKER = '[3SCOUT]';

/** A line that opens a DVW section (`[3NAME]`): inside the scout lines it would end the section when rebuilt. */
const SECTION_LINE = /^\s*\[3[A-Z0-9-]+\]\s*$/;

/** One scout line: no line breaks and not a section line. */
export const ScoutLineSchema = z
  .string()
  .max(INGEST_MAX_LINE_LENGTH)
  .refine((l) => !/[\r\n]/.test(l), { message: 'una riga non può contenere a capo' })
  .refine(hasNoNul, { message: 'carattere NUL non ammesso' })
  .refine((l) => !SECTION_LINE.test(l), { message: 'una riga non può aprire una sezione DVW' });

export const MatchKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const IngestKindSchema = z.enum(['append', 'snapshot']);
export type IngestKind = z.infer<typeof IngestKindSchema>;

/**
 * `append`: `lines` are added from `fromIndex`, which must equal the number of lines already stored.
 * `snapshot`: `lines` replace all stored lines (`fromIndex` 0, `header` required).
 * `contentHash`: sha256 hex of all scout lines after applying the request, joined with "\n" ({@link hashScoutLines}).
 * `seq`: grows by at least 1 at each request of the same `matchKey`; a `seq` already seen is a duplicate.
 */
export const IngestRequestSchema = z
  .object({
    protocol: z.literal(INGEST_PROTOCOL),
    matchKey: MatchKeySchema,
    seq: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    kind: IngestKindSchema,
    fromIndex: z.int().min(0),
    lines: z.array(ScoutLineSchema).max(INGEST_MAX_LINES),
    /** Text of the DVW file before the `[3SCOUT]` line (which it must not contain). */
    header: z
      .string()
      .max(INGEST_MAX_HEADER_LENGTH)
      .refine(hasNoNul, { message: 'carattere NUL non ammesso' })
      .refine((h) => !h.includes(SCOUT_SECTION_MARKER), { message: `header non può contenere ${SCOUT_SECTION_MARKER}` })
      .optional(),
    contentHash: Sha256HexSchema,
  })
  .refine((r) => r.kind !== 'snapshot' || r.header !== undefined, {
    message: 'header obbligatorio con snapshot',
    path: ['header'],
  })
  .refine((r) => r.kind !== 'snapshot' || r.fromIndex === 0, {
    message: 'fromIndex deve essere 0 con snapshot',
    path: ['fromIndex'],
  });
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestStatusSchema = z.enum(['ok', 'duplicate', 'needSnapshot']);
export type IngestStatus = z.infer<typeof IngestStatusSchema>;

/**
 * `seq` is the last sequence number accepted by the server for the match (-1 if none),
 * `lineCount` and `contentHash` describe the lines stored on the server.
 */
export const IngestResponseSchema = z.object({
  status: IngestStatusSchema,
  seq: z.int().min(-1),
  lineCount: z.int().min(0),
  contentHash: Sha256HexSchema.optional(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

export interface ScoutDiff {
  kind: IngestKind;
  fromIndex: number;
  lines: string[];
}

/** Pure: `append` of the new lines when `prev` is a prefix of `next` (even with no new lines), otherwise `snapshot`. */
export function diffScoutLines(prev: readonly string[], next: readonly string[]): ScoutDiff {
  const isPrefix = prev.length <= next.length && prev.every((line, i) => line === next[i]);
  if (isPrefix) return { kind: 'append', fromIndex: prev.length, lines: next.slice(prev.length) };
  return { kind: 'snapshot', fromIndex: 0, lines: [...next] };
}

/** sha256 hex of the scout lines joined with "\n" (Web Crypto: works in Node and in the browser). */
export async function hashScoutLines(lines: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(lines.join('\n'));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Pure: splits the decoded text of a DVW file into the header (everything before the `[3SCOUT]` line)
 * and the scout lines (non-empty lines of the section, as the parser reads them).
 */
export function splitDvwText(text: string): { header: string; scoutLines: string[] } {
  const marker = /^[ \t]*\[3SCOUT\][ \t]*$/m.exec(text);
  const header = marker ? text.slice(0, marker.index) : text;
  return { header, scoutLines: extractScoutLines(text) };
}

/** Pure: DVW text rebuilt from a header and the scout lines (inverse of {@link splitDvwText}). */
export function buildDvwText(header: string, scoutLines: readonly string[]): string {
  const head = header.replace(/[\r\n]+$/, '');
  const prefix = head === '' ? '' : `${head}\n`;
  return `${prefix}${SCOUT_SECTION_MARKER}\n${scoutLines.join('\n')}\n`;
}
