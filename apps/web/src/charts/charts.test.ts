import { describe, expect, it } from 'vitest';
import { MATCH_PERIOD, setPeriod, teamDuel } from '@sir/volley-stats';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { barShares, leader, teamComparison } from './compare.ts';
import { breakPointCount, defaultMomentumSet, leadBound, momentumSeries, momentumSets } from './momentum.ts';
import { momentumOption, rotationOption } from './options.ts';
import { playerRows, sortPlayerRows, statSets } from './players.ts';
import { rotationExtremes, rotationSeries } from './rotations.ts';
import { DEFAULT_PALETTE, buildEchartsTheme, richSafe } from './theme.ts';
import { zoneCenter, zonePlayers, zoneRect, zoneView } from './zones.ts';

const final = stateAfter();
const mid = midMatchState();

describe('momentum', () => {
  it('follows the live set and matches the score of the state', () => {
    expect(momentumSets(mid)).toEqual([1, 2]);
    expect(defaultMomentumSet(mid)).toBe(mid.live.set);
    const data = momentumSeries(mid, mid.live.set);
    const last = data.at(-1);
    expect(last?.homeScore).toBe(mid.live.homeScore);
    expect(last?.awayScore).toBe(mid.live.awayScore);
    expect(last?.lead).toBe(mid.live.homeScore - mid.live.awayScore);
    expect(data.map((d) => d.rally)).toEqual(data.map((_, i) => i + 1));
  });

  it('counts break points like volley-stats', () => {
    const total = { home: 0, away: 0 };
    for (const set of momentumSets(final)) {
      const c = breakPointCount(momentumSeries(final, set));
      total.home += c.home;
      total.away += c.away;
    }
    expect(total).toEqual({ home: final.momentum.home.breakPoints, away: final.momentum.away.breakPoints });
  });

  it('builds a symmetric lead axis of at least 3', () => {
    expect(leadBound([])).toBe(3);
    const data = momentumSeries(final, 1);
    expect(leadBound(data)).toBeGreaterThanOrEqual(Math.max(...data.map((d) => Math.abs(d.lead))));
    expect(momentumSeries(final, 9)).toEqual([]);
  });

  it('produces an ECharts option with the break points as dots', () => {
    const data = momentumSeries(final, 1);
    const option = momentumOption(data, DEFAULT_PALETTE, { home: 'PAL', away: 'VOL' }) as {
      series: { data: unknown[] }[];
    };
    expect(option.series).toHaveLength(3);
    expect(option.series[0]?.data).toHaveLength(data.length + 1);
    expect(option.series[2]?.data).toHaveLength(data.filter((d) => d.breakPoint).length);
  });
});

describe('team comparison', () => {
  it('reads every row from the state', () => {
    const rows = teamComparison(final, null);
    const kills = rows.find((r) => r.key === 'kills');
    expect(kills?.home).toBe(final.stats.home.total.attack.kills);
    expect(kills?.away).toBe(final.stats.away.total.attack.kills);
    const so = rows.find((r) => r.key === 'sideOut');
    expect(so?.home).toBe(final.momentum.home.sideOutPct);
  });

  it('is teamDuel of @sir/volley-stats, for the match and for a set', () => {
    expect(teamComparison(final, null)).toEqual(teamDuel(final, MATCH_PERIOD));
    expect(teamComparison(final, 2)).toEqual(teamDuel(final, setPeriod(2)));
  });

  it('per set uses bySet and leaves out the match-only rows', () => {
    const rows = teamComparison(final, 1);
    expect(rows.find((r) => r.key === 'points')?.home).toBe(final.stats.home.bySet['1']?.points);
    expect(rows.some((r) => r.key === 'sideOut')).toBe(false);
    expect(teamComparison(final, 9).every((r) => r.home === null && r.away === null)).toBe(true);
  });

  it('sizes the mirrored bars and finds the better team', () => {
    const count = { key: 'k', group: 'Attacco', label: '', kind: 'count', home: 10, away: 5, better: 'high' } as const;
    expect(barShares(count)).toEqual({ home: 1, away: 0.5 });
    expect(leader(count)).toBe('home');
    expect(leader({ ...count, better: 'low' })).toBe('away');
    const ratio = { ...count, kind: 'ratio', home: 0.42, away: -0.1 } as const;
    expect(barShares(ratio)).toEqual({ home: 0.42, away: 0 });
    expect(barShares({ ...count, home: null, away: 0 })).toEqual({ home: 0, away: 0 });
    expect(leader({ ...count, home: null })).toBeNull();
  });
});

