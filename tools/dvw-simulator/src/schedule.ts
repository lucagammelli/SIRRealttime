/**
 * Pure timing of a replay: when each scout line of a match is sent, from the start of the replay. Used by the
 * simulation of the server (a generated match, an example `.dvw` or an uploaded one): no I/O, no current time.
 */

/** What the timing needs of a scout line (a `ScoutEntry` of `@arenalive/dvw-parser` fits). */
export interface PlaybackLine {
  /** Kind of the line (`point`, `setEnd`, `timeout`, …; anything else counts as an action). */
  kind: string;
  /** Time `HH.MM.SS` written by DataVolley, if any. */
  time?: string | undefined;
}

/**
 * `duration`: every set lasts `setSeconds` and every break between two sets `breakSeconds` (the lines of a set are
 * spread over it following their own rhythm). `speed`: the real rhythm of the lines (their times; without times an
 * average realistic rhythm) accelerated `speed` times.
 */
export type PlaybackPace =
  { kind: 'duration'; setSeconds: number; breakSeconds: number } | { kind: 'speed'; speed: number };

export interface PlaybackSet {
  /** 1-based, in order of the `**Nset` lines. */
  number: number;
  startMs: number;
  endMs: number;
}

export interface PlaybackPlan {
  /** Milliseconds from the start at which line `i` is sent; never decreasing, the first is 0. */
  offsetsMs: number[];
  /** Offset of the last line (0 without lines). */
  totalMs: number;
  /** Sets with at least one point, with their span. */
  sets: PlaybackSet[];
}

/**
 * Average rhythm of a match without times (simulated seconds after a line of that kind), close to the generator:
 * a few seconds between the touches of a rally, about 20 s between two rallies, a minute for a timeout, five minutes
 * between two sets.
 */
export const AVERAGE_GAP_SECONDS = { action: 3, point: 20, timeout: 60, setEnd: 300 } as const;

/** A longer gap between two timed lines (the scoutman stopped, a wrong clock) counts as this many seconds. */
export const MAX_REAL_GAP_SECONDS = 600;

const DAY_SECONDS = 86_400;
const TIME = /^(\d{1,2})\.(\d{2})\.(\d{2})$/;

/** Pure: seconds since midnight of a `HH.MM.SS` time, null when it is missing or not a valid time. */
export function timeSeconds(time: string | undefined): number | null {
  const m = time ? TIME.exec(time.trim()) : null;
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

const averageGap = (kind: string): number =>
  kind === 'point' || kind === 'timeout' || kind === 'setEnd' ? AVERAGE_GAP_SECONDS[kind] : AVERAGE_GAP_SECONDS.action;

/**
 * Pure: the match time (seconds from its first line) of every line. With times: the gap from the previous timed
 * line (past midnight it goes on, a line back in time keeps the previous time, a gap over MAX_REAL_GAP_SECONDS is
 * cut to it); a line without a valid time, and every line of a file with times on fewer than half of its lines,
 * takes the average gap after the line before it.
 */
export function matchSeconds(lines: readonly PlaybackLine[]): number[] {
  const times = lines.map((l) => timeSeconds(l.time));
  const timed = times.filter((t) => t !== null).length;
  const useTimes = lines.length > 0 && timed * 2 >= lines.length;
  const out: number[] = [];
  let current = 0;
  let lastTime: number | null = null;
  lines.forEach((line, i) => {
    const t = useTimes ? (times[i] ?? null) : null;
    if (i > 0) {
      const previous = lines[i - 1];
      if (t !== null && lastTime !== null) {
        let gap = t - lastTime;
        if (gap < -DAY_SECONDS / 2) gap += DAY_SECONDS;
        current += Math.min(Math.max(gap, 0), MAX_REAL_GAP_SECONDS);
      } else if (previous) {
        current += averageGap(previous.kind);
      }
    }
    if (t !== null) lastTime = t;
    out.push(current);
  });
  return out;
}

/** Pure: index of the set of every line (1-based): a `setEnd` line closes its set, the next line opens the next. */
function setOfLines(lines: readonly PlaybackLine[]): number[] {
  let set = 1;
  return lines.map((l) => {
    const current = set;
    if (l.kind === 'setEnd') set++;
    return current;
  });
}

/** Pure: when each line is sent (see `PlaybackPace`), deterministic for the same lines and pace. */
export function planPlayback(lines: readonly PlaybackLine[], pace: PlaybackPace): PlaybackPlan {
  const seconds = matchSeconds(lines);
  const setOf = setOfLines(lines);
  const groups = new Map<number, number[]>();
  setOf.forEach((s, i) => {
    const group = groups.get(s);
    if (group) group.push(i);
    else groups.set(s, [i]);
  });
  const offsetsMs = new Array<number>(lines.length).fill(0);
  const sets: PlaybackSet[] = [];

  if (pace.kind === 'speed') {
    const speed = pace.speed > 0 ? pace.speed : 1;
    seconds.forEach((s, i) => (offsetsMs[i] = Math.round((s * 1000) / speed)));
  } else {
    const setMs = Math.max(0, pace.setSeconds) * 1000;
    const breakMs = Math.max(0, pace.breakSeconds) * 1000;
    let end = 0;
    let played = 0;
    for (const indexes of groups.values()) {
      const withPoints = indexes.some((i) => lines[i]?.kind === 'point');
      // Lines out of a set (after the last one, or a file without points) go right after what came before.
      const start = withPoints && played > 0 ? end + breakMs : end;
      const span = withPoints ? setMs : 0;
      const first = seconds[indexes[0] ?? 0] ?? 0;
      const last = seconds[indexes.at(-1) ?? 0] ?? 0;
      indexes.forEach((i, k) => {
        const own =
          last > first
            ? ((seconds[i] ?? first) - first) / (last - first)
            : indexes.length > 1
              ? k / (indexes.length - 1)
              : 1;
        offsetsMs[i] = Math.round(start + own * span);
      });
      end = start + span;
      if (withPoints) played++;
    }
    // The first line of the replay is sent at once.
    const shift = offsetsMs[0] ?? 0;
    for (let i = 0; i < offsetsMs.length; i++) offsetsMs[i] = Math.max(0, (offsetsMs[i] ?? 0) - shift);
  }
  for (let i = 1; i < offsetsMs.length; i++) offsetsMs[i] = Math.max(offsetsMs[i] ?? 0, offsetsMs[i - 1] ?? 0);
  for (const [number, indexes] of groups) {
    if (!indexes.some((i) => lines[i]?.kind === 'point')) continue;
    sets.push({ number, startMs: offsetsMs[indexes[0] ?? 0] ?? 0, endMs: offsetsMs[indexes.at(-1) ?? 0] ?? 0 });
  }
  return { offsetsMs, totalMs: offsetsMs.at(-1) ?? 0, sets };
}
