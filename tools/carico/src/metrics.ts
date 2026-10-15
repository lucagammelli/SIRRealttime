/** Pure helpers of the load test: header of a live frame, steps of a match, percentiles. */

export interface FrameHeader {
  type: string;
  matchId: string | null;
  baseVersion: number | null;
  version: number | null;
}

const HEADER = /^\{"type":"(\w+)"(?:,"matchId":"([0-9a-fA-F-]{36})")?(?:,"baseVersion":(\d+))?(?:,"version":(\d+))?/;

/**
 * Type, match and versions of a server message read from the start of its JSON text, without parsing the whole
 * state (the server writes these fields first). Null when the text does not start like a server message.
 */
export function frameHeader(text: string): FrameHeader | null {
  const m = HEADER.exec(text.slice(0, 200));
  if (!m) return null;
  return {
    type: m[1] ?? '',
    matchId: m[2] ?? null,
    baseVersion: m[3] === undefined ? null : Number(m[3]),
    version: m[4] === undefined ? null : Number(m[4]),
  };
}

const POINT = /^[*a]p\d+:\d+/;

/**
 * Number of scout lines visible after each step: one step per point (the lines up to and including a point line),
 * or one per line; the last step always shows every line.
 */
export function stepCounts(lines: readonly string[], step: 'point' | 'line'): number[] {
  const counts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (step === 'line' || POINT.test(lines[i] ?? '')) counts.push(i + 1);
  }
  if (lines.length > 0 && counts.at(-1) !== lines.length) counts.push(lines.length);
  return counts;
}

/** Nearest-rank percentile `p` (0-100) of the ascending list `sorted`; NaN for an empty list. */
function rankOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? Number.NaN;
}

/** Nearest-rank percentile `p` (0-100) of `values`; NaN for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  return rankOf(Array.from(Float64Array.from(values).sort()), p);
}

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarize(values: readonly number[]): Summary {
  const sorted = Array.from(Float64Array.from(values).sort());
  return {
    count: sorted.length,
    p50: rankOf(sorted, 50),
    p95: rankOf(sorted, 95),
    p99: rankOf(sorted, 99),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

/** Adds one to `counts[key]`. */
export function bump(counts: Record<string, number>, key: string | number): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** JSON text with the object keys sorted at every level: equal for equal values whatever their key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
