import type { ParsedMatch, PlayerInfo } from '@sir/dvw-parser';
import { computeMomentum } from './momentum.js';
import { computeRotations } from './rotations.js';
import { computeLive, computeSets, computeSetsWon, computeStatus } from './score.js';
import { computeStats } from './stats.js';
import { buildTimeline } from './timeline.js';
import type { MatchState, PlayerRef, TeamRef } from './types.js';
import { computeZones } from './zones.js';

export * from './types.js';

const teamRef = (t: ParsedMatch['home']): TeamRef => ({ name: t?.name ?? null, code: t?.code ?? null });

function playerRefs(players: PlayerInfo[]): PlayerRef[] {
  const out: PlayerRef[] = [];
  for (const p of players) {
    if (p.number === undefined) continue;
    out.push({
      number: p.number,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      role: p.role ?? null,
      specialRole: p.specialRole ?? null,
    });
  }
  return out;
}

/**
 * Stato completo della partita dall'output del parser: funzione pura, deterministica, JSON-serializzabile.
 * Il punteggio viene solo dalle righe `point`. Non lancia per input parziali o malformati.
 */
export function computeMatchState(parsed: ParsedMatch): MatchState {
  const tl = buildTimeline(parsed);
  const sets = computeSets(parsed, tl);
  const setsWon = computeSetsWon(sets);
  return {
    teams: { home: teamRef(parsed.home), away: teamRef(parsed.away) },
    players: { home: playerRefs(parsed.homePlayers), away: playerRefs(parsed.awayPlayers) },
    sets,
    setsWon,
    status: computeStatus(tl, setsWon),
    live: computeLive(tl),
    stats: computeStats(tl.resolved),
    momentum: computeMomentum(tl.points),
    rotations: computeRotations(tl.points),
    zones: computeZones(tl.resolved),
  };
}
