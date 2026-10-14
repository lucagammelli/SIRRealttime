import type { IngestKind } from '@sir/shared';
import { INGEST_MAX_LINES, diffScoutLines, hashScoutLines } from '@sir/shared';
import type { DvwContent } from './dvw.js';

/** A request still without `protocol`, `matchKey` and `seq` (assigned when it is queued). */
export interface PlannedRequest {
  kind: IngestKind;
  fromIndex: number;
  lines: string[];
  header?: string;
  contentHash: string;
}

/**
 * Pure: the requests that bring the server from `base` (content already sent or queued, `null` if nothing) to `next`.
 * Empty when nothing changed (even with `forceSnapshot`). Snapshot when there is no base, when a past line changed
 * or, if something changed, when `forceSnapshot` is set;
 * the header travels with the snapshot and whenever it changes. Requests of more than `maxLines` lines are split
 * (a long snapshot becomes a snapshot followed by appends); every `contentHash` is that of the lines after the request.
 */
export async function planRequests(
  base: DvwContent | null,
  next: DvwContent,
  forceSnapshot = false,
  maxLines: number = INGEST_MAX_LINES,
): Promise<PlannedRequest[]> {
  const diff = base ? diffScoutLines(base.lines, next.lines) : null;
  const headerChanged = base === null || base.header !== next.header;
  if (diff?.kind === 'append' && diff.lines.length === 0 && !headerChanged) return [];
  const snapshot = diff === null || diff.kind === 'snapshot' || forceSnapshot;

  const start = snapshot || diff === null ? 0 : diff.fromIndex;
  const out: PlannedRequest[] = [];
  let index = start;
  do {
    const end = Math.min(next.lines.length, index + maxLines);
    const first = out.length === 0;
    const kind: IngestKind = first && snapshot ? 'snapshot' : 'append';
    out.push({
      kind,
      fromIndex: kind === 'snapshot' ? 0 : index,
      lines: next.lines.slice(index, end),
      ...(first && (snapshot || headerChanged) ? { header: next.header } : {}),
      contentHash: await hashScoutLines(next.lines.slice(0, end)),
    });
    index = end;
  } while (index < next.lines.length);
  return out;
}
