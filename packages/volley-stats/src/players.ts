import type { PlayerInfo } from '@sir/dvw-parser';
import type { PlayerRef } from './types.js';

/** Anagrafica dei giocatori con un numero di maglia (righe [3PLAYERS-*] senza numero ignorate). */
export function playerRefs(players: PlayerInfo[]): PlayerRef[] {
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
