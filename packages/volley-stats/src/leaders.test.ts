import { parseDvw } from '@sir/dvw-parser';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { describe, expect, it } from 'vitest';
import type { MatchState, PlayerStats, StatLine } from './index.js';
import { computeMatchState, topPlayers } from './index.js';

function line(points: number, kills: number, errors: number): StatLine {
  return {
    serve: { total: 0, aces: points - kills, errors: 0, efficiency: null },
    reception: { total: 0, perfect: 0, positive: 0, errors: 0, positivePct: null, perfectPct: null },
    attack: { total: kills, kills, errors: 0, blocked: 0, killPct: null, efficiency: null },
    block: { kills: 0, touches: 0 },
    dig: { total: 0, errors: 0 },
    points,
    errors,
  };
}

const player = (number: number, points: number, kills = points, errors = 0): PlayerStats => ({
  number,
  total: line(points, kills, errors),
  bySet: {},
});

function state(home: PlayerStats[], away: PlayerStats[]): Pick<MatchState, 'stats' | 'players'> {
  const team = (players: PlayerStats[]) => ({
    total: line(0, 0, 0),
    bySet: {},
    players: Object.fromEntries(players.map((p) => [String(p.number), p])),
  });
  return {
    stats: { home: team(home), away: team(away) },
    players: {
      home: [{ number: 7, firstName: 'Mario', lastName: 'Rossi', role: null, specialRole: null }],
      away: [],
    },
  };
}

describe('topPlayers', () => {
  it('orders by points, then attack kills, fewer errors, home team, number', () => {
    const s = state(
      [player(7, 10), player(3, 12), player(9, 10, 6), player(4, 10, 10, 2)],
      [player(7, 10), player(1, 0)],
    );
    const top = topPlayers(s, { limit: 10 });
    expect(top.map((p) => `${p.team}-${p.number}`)).toEqual(['home-3', 'home-7', 'away-7', 'home-4', 'home-9']);
    expect(top[1]).toMatchObject({ points: 10, attackKills: 10, aces: 0, player: { lastName: 'Rossi' } });
    expect(top.find((p) => p.team === 'away' && p.number === 7)?.player).toBeNull();
  });

  it('keeps the limit, filters one team and leaves out players without points', () => {
    const s = state([player(7, 10), player(3, 12)], [player(5, 11), player(1, 0)]);
    expect(topPlayers(s, { limit: 2 }).map((p) => p.number)).toEqual([3, 5]);
    expect(topPlayers(s, { limit: 5, team: 'away' }).map((p) => p.number)).toEqual([5]);
    expect(topPlayers(s, { limit: 0 })).toEqual([]);
  });

  it('works on a whole synthetic match and agrees with the player statistics', () => {
    const m = generateMatch({ seed: 3 });
    const full = computeMatchState(parseDvw(renderDvw(m, m.lines.length)));
    const top = topPlayers(full, { limit: 5 });
    expect(top).toHaveLength(5);
    for (const p of top) expect(p.points).toBe(full.stats[p.team].players[String(p.number)]?.total.points);
    for (let i = 1; i < top.length; i++) expect((top[i - 1]?.points ?? 0) >= (top[i]?.points ?? 0)).toBe(true);
  });
});
