import { Rng } from './rng.js';
import type { GeneratedMatch } from './types.js';

const EVALS = ['#', '+', '!', '-'];

/**
 * Simulates the scout correcting a past action: changes the evaluation of exactly one action row,
 * searching from `lineIndex` (then backwards), only among the first `visible` rows (those already written
 * in the file), so that a correction is always a change to an already visible row. Returns a new match; the input is not modified.
 * Returns the same match if no row can be corrected.
 */
export function applyCorrection(
  match: GeneratedMatch,
  lineIndex: number,
  seed: number,
  visible: number = match.lines.length,
): GeneratedMatch {
  const rng = new Rng(seed);
  const total = Math.min(visible, match.lines.length);
  const editable = (i: number): boolean => {
    if (i < 0 || i >= total) return false;
    const l = match.lines[i];
    return !!l && l.kind === 'action' && /^.\d\d[RED][A-Z][+!-]/.test(l.code);
  };
  if (total <= 0) return match;
  const start = Math.min(Math.max(lineIndex, 0), total - 1);
  let target = -1;
  for (let d = 0; d < total && target < 0; d++) {
    if (editable(start - d)) target = start - d;
    else if (editable(start + d)) target = start + d;
  }
  if (target < 0) return match;
  const line = match.lines[target];
  if (!line) return match;
  const current = line.code.charAt(5);
  const next = rng.pick(EVALS.filter((e) => e !== current));
  const lines = match.lines.map((l, i) =>
    i === target ? { ...l, code: `${l.code.slice(0, 5)}${next}${l.code.slice(6)}` } : l,
  );
  return { ...match, lines };
}
