import type { MatchState, Side, ZoneCell } from '@arenalive/volley-stats';

export type ZoneSkill = 'attack' | 'serve';

export interface ZoneFilter {
  side: Side;
  skill: ZoneSkill;
  /** Jersey number, `null` = whole team. */
  player: number | null;
  /** Evaluation symbol (`#+!-/=`), `null` = all. */
  evaluation: string | null;
}

export interface ZoneArrow {
  from: string;
  to: string;
  count: number;
  /** Share of the filtered total (0-1). */
  share: number;
  /** Most frequent evaluation in the cell (with the filter: the filtered one). */
  dominant: string;
  byEvaluation: Record<string, number>;
}

export interface ZoneView {
  arrows: ZoneArrow[];
  total: number;
  /** Count per arrival zone ("1"-"9"). */
  byTarget: Record<string, number>;
  /** Count per starting zone. */
  byOrigin: Record<string, number>;
}

export const EVALUATION_NAMES: Record<ZoneSkill, Record<string, string>> = {
  attack: {
    '#': 'Punto',
    '+': 'Positivo',
    '!': 'Rigiocato',
    '-': 'Negativo',
    '/': 'Murato',
    '=': 'Errore',
    '~': 'Senza valutazione',
  },
  serve: {
    '#': 'Ace',
    '+': 'Positiva',
    '!': 'Buona',
    '-': 'Negativa',
    '/': 'Mezzo punto',
    '=': 'Errore',
    '~': 'Senza valutazione',
  },
};

const ORDER = ['#', '+', '!', '-', '/', '=', '~'];

function cellsOf(state: MatchState, filter: ZoneFilter): ZoneCell[] {
  const team = state.zones[filter.side];
  const maps = filter.player === null ? team : team.players[String(filter.player)];
  return maps ? maps[filter.skill] : [];
}

/** Arrows start→arrival of the filtered actions, largest first. */
export function zoneView(state: MatchState, filter: ZoneFilter): ZoneView {
  const arrows: ZoneArrow[] = [];
  const byTarget: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  let total = 0;
  for (const cell of cellsOf(state, filter)) {
    const count = filter.evaluation === null ? cell.total : (cell.byEvaluation[filter.evaluation] ?? 0);
    if (count <= 0) continue;
    total += count;
    byTarget[cell.to] = (byTarget[cell.to] ?? 0) + count;
    byOrigin[cell.from] = (byOrigin[cell.from] ?? 0) + count;
    arrows.push({
      from: cell.from,
      to: cell.to,
      count,
      share: 0,
      dominant: filter.evaluation ?? dominantOf(cell.byEvaluation),
      byEvaluation: cell.byEvaluation,
    });
  }
  for (const a of arrows) a.share = total > 0 ? a.count / total : 0;
  arrows.sort((x, y) => y.count - x.count || x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  return { arrows, total, byTarget, byOrigin };
}

function dominantOf(byEvaluation: Record<string, number>): string {
  let best = '~';
  let bestCount = -1;
  for (const symbol of ORDER) {
    const n = byEvaluation[symbol] ?? 0;
    if (n > bestCount) {
      best = symbol;
      bestCount = n;
    }
  }
  return best;
}

/** Players of a team that have at least one action of the skill on the map. */
export function zonePlayers(state: MatchState, side: Side, skill: ZoneSkill): number[] {
  return Object.entries(state.zones[side].players)
    .filter(([, maps]) => maps[skill].length > 0)
    .map(([n]) => Number(n))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

/**
 * Court geometry (viewBox 0 0 200 110, net at x = 100, 10 units per metre).
 * The team of the filter plays on the left facing right; the opponent on the right facing left.
 * Zones of a half seen from its own players: front row 4-3-2, middle 7-8-9, back 5-6-1 (left to right).
 */
export const COURT = { x0: 10, x1: 190, y0: 10, y1: 100, net: 100, cell: 30 } as const;

const ROWS_FROM_LEFT_OF_PLAYER: Record<string, { col: 0 | 1 | 2; row: 0 | 1 | 2 }> = {
  // col: 0 back, 1 middle, 2 front (towards the net); row: 0 player's left … 2 player's right.
  '5': { col: 0, row: 0 },
  '6': { col: 0, row: 1 },
  '1': { col: 0, row: 2 },
  '7': { col: 1, row: 0 },
  '8': { col: 1, row: 1 },
  '9': { col: 1, row: 2 },
  '4': { col: 2, row: 0 },
  '3': { col: 2, row: 1 },
  '2': { col: 2, row: 2 },
};

export type CourtHalf = 'own' | 'opponent';

/** Rectangle of a zone (1-9) in a half; `null` for anything else. */
export function zoneRect(zone: string, half: CourtHalf): { x: number; y: number; w: number; h: number } | null {
  const pos = ROWS_FROM_LEFT_OF_PLAYER[zone];
  if (!pos) return null;
  const { x0, net, y0, y1, cell } = COURT;
  const w = cell;
  const h = cell;
  if (half === 'own') {
    // Facing right: the player's left is the top of the drawing.
    return { x: x0 + pos.col * w, y: y0 + pos.row * h, w, h };
  }
  // Facing left: front column next to the net, the player's left is the bottom of the drawing.
  return { x: net + (2 - pos.col) * w, y: y1 - (pos.row + 1) * h, w, h };
}

export function zoneCenter(zone: string, half: CourtHalf): { x: number; y: number } | null {
  const r = zoneRect(zone, half);
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
}

export const ZONES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
