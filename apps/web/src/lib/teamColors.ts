import type { Side } from '@sir/volley-stats';
import type { TeamColorRole } from '@sir/shared';
import { teamColorRoles } from '@sir/shared';

/** Variables of one team colour (tokens.css): the colour, its tint, the text on it and the colour as small text. */
const PARTS = ['', '-soft', '-ink'] as const;

const varsOf = (side: Side, role: TeamColorRole): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const part of PARTS) vars[`--sir-${side}${part}`] = `var(--sir-${role}${part})`;
  vars[`--sir-on-${side}`] = `var(--sir-on-${role})`;
  return vars;
};

/**
 * Pure: CSS variables that point the colours of the two sides to the colours of our team and of the opponent when the
 * team of the client plays on `ourSide` (empty for null: home and away keep their colours). Written on <html> by
 * lib/branding.ts, so the scoreboard, the charts, the court maps, the tables, the overlays and the pauses follow.
 */
export function teamColorVars(ourSide: Side | null): Record<string, string> {
  if (ourSide === null) return {};
  const roles = teamColorRoles(ourSide);
  return { ...varsOf('home', roles.home), ...varsOf('away', roles.away) };
}
