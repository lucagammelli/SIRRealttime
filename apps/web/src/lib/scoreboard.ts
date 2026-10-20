import type { MatchState, Side } from '@arenalive/volley-stats';

export interface SetPartial {
  number: number;
  home: number;
  away: number;
  winner: Side | null;
  current: boolean;
  durationMinutes: number | null;
}

/** Partial scores of the sets, the one in progress marked `current`. */
export function setPartials(state: MatchState): SetPartial[] {
  return state.sets.map((s) => ({
    number: s.number,
    home: s.homeScore,
    away: s.awayScore,
    winner: s.finished ? s.winner : null,
    current: !s.finished && s.number === state.live.set && state.status !== 'finished',
    durationMinutes: s.durationMinutes,
  }));
}

/** Total minutes played (sum of the set durations that are known), `null` if none is. */
export function matchMinutes(state: MatchState): number | null {
  const known = state.sets.map((s) => s.durationMinutes).filter((m): m is number => m !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/** Headline of the match status. */
export function statusLabel(state: MatchState): string {
  if (state.status === 'notStarted') return 'In attesa del primo punto';
  if (state.status === 'finished') return 'Partita conclusa';
  const current = state.sets.find((s) => s.number === state.live.set);
  if (current?.finished) return `Fine ${state.live.set}° set`;
  return `${state.live.set}° set in corso`;
}

/** Headline of the whole match (scoreboard of the template «SIR VOLLEY»: «Partita in corso · 1 h 34 min»). */
export function matchHeadline(state: MatchState): string {
  if (state.status === 'notStarted') return 'In attesa del primo punto';
  if (state.status === 'finished') return 'Partita conclusa';
  return 'Partita in corso';
}

/** Winner of the match, when finished. */
export function matchWinner(state: MatchState): Side | null {
  if (state.status !== 'finished') return null;
  if (state.setsWon.home === state.setsWon.away) return null;
  return state.setsWon.home > state.setsWon.away ? 'home' : 'away';
}
