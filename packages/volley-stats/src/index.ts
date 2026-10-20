import type { ParsedMatch } from '@arenalive/dvw-parser';
import { detectEvents, recentEvents } from './events.js';
import { computeMomentum } from './momentum.js';
import { computePhase } from './phase.js';
import { playerRefs } from './players.js';
import { computeRotations } from './rotations.js';
import { computeLive, computeSets, computeSetsWon, computeStatus } from './score.js';
import { computeStats } from './stats.js';
import { buildTimeline } from './timeline.js';
import type { MatchState, TeamRef } from './types.js';
import { computeZones } from './zones.js';

export * from './types.js';
export { topPlayers } from './leaders.js';
export type { TopPlayer, TopPlayersOptions } from './leaders.js';
export { matchMvp, setRecap } from './recap.js';
export { matchPoints, matchStateUntilPoint, pointsExtend } from './replay.js';
export type { MatchPoint } from './replay.js';
export { RECENT_POINTS_LIMIT } from './score.js';
export {
  COMEBACK_MIN_POINTS,
  LONG_RALLY_MIN_ATTACKS,
  MATCH_EVENT_KINDS,
  MATCH_EVENT_PRIORITY,
  matchEvents,
  RECENT_EVENTS_LIMIT,
  recentEvents,
  RUN_MIN_POINTS,
  setPointTeam,
  setTarget,
} from './events.js';
export type { Mvp, SetRecap } from './recap.js';
export {
  DUEL_ROLES,
  MATCH_PERIOD,
  TEAM_DUEL_KEYS,
  periodSummary,
  pointMilestone,
  roleDuels,
  scorers,
  setPeriod,
  teamDuel,
} from './period.js';
export type {
  Period,
  PlayerPeriodLine,
  PeriodSummary,
  PointMilestone,
  RoleDuel,
  Scorer,
  TeamDuelGroup,
  TeamDuelKey,
  TeamDuelRow,
  TeamPeriodSummary,
} from './period.js';

const teamRef = (t: ParsedMatch['home']): TeamRef => ({ name: t?.name ?? null, code: t?.code ?? null });

/**
 * Stato completo della partita dall'output del parser: funzione pura, deterministica, JSON-serializzabile.
 * Il punteggio viene solo dalle righe `point`. Non lancia per input parziali o malformati.
 */
export function computeMatchState(parsed: ParsedMatch): MatchState {
  const tl = buildTimeline(parsed);
  const sets = computeSets(parsed, tl);
  const setsWon = computeSetsWon(sets);
  const status = computeStatus(tl, setsWon);
  const players = { home: playerRefs(parsed.homePlayers), away: playerRefs(parsed.awayPlayers) };
  return {
    teams: { home: teamRef(parsed.home), away: teamRef(parsed.away) },
    players,
    sets,
    setsWon,
    status,
    live: computeLive(tl),
    stats: computeStats(tl.resolved),
    momentum: computeMomentum(tl.points),
    rotations: computeRotations(tl.points),
    zones: computeZones(tl.resolved),
    phase: computePhase(tl, sets, status, setsWon),
    events: recentEvents(detectEvents(tl, players)),
  };
}
