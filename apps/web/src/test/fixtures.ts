import { parseDvw } from '@arenalive/dvw-parser';
import { generateMatch, renderDvw } from '@arenalive/dvw-simulator';
import type { MatchState } from '@arenalive/volley-stats';
import { computeMatchState } from '@arenalive/volley-stats';

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

/**
 * The state `base` (default: the middle of the match) in play in its set in progress at `home`-`away`: the scores of
 * the set and of the scoreboard only (the statistics stay those of `base`), for the rules that read the score.
 */
let middle: MatchState | null = null;
export function scoreAt(home: number, away: number, base: MatchState = (middle ??= midMatchState())): MatchState {
  const set = base.live.set;
  return {
    ...base,
    status: 'inProgress',
    sets: base.sets.map((s) => (s.number === set ? { ...s, homeScore: home, awayScore: away, finished: false } : s)),
    live: { ...base.live, homeScore: home, awayScore: away },
    phase: { kind: 'rally', set },
  };
}
