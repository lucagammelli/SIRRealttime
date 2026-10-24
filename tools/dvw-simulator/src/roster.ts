import { FIRST_NAMES, LAST_NAMES } from './names.js';
import type { Rng } from './rng.js';
import type { Role, RosterPlayer, SimPlayer } from './types.js';

/** Players of each role the generator needs: the six on court (setter, opposite, two outside, two middles), a libero. */
const NEEDED: Readonly<Record<Role, number>> = { S: 1, O: 1, H: 2, M: 2, L: 1 };
/** Players of each role of a full team, as a generated one (14 players). */
const FULL: Readonly<Record<Role, number>> = { S: 2, O: 2, H: 4, M: 4, L: 2 };
const ROLES: readonly Role[] = ['S', 'O', 'H', 'M', 'L'];
/** A team with fewer players gets generated ones up to this. */
export const ROSTER_MIN_PLAYERS = 12;
/** Players of the roster used at most (the others are left out): numbers stay free for the generated ones. */
export const ROSTER_MAX_PLAYERS = 30;
/** Generated numbers are taken first from 1 to this, then up to 99. */
const LOW_NUMBERS = 20;

/** Pure: a name usable in a field of the `.dvw` (no `;`, no line breaks or control characters). */
export function dvwField(text: string): string {
  const kept = [...text].map((c) => {
    const code = c.charCodeAt(0);
    return c === ';' || code < 32 || code === 127 ? ' ' : c;
  });
  return kept.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Pure (with the generator `rng`): the players of a team from a real roster. Every player of the roster keeps number,
 * names and role (at most ROSTER_MAX_PLAYERS, numbers 0-99, a repeated number is left out); a player without role
 * takes the first role still missing (the six on court and the libero, then a full team, then outside hitter).
 * When roles are still missing, or the team has fewer than ROSTER_MIN_PLAYERS players, generated players are added
 * with numbers not used by the roster (never two players with one number). Deterministic for the same roster and seed.
 */
export function rosterPlayers(rng: Rng, roster: readonly RosterPlayer[], idBase: number): SimPlayer[] {
  const used = new Set<number>();
  const names = new Set<string>();
  const lastNames = new Set<string>();
  const known: Omit<SimPlayer, 'id'>[] = [];
  const unknown: Omit<SimPlayer, 'id' | 'role'>[] = [];
  for (const p of roster) {
    if (known.length + unknown.length >= ROSTER_MAX_PLAYERS) break;
    if (!Number.isInteger(p.number) || p.number < 0 || p.number > 99 || used.has(p.number)) continue;
    used.add(p.number);
    const lastName = dvwField(p.lastName) || `Giocatore ${p.number}`;
    const firstName = dvwField(p.firstName);
    names.add(`${lastName} ${firstName}`);
    lastNames.add(lastName);
    const player = { number: p.number, lastName, firstName };
    if (p.role) known.push({ ...player, role: p.role });
    else unknown.push(player);
  }
  const players = [...known];
  const count = (role: Role): number => players.filter((p) => p.role === role).length;
  const missing = (target: Readonly<Record<Role, number>>): Role | undefined =>
    ROLES.find((role) => count(role) < target[role]);
  const nextRole = (): Role => missing(NEEDED) ?? missing(FULL) ?? 'H';
  for (const p of unknown) players.push({ ...p, role: nextRole() });

  const free = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((n) => !used.has(n));
  const numbers = [...rng.shuffle(free(1, LOW_NUMBERS)), ...free(LOW_NUMBERS + 1, 99)];
  while (missing(NEEDED) !== undefined || players.length < ROSTER_MIN_PLAYERS) {
    const number = numbers.shift();
    if (number === undefined) break;
    let lastName = rng.pick(LAST_NAMES) as string;
    let firstName = rng.pick(FIRST_NAMES) as string;
    for (let tries = 0; tries < 50 && (lastNames.has(lastName) || names.has(`${lastName} ${firstName}`)); tries++) {
      lastName = rng.pick(LAST_NAMES);
      firstName = rng.pick(FIRST_NAMES);
    }
    names.add(`${lastName} ${firstName}`);
    lastNames.add(lastName);
    players.push({ number, lastName, firstName, role: nextRole() });
  }
  return players.map((p, i) => ({ ...p, id: idBase + i + 1 }));
}
