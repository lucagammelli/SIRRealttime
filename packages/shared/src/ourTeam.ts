import type { Side, TeamRef } from '@arenalive/volley-stats';
import { z } from 'zod';
import { plainText } from './strings.js';

/** Longest team code of DataVolley the client can write (the files use 3-6 characters). */
export const OUR_TEAM_CODE_MAX = 10;
/** Longest text searched in the team names. */
export const OUR_TEAM_NAME_MAX = 60;

/**
 * Team of the client («nostra squadra»), recognized in the `.dvw` of every match: by the team code of the file (e.g.
 * `PER`) and/or by a text contained in the team name (e.g. «Perugia»), both without case and accents. Both null:
 * no team of the client (the colours of home and away team stay as they are).
 */
export const OurTeamSchema = z.strictObject({
  code: plainText(OUR_TEAM_CODE_MAX).nullable().default(null),
  name: plainText(OUR_TEAM_NAME_MAX).nullable().default(null),
});
export type OurTeam = z.output<typeof OurTeamSchema>;

/** Pure: text for the comparison: accents removed, lower case, spaces collapsed and trimmed. */
export function normalizeTeamText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const SIDES: readonly Side[] = ['home', 'away'];

/** Pure: the only side matching `test`, null for none or both. */
function onlySide(test: (side: Side) => boolean): Side | null {
  const found = SIDES.filter(test);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Pure: side of the team of the client in a match, null when no team (or both) matches. The code is checked first
 * (same code, without case and accents), then the text in the name (contained in it).
 */
export function ourTeamSide(teams: Record<Side, TeamRef>, ourTeam: OurTeam | null | undefined): Side | null {
  const code = ourTeam?.code ? normalizeTeamText(ourTeam.code) : '';
  const name = ourTeam?.name ? normalizeTeamText(ourTeam.name) : '';
  if (code) {
    const byCode = onlySide((side) => normalizeTeamText(teams[side].code ?? '') === code);
    if (byCode) return byCode;
  }
  if (name) return onlySide((side) => normalizeTeamText(teams[side].name ?? '').includes(name));
  return null;
}

/** Colour role of a side: our team, the opponent, or its own home/away colour (no team of the client on court). */
export type TeamColorRole = 'our' | 'opponent' | 'home' | 'away';

/** Pure: colour role of each side when our team plays on `ourSide` (null: home and away colours). */
export function teamColorRoles(ourSide: Side | null): Record<Side, TeamColorRole> {
  if (ourSide === 'home') return { home: 'our', away: 'opponent' };
  if (ourSide === 'away') return { home: 'opponent', away: 'our' };
  return { home: 'home', away: 'away' };
}
