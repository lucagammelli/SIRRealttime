import { open, rename, writeFile } from 'node:fs/promises';
import { applyCorrection } from './correction.js';
import { renderDvw } from './render.js';
import { Rng } from './rng.js';
import type { GeneratedMatch } from './types.js';

export interface PlayOptions {
  /** Output .dvw path. */
  out: string;
  /** Time acceleration: simulated seconds / speed = real seconds. */
  speed: number;
  /** `atomic`: temp file + rename. `direct`: in-place write in two chunks (half-read file). */
  mode: 'atomic' | 'direct';
  /** Sometimes corrects a past row. */
  corrections: boolean;
  signal?: AbortSignal;
  /** Seed of the random choices of the corrections. Default 1. */
  seed?: number;
  /**
   * Shortest wait (real seconds) between the end of a set and the next row: at a high speed the simulated break of
   * five minutes would last a few seconds and the break of the portal would not show. Default 0 (no minimum).
   */
  minBreakSeconds?: number;
  /** Called after each rewrite with the number of visible rows. */
  onWrite?: (visibleLines: number) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms < 1) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function writeFileDirect(path: string, data: Uint8Array, pauseMs: number, signal?: AbortSignal): Promise<void> {
  const handle = await open(path, 'w');
  try {
    const half = Math.floor(data.length / 2);
    await handle.write(data.subarray(0, half));
    await sleep(pauseMs, signal);
    await handle.write(data.subarray(half));
  } finally {
    await handle.close();
  }
}

/** Pure: real milliseconds to wait before writing row `n` (1-based): its simulated gap over `speed`, at least the break after a set. */
export function playGapMs(match: GeneratedMatch, n: number, speed: number, minBreakSeconds = 0): number {
  const prev = match.lines[n - 2]?.second ?? 0;
  const gapMs = (((match.lines[n - 1]?.second ?? prev) - prev) * 1000) / speed;
  return match.lines[n - 2]?.kind === 'endset' ? Math.max(gapMs, minBreakSeconds * 1000) : gapMs;
}

/**
 * Replays the match over time: at every new row the whole file is rewritten, as DataVolley does.
 * Resolves when the match is over or the signal is aborted.
 */
export async function play(match: GeneratedMatch, options: PlayOptions): Promise<void> {
  const { out, speed, mode, corrections, signal } = options;
  const rng = new Rng(options.seed ?? 1);
  let current = match;
  const total = match.lines.length;

  const write = async (visible: number, gapMs: number): Promise<void> => {
    const data = renderDvw(current, visible);
    if (mode === 'atomic') {
      const tmp = `${out}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, out);
    } else {
      await writeFileDirect(out, data, Math.min(5, gapMs / 2), signal);
    }
    options.onWrite?.(visible);
  };

  await write(0, 0);
  for (let n = 1; n <= total; n++) {
    if (signal?.aborted) return;
    const gapMs = playGapMs(match, n, speed, options.minBreakSeconds);
    await sleep(gapMs, signal);
    if (signal?.aborted) return;
    if (corrections && n > 5 && rng.chance(0.05)) {
      current = applyCorrection(current, rng.int(0, n - 2), rng.int(1, 2 ** 31), n - 1);
    }
    await write(n, gapMs);
  }
}
