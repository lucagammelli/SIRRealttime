import { parseDvw } from '@sir/dvw-parser';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import type { MatchState } from '@sir/volley-stats';
import { computeMatchState } from '@sir/volley-stats';

const match = generateMatch({ seed: 1 });

/** State of the synthetic match (seed 1) after `lines` scout rows; all rows by default (finished match). */
export function stateAfter(lines: number = match.lines.length): MatchState {
  return computeMatchState(parseDvw(renderDvw(match, lines)));
}

/** State in the middle of the match (second set in progress). */
export function midMatchState(): MatchState {
  return stateAfter(Math.floor(match.lines.length * 0.6));
}

export const totalLines = match.lines.length;
