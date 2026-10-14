import type { MatchState, Ratio, StatLine } from '@sir/volley-stats';

export type ComparisonKind = 'count' | 'ratio';

export interface ComparisonRow {
  key: string;
  group: 'Punti' | 'Battuta' | 'Ricezione' | 'Attacco' | 'Muro' | 'Difesa' | 'Errori' | 'Cambio palla';
  label: string;
  kind: ComparisonKind;
  home: number | null;
  away: number | null;
  /** `low`: fewer is better (errors). */
  better: 'high' | 'low';
}

type Pick = (s: StatLine) => number | Ratio;

const STAT_ROWS: {
  key: string;
  group: ComparisonRow['group'];
  label: string;
  kind: ComparisonKind;
  pick: Pick;
  better?: 'low';
}[] = [
  { key: 'points', group: 'Punti', label: 'Punti vinti (attacco, muro, ace)', kind: 'count', pick: (s) => s.points },
  { key: 'aces', group: 'Battuta', label: 'Ace', kind: 'count', pick: (s) => s.serve.aces },
  {
    key: 'serveErrors',
    group: 'Battuta',
    label: 'Errori in battuta',
    kind: 'count',
    pick: (s) => s.serve.errors,
    better: 'low',
  },
  { key: 'serveEff', group: 'Battuta', label: 'Efficienza battuta', kind: 'ratio', pick: (s) => s.serve.efficiency },
  {
    key: 'recPositive',
    group: 'Ricezione',
    label: 'Ricezione positiva',
    kind: 'ratio',
    pick: (s) => s.reception.positivePct,
  },
  {
    key: 'recPerfect',
    group: 'Ricezione',
    label: 'Ricezione perfetta',
    kind: 'ratio',
    pick: (s) => s.reception.perfectPct,
  },
  { key: 'kills', group: 'Attacco', label: 'Punti in attacco', kind: 'count', pick: (s) => s.attack.kills },
  { key: 'killPct', group: 'Attacco', label: 'Attacco: % punti', kind: 'ratio', pick: (s) => s.attack.killPct },
  { key: 'attackEff', group: 'Attacco', label: 'Efficienza attacco', kind: 'ratio', pick: (s) => s.attack.efficiency },
  { key: 'blocks', group: 'Muro', label: 'Punti a muro', kind: 'count', pick: (s) => s.block.kills },
  { key: 'digs', group: 'Difesa', label: 'Difese', kind: 'count', pick: (s) => s.dig.total },
  { key: 'errors', group: 'Errori', label: 'Errori totali', kind: 'count', pick: (s) => s.errors, better: 'low' },
];

/** Line of a team for the whole match (`set` null) or one set; missing set → null. */
export function statLine(state: MatchState, side: 'home' | 'away', set: number | null): StatLine | null {
  const team = state.stats[side];
  return set === null ? team.total : (team.bySet[String(set)] ?? null);
}

/**
 * Rows of the team comparison. Side-out and break point percentages exist only for the whole match
 * (`momentum`), so they are listed only when `set` is null.
 */
export function teamComparison(state: MatchState, set: number | null): ComparisonRow[] {
  const home = statLine(state, 'home', set);
  const away = statLine(state, 'away', set);
  const rows: ComparisonRow[] = STAT_ROWS.map((r) => ({
    key: r.key,
    group: r.group,
    label: r.label,
    kind: r.kind,
    home: home ? r.pick(home) : null,
    away: away ? r.pick(away) : null,
    better: r.better ?? 'high',
  }));
  if (set === null) {
    const m = state.momentum;
    rows.push(
      {
        key: 'sideOut',
        group: 'Cambio palla',
        label: '% cambio palla (side-out)',
        kind: 'ratio',
        home: m.home.sideOutPct,
        away: m.away.sideOutPct,
        better: 'high',
      },
      {
        key: 'breakPoint',
        group: 'Cambio palla',
        label: '% break point',
        kind: 'ratio',
        home: m.home.breakPointPct,
        away: m.away.breakPointPct,
        better: 'high',
      },
    );
  }
  return rows;
}

/**
 * Length (0-1) of the two mirrored bars: counts relative to the larger of the two, ratios on the 0-100% scale
 * (negative efficiencies → empty bar). Null values → 0.
 */
export function barShares(row: ComparisonRow): { home: number; away: number } {
  const h = row.home ?? 0;
  const a = row.away ?? 0;
  if (row.kind === 'ratio') return { home: clamp01(h), away: clamp01(a) };
  const max = Math.max(h, a);
  if (max <= 0) return { home: 0, away: 0 };
  return { home: clamp01(h / max), away: clamp01(a / max) };
}

/** Which team is better on the row (`null` on a tie or with a missing value). */
export function leader(row: ComparisonRow): 'home' | 'away' | null {
  if (row.home === null || row.away === null || row.home === row.away) return null;
  const homeHigher = row.home > row.away;
  return (row.better === 'high') === homeHigher ? 'home' : 'away';
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
