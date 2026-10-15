/**
 * Pauses of the public page (pure functions, no DOM): which pause the phase of the match opens with the
 * configuration of the client (`TenantIntermissions` of @sir/shared), and the slides it can really show. The phase
 * and every number come from @sir/volley-stats: nothing is computed here.
 */
import type { Intermission, IntermissionKind, IntermissionSlide, TenantIntermissions } from '@sir/shared';
import { intermissionFor } from '@sir/shared';
import type { MatchPhase, MatchState, Side } from '@sir/volley-stats';
import { matchMvp, setRecap } from '@sir/volley-stats';

/** A pause the page can open: its kind, the configuration chosen for it and the phase that opened it. */
export interface ActivePause {
  kind: IntermissionKind;
  /** Different for every pause of the match (same time-out: same key), to remember the one closed by the viewer. */
  key: string;
  /** Set the pause is about: the set just closed, the set of the time-out, the last set of the match. */
  set: number;
  /** Team that called the time-out. */
  team: Side | null;
  pause: Intermission;
}

/** Phase of a state; null for a state stored before the phase existed. */
export function phaseOf(state: MatchState): MatchPhase | null {
  const phase = (state as Partial<MatchState>).phase;
  return phase && typeof phase === 'object' && 'kind' in phase ? phase : null;
}

/** A pause of the phase without its configuration; null outside the pauses (before the match, in play). */
export function describePause(phase: MatchPhase | null): Omit<ActivePause, 'pause'> | null {
  if (!phase) return null;
  switch (phase.kind) {
    case 'timeout':
      return {
        kind: 'timeout',
        key: `timeout-${phase.set}-${phase.team}-${phase.teamTimeouts}`,
        set: phase.set,
        team: phase.team,
      };
    case 'setBreak':
      return { kind: 'setBreak', key: `setBreak-${phase.set}`, set: phase.set, team: null };
    case 'matchEnd':
      return { kind: 'matchEnd', key: 'matchEnd', set: phase.lastSet, team: null };
    default:
      return null;
  }
}

/** Pause opened by the phase of `state` with the configuration of the client; null when none (or it is off). */
export function activePause(state: MatchState, config: TenantIntermissions): ActivePause | null {
  const described = describePause(phaseOf(state));
  if (!described) return null;
  const pause = intermissionFor(config, described.kind, described.set);
  return pause ? { ...described, pause } : null;
}

/** What a slide needs besides its options. */
export interface SlideContext {
  /** Sponsor logo of the branding, shown by a sponsor slide without images of its own. */
  sponsorLogo: string | null;
}

/**
 * Slides of a pause that have something to show: a sponsor slide needs images (or the sponsor logo of the branding),
 * the summary of the set needs the set, the MVP a player with points.
 */
export function visibleSlides(
  state: MatchState,
  active: Pick<ActivePause, 'set' | 'pause'>,
  context: SlideContext,
): IntermissionSlide[] {
  return active.pause.slides.filter((slide) => {
    switch (slide.type) {
      case 'sponsor':
        return slide.options.images.length > 0 || context.sponsorLogo !== null;
      case 'setSummary':
        return setRecap(state, active.set) !== null;
      case 'mvp':
        return matchMvp(state) !== null;
      case 'setScores':
      case 'finalResult':
        return state.sets.length > 0;
      default:
        return true;
    }
  });
}

/** Headline of a pause, e.g. «Fine 2° set», «Time-out Alfa», «Fine partita». */
export function pauseTitle(
  active: Pick<ActivePause, 'kind' | 'set' | 'team'>,
  teamLabel: (side: Side) => string,
): string {
  switch (active.kind) {
    case 'timeout':
      return active.team ? `Time-out ${teamLabel(active.team)}` : 'Time-out';
    case 'setBreak':
      return `Fine ${active.set}° set`;
    case 'matchEnd':
      return 'Fine partita';
  }
}

/**
 * Example state for the preview of a pause in the reserved area: the state given (live or the example match) with
 * the phase of that pause. For `setBreak`: the end of `set` when the match has it, otherwise of its last closed set
 * (the example match is in the 2nd set).
 */
export function previewState(state: MatchState, kind: IntermissionKind, set?: number): MatchState {
  const sets = state.sets;
  const last = sets[sets.length - 1]?.number ?? 1;
  let phase: MatchPhase;
  if (kind === 'timeout') {
    phase = {
      kind,
      set: state.live.set,
      team: 'home',
      teamTimeouts: 1,
      homeScore: state.live.homeScore,
      awayScore: state.live.awayScore,
    };
  } else if (kind === 'setBreak') {
    const closed = sets.filter((s) => s.finished);
    const chosen = sets.find((s) => s.number === set) ?? closed[closed.length - 1] ?? sets[0];
    const number = chosen?.number ?? 1;
    phase = {
      kind,
      set: number,
      nextSet: number + 1,
      winner: chosen?.winner ?? null,
      homeScore: chosen?.homeScore ?? 0,
      awayScore: chosen?.awayScore ?? 0,
    };
  } else {
    const { home, away } = state.setsWon;
    phase = {
      kind,
      winner: home === away ? null : home > away ? 'home' : 'away',
      setsWon: { ...state.setsWon },
      lastSet: last,
    };
  }
  return { ...state, phase };
}
