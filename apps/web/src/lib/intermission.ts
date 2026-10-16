/**
 * Pauses of the public page (pure functions, no DOM): which pause the phase of the match opens with the
 * configuration of the client (`TenantIntermissions` of @sir/shared), and the slides it can really show. The phase
 * and every number come from @sir/volley-stats: nothing is computed here.
 */
import type {
  Intermission,
  IntermissionKind,
  IntermissionSlide,
  MilestoneIntermission,
  ScheduleResponse,
  StatPeriod,
  TenantIntermissions,
} from '@sir/shared';
import { intermissionFor } from '@sir/shared';
import type { MatchPhase, MatchState, Period, PointMilestone, Side } from '@sir/volley-stats';
import {
  DUEL_ROLES,
  MATCH_PERIOD,
  matchMvp,
  periodSummary,
  pointMilestone,
  roleDuels,
  setPeriod,
  setRecap,
  teamDuel,
} from '@sir/volley-stats';
import { hasScheduleData } from './schedule.ts';

/** A pause the page can open: its kind, the configuration chosen for it and the phase that opened it. */
export interface ActivePause {
  kind: IntermissionKind;
  /** Different for every pause of the match (same time-out: same key), to remember the one closed by the viewer. */
  key: string;
  /** Set the pause is about: the set just closed, the set of the time-out, the last set of the match. */
  set: number;
  /** Team that called the time-out. */
  team: Side | null;
  /** «Ogni N punti»: score of the set when the threshold was reached. */
  score?: { home: number; away: number };
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

/** Period of the statistics of a slide or a block: the set given (of the pause, in progress) or the whole match. */
export function statPeriod(period: StatPeriod, set: number): Period {
  return period === 'match' ? MATCH_PERIOD : setPeriod(set);
}

/** «1° set», «Partita»: what the statistics of a period are about. */
export function periodLabel(period: Period): string {
  return period.kind === 'match' ? 'Partita' : `${period.set}° set`;
}

/** What a slide needs besides its options. */
export interface SlideContext {
  /** Sponsor logo of the branding, shown by a sponsor slide without images of its own. */
  sponsorLogo: string | null;
  /** Matches and standings of the club (`useSchedule`): «Prossima partita» and «Classifica» need them. */
  schedule?: ScheduleResponse | null;
}

/** Roles that have a player against player duel in the period (first pair of each role), in the order of the duels. */
export function duelRoles(state: MatchState, period: Period): (typeof DUEL_ROLES)[number][] {
  const duels = roleDuels(state, period);
  return DUEL_ROLES.filter((role) => duels.some((d) => d.role === role));
}

/** Whether the statistics slide has something to show in its period (every number from @sir/volley-stats). */
function hasStatistics(state: MatchState, slide: IntermissionSlide, set: number): boolean {
  if (!('period' in slide.options)) return true;
  const period = statPeriod(slide.options.period, set);
  const summary = periodSummary(state, period);
  if (!summary) return false;
  const { home, away } = summary.teams;
  switch (slide.type) {
    case 'setScorers':
      return true;
    case 'aces':
      return home.aces + away.aces > 0;
    case 'blocks':
      return home.blockPoints + away.blockPoints > 0;
    case 'attack':
      return home.attackTotal + away.attackTotal > 0;
    case 'teamDuel':
      return teamDuel(state, period).some((r) => r.home !== null && r.away !== null);
    default:
      return true;
  }
}

/**
 * Slides of a pause that have something to show: a sponsor slide needs images (or the sponsor logo of the branding),
 * the summary of the set needs the set, the MVP a player with points; the statistics of a period need the period
 * (aces, blocks, attacks: at least one), a player duel its role. A player duel `rotate` becomes one slide for every
 * role with a duel (id `<id>:<role>`), each for the seconds of the slide.
 */
export function visibleSlides(
  state: MatchState,
  active: Pick<ActivePause, 'set' | 'pause'>,
  context: SlideContext,
): IntermissionSlide[] {
  return active.pause.slides.flatMap((slide): IntermissionSlide[] => {
    switch (slide.type) {
      case 'sponsor':
        return slide.options.images.length > 0 || context.sponsorLogo !== null ? [slide] : [];
      case 'nextMatch':
      case 'standings':
        return hasScheduleData(slide.type, context.schedule) ? [slide] : [];
      case 'setSummary':
        return setRecap(state, active.set) !== null ? [slide] : [];
      case 'mvp':
        return matchMvp(state) !== null ? [slide] : [];
      case 'setScores':
      case 'finalResult':
        return state.sets.length > 0 ? [slide] : [];
      case 'roleDuel': {
        const roles = duelRoles(state, statPeriod(slide.options.period, active.set));
        if (slide.options.role !== 'rotate') return roles.includes(slide.options.role) ? [slide] : [];
        return roles.map((role) => ({ ...slide, id: `${slide.id}:${role}`, options: { ...slide.options, role } }));
      }
      case 'setScorers':
      case 'aces':
      case 'blocks':
      case 'attack':
      case 'teamDuel':
        return hasStatistics(state, slide, active.set) ? [slide] : [];
      default:
        return [slide];
    }
  });
}

/**
 * Thresholds of «ogni N punti» already met: for every set the highest one (shown or not), and the N they were counted
 * with (another N starts again from the state on screen).
 */
export interface MilestoneMemory {
  every: number;
  bySet: Readonly<Record<string, number>>;
}

/** What the page knows when a new state arrives. */
export interface MilestoneInput {
  /** Pause «ogni N punti» of the client; null when it is off or still loading. */
  pause: MilestoneIntermission | null;
  /** The state is a live update (`LiveData.live`): false for the first state, after a reconnection or a resync. */
  live: boolean;
  /** A more important pause (time-out, end of set, end of match) is on: it goes first. */
  blocked: boolean;
}

/**
 * Pure: the «ogni N punti» rule of `pointMilestone` (@sir/volley-stats) for a new state. A threshold opens the pause
 * only when it is higher than the highest one already met in that set (a scout correction that takes a point back
 * gives a lower threshold: nothing), the state is a live update, no more important pause is on and the set is not in
 * its last `stopBeforeEnd` points (`toTarget` of `pointMilestone`: points to win the set − the higher score). Every threshold met is remembered, also when it does not open (it is never shown later); the
 * first state with a new N is only remembered.
 */
export function milestoneStep(
  memory: MilestoneMemory | null,
  state: MatchState,
  input: MilestoneInput,
): { memory: MilestoneMemory | null; open: PointMilestone | null } {
  const { pause } = input;
  if (!pause || !pause.enabled) return { memory, open: null };
  const milestone = pointMilestone(state, pause.every);
  const fresh = memory === null || memory.every !== pause.every;
  const base: MilestoneMemory = fresh ? { every: pause.every, bySet: {} } : memory;
  if (!milestone) return { memory: base, open: null };
  const key = String(milestone.set);
  const highest = base.bySet[key] ?? 0;
  if (!fresh && milestone.threshold <= highest) return { memory: base, open: null };
  const next: MilestoneMemory = { every: base.every, bySet: { ...base.bySet, [key]: milestone.threshold } };
  const late = milestone.toTarget <= pause.stopBeforeEnd;
  const open = !fresh && input.live && !input.blocked && !late ? milestone : null;
  return { memory: next, open };
}

/** The pause «ogni N punti» of a threshold. */
export function milestonePause(milestone: PointMilestone, pause: Intermission): ActivePause {
  return {
    kind: 'milestone',
    key: `milestone-${milestone.key}`,
    set: milestone.set,
    team: null,
    score: { home: milestone.homeScore, away: milestone.awayScore },
    pause,
  };
}

/** Headline of a pause, e.g. «Fine 2° set», «Time-out Alfa», «Fine partita», «2° set: 9-7». */
export function pauseTitle(
  active: Pick<ActivePause, 'kind' | 'set' | 'team' | 'score'>,
  teamLabel: (side: Side) => string,
): string {
  switch (active.kind) {
    case 'timeout':
      return active.team ? `Time-out ${teamLabel(active.team)}` : 'Time-out';
    case 'setBreak':
      return `Fine ${active.set}° set`;
    case 'matchEnd':
      return 'Fine partita';
    case 'milestone':
      return active.score ? `${active.set}° set: ${active.score.home}-${active.score.away}` : `${active.set}° set`;
  }
}

/**
 * Example state for the preview of a pause in the reserved area: the state given (live or the example match) with
 * the phase of that pause. For `setBreak`: the end of `set` when the match has it, otherwise of its last closed set
 * (the example match is in the 2nd set). For `milestone`: the set in progress, in play.
 */
export function previewState(state: MatchState, kind: IntermissionKind, set?: number): MatchState {
  const sets = state.sets;
  const last = sets[sets.length - 1]?.number ?? 1;
  let phase: MatchPhase;
  if (kind === 'milestone') {
    phase = { kind: 'rally', set: state.live.set };
  } else if (kind === 'timeout') {
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