describe('players', () => {
  it('lists the players with actions, with totals equal to the team', () => {
    const rows = playerRows(final, 'home', null);
    expect(rows.length).toBe(Object.keys(final.stats.home.players).length);
    expect(rows.reduce((a, r) => a + r.points, 0)).toBe(final.stats.home.total.points);
    expect(rows.every((r) => !r.name.startsWith('#'))).toBe(true);
  });

  it('filters by set', () => {
    const rows = playerRows(final, 'away', 2);
    expect(rows.reduce((a, r) => a + r.kills, 0)).toBe(final.stats.away.bySet['2']?.attack.kills);
    expect(statSets(final)).toEqual(final.sets.map((s) => s.number));
  });

  it('sorts with null ratios last', () => {
    const rows = playerRows(final, 'home', null);
    const byPoints = sortPlayerRows(rows, 'points', 'desc');
    const points = byPoints.map((r) => r.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
    const byRec = sortPlayerRows(rows, 'receptionPositive', 'asc');
    const firstNull = byRec.findIndex((r) => r.receptionPositive === null);
    if (firstNull >= 0) expect(byRec.slice(firstNull).every((r) => r.receptionPositive === null)).toBe(true);
  });
});

describe('zones', () => {
  it('sums the cells of the state and filters by evaluation and player', () => {
    const all = zoneView(final, { side: 'home', skill: 'attack', player: null, evaluation: null });
    expect(all.total).toBe(final.zones.home.attack.reduce((a, c) => a + c.total, 0));
    expect(Object.values(all.byTarget).reduce((a, b) => a + b, 0)).toBe(all.total);
    expect(all.arrows.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 5);
    const kills = zoneView(final, { side: 'home', skill: 'attack', player: null, evaluation: '#' });
    expect(kills.total).toBe(final.zones.home.attack.reduce((a, c) => a + (c.byEvaluation['#'] ?? 0), 0));
    expect(kills.arrows.every((a) => a.dominant === '#')).toBe(true);
    const player = zonePlayers(final, 'home', 'attack')[0];
    expect(player).toBeDefined();
    const one = zoneView(final, { side: 'home', skill: 'attack', player: player ?? null, evaluation: null });
    expect(one.total).toBeLessThanOrEqual(all.total);
    expect(zoneView(final, { side: 'home', skill: 'serve', player: 999, evaluation: null }).total).toBe(0);
  });

  it('places the zones on the court', () => {
    // Own half (left): front row next to the net, zone 4 on the left of the player (top).
    expect(zoneRect('4', 'own')).toEqual({ x: 70, y: 10, w: 30, h: 30 });
    expect(zoneRect('1', 'own')).toEqual({ x: 10, y: 70, w: 30, h: 30 });
    // Opponent half (right), facing left: zone 4 at the bottom next to the net, zone 1 at the top far away.
    expect(zoneRect('4', 'opponent')).toEqual({ x: 100, y: 70, w: 30, h: 30 });
    expect(zoneRect('1', 'opponent')).toEqual({ x: 160, y: 10, w: 30, h: 30 });
    expect(zoneCenter('8', 'opponent')).toEqual({ x: 145, y: 55 });
    expect(zoneRect('0', 'own')).toBeNull();
  });
});

describe('rotations', () => {
  it('has six positions with the values of the state', () => {
    const data = rotationSeries(final, 'home');
    expect(data.map((d) => d.label)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    const won = data.reduce((a, d) => a + d.won, 0);
    expect(won).toBe(final.rotations.home.reduce((a, r) => a + r.pointsWon, 0));
    const ext = rotationExtremes(data);
    expect(ext && ext.best.balance >= ext.worst.balance).toBe(true);
    expect(rotationExtremes(data.map((d) => ({ ...d, won: 0, lost: 0 })))).toBeNull();
    const option = rotationOption(data, 'home', DEFAULT_PALETTE) as { series: { data: number[] }[] };
    expect(option.series[0]?.data).toEqual(data.map((d) => d.won));
  });
});

describe('theme', () => {
  it('uses the team colours and canvas tooltips', () => {
    const theme = buildEchartsTheme(DEFAULT_PALETTE) as { color: string[]; tooltip: { renderMode: string } };
    expect(theme.color.slice(0, 2)).toEqual([DEFAULT_PALETTE.home, DEFAULT_PALETTE.away]);
    expect(theme.tooltip.renderMode).toBe('richText');
    expect(richSafe('a{b|c}')).toBe('abc');
    expect(richSafe('<img src=x onerror=1>&amp;')).toBe('img src=x onerror=1amp;');
    const momentum = momentumOption([], DEFAULT_PALETTE, { home: 'A', away: 'B' }) as {
      tooltip: { renderMode: string };
    };
    const rotation = rotationOption([], 'home', DEFAULT_PALETTE) as { tooltip: { renderMode: string } };
    expect([momentum.tooltip.renderMode, rotation.tooltip.renderMode]).toEqual(['richText', 'richText']);
  });
});

describe('simplified charts (phone)', () => {
  it('drops the labels inside the plot and over the bars, with fewer ticks', () => {
    const short = { home: 'A', away: 'B' };
    type Momentum = { graphic: unknown[]; yAxis: { splitNumber?: number }; grid: { left: number } };
    const full = momentumOption([], DEFAULT_PALETTE, short) as Momentum;
    const compact = momentumOption([], DEFAULT_PALETTE, short, true) as Momentum;
    expect(full.graphic).toHaveLength(2);
    expect(compact.graphic).toHaveLength(0);
    expect(compact.yAxis.splitNumber).toBe(2);
    expect(compact.grid.left).toBeLessThan(full.grid.left);
    type Rotation = { series: { label: { show: boolean } }[] };
    const bars = (compactBars: boolean) =>
      (rotationOption([], 'home', DEFAULT_PALETTE, compactBars) as Rotation).series.map((s) => s.label.show);
    expect(bars(false)).toEqual([true, true]);
    expect(bars(true)).toEqual([false, false]);
  });
});
