import { parseDvw } from '@arenalive/dvw-parser';
import type { RosterPlayer } from '@arenalive/dvw-simulator';
import { buildDvwText } from '@arenalive/shared';
import type { SimulationProfile } from '@arenalive/shared';
import { computeMatchState } from '@arenalive/volley-stats';
import { describe, expect, it } from 'vitest';
import { generatedMatch } from '../src/simulation/source.js';

/** Statistics of @arenalive/volley-stats on the file of a generated match, averaged per team and per set. */
function perTeamSet(profile: SimulationProfile | undefined, seeds: number[]) {
  let teamSets = 0;
  const sum = { aces: 0, serveErrors: 0, blocks: 0, substitutions: 0, timeouts: 0, unknown: 0 };
  const margins: number[] = [];
  for (const seed of seeds) {
    const loaded = generatedMatch({ sets: 4, seed, profile });
    const parsed = parseDvw(buildDvwText(loaded.header, loaded.lines));
    sum.unknown += parsed.scout.filter((e) => e.kind === 'unknown').length;
    const state = computeMatchState(parsed);
    teamSets += state.sets.length * 2;
    for (const side of ['home', 'away'] as const) {
      const total = state.stats[side].total;
      sum.aces += total.serve.aces;
      sum.serveErrors += total.serve.errors;
      sum.blocks += total.block.kills;
    }
    for (const s of state.sets) {
      sum.substitutions += s.substitutions.home + s.substitutions.away;
      sum.timeouts += s.timeouts.home + s.timeouts.away;
      margins.push(Math.abs(s.homeScore - s.awayScore));
    }
  }
  return {
    acesPerSet: sum.aces / teamSets,
    serveErrorsPerSet: sum.serveErrors / teamSets,
    blocksPerSet: sum.blocks / teamSets,
    substitutionsPerSet: sum.substitutions / teamSets,
    timeoutsPerSet: sum.timeouts / teamSets,
    unknown: sum.unknown,
    meanMargin: margins.reduce((a, b) => a + b, 0) / margins.length,
  };
}

const SEEDS = Array.from({ length: 25 }, (_, i) => 100 + i);

describe('generated match of the simulation, read by @arenalive/volley-stats', { timeout: 60_000 }, () => {
  it('counts about the aces, serve errors, blocks, substitutions and time-outs asked', () => {
    const profile = {
      acesPerSet: 3,
      serveErrorsPerSet: 2,
      blocksPerSet: 3.5,
      substitutionsPerSet: 4,
      timeoutsPerSet: 1,
    };
    const got = perTeamSet(profile, SEEDS);
    expect(got.unknown).toBe(0);
    for (const [field, target] of Object.entries(profile)) {
      const value = got[field as keyof typeof profile];
      expect(value, field).toBeGreaterThan(target * 0.75);
      expect(value, field).toBeLessThan(target * 1.25);
    }
  });

  it('without a profile: the defaults of the simulator and sets with real scores', () => {
    const got = perTeamSet(undefined, SEEDS);
    expect(got.unknown).toBe(0);
    expect(got.acesPerSet).toBeGreaterThan(1);
    expect(got.substitutionsPerSet).toBeGreaterThan(1.4);
    expect(got.timeoutsPerSet).toBeGreaterThan(1);
    expect(got.meanMargin).toBeGreaterThan(3);
    expect(got.meanMargin).toBeLessThan(6.5);
  });
});

/** A roster of the club as `simulationRoster` gives it: one player without role. */
const ROSTER: RosterPlayer[] = [
  { number: 6, lastName: 'Giannelli', firstName: 'Simone', role: 'S' },
  { number: 14, lastName: 'Ben Tara', firstName: 'Wassim', role: 'O' },
  { number: 9, lastName: 'Plotnytskyi', firstName: 'Oleh', role: 'H' },
  { number: 11, lastName: 'Semeniuk', firstName: 'Kamil', role: 'H' },
  { number: 22, lastName: 'Russo', firstName: 'Roberto', role: 'M' },
  { number: 17, lastName: 'Solé', firstName: 'Sebastián', role: 'M' },
  { number: 2, lastName: 'Colaci', firstName: 'Massimo', role: 'L' },
  { number: 33, lastName: 'Ishikawa', firstName: 'Yuki', role: 'H' },
  { number: 5, lastName: 'Loser', firstName: 'Agustín', role: 'M' },
  { number: 8, lastName: 'Herrera', firstName: 'Jesús', role: 'O' },
  { number: 1, lastName: 'Zoppellari', firstName: 'Paolo', role: 'S' },
  { number: 13, lastName: 'Candellaro', firstName: 'Davide', role: null },
];

describe('generated match with the roster of the club, read by @arenalive/volley-stats', () => {
  it.each(['home', 'away'] as const)('aces and blocks of our team (%s) go to the numbers of the roster', (ourSide) => {
    const byNumber = new Map(ROSTER.map((p) => [p.number, p]));
    let checked = 0;
    for (const seed of [3, 4, 5, 6]) {
      const loaded = generatedMatch({ sets: 4, seed, ourSide, roster: ROSTER });
      expect(loaded.ourSide).toBe(ourSide);
      const state = computeMatchState(parseDvw(buildDvwText(loaded.header, loaded.lines)));
      const other = ourSide === 'home' ? 'away' : 'home';
      expect(state.players[ourSide].map((p) => p.number).sort((a, b) => a - b)).toEqual(
        [...byNumber.keys()].sort((a, b) => a - b),
      );
      for (const p of state.players[ourSide]) expect(p.lastName).toBe(byNumber.get(p.number)?.lastName);
      // Numbers of the opponent: generated, never two players with one number.
      const theirs = state.players[other].map((p) => p.number);
      expect(new Set(theirs).size).toBe(theirs.length);
      // Every player with an action is of the roster; the aces of each number are its serves `#` in the file.
      const prefix = ourSide === 'home' ? '*' : 'a';
      for (const [key, stats] of Object.entries(state.stats[ourSide].players)) {
        const n = Number(key);
        expect(byNumber.has(n), key).toBe(true);
        const aces = loaded.lines.filter(
          (l) => l.startsWith(`${prefix}${String(n).padStart(2, '0')}S`) && l[5] === '#',
        );
        expect(stats.total.serve.aces).toBe(aces.length);
      }
      for (const event of state.events.filter((e) => (e.kind === 'ace' || e.kind === 'block') && e.team === ourSide)) {
        const player = byNumber.get(event.player?.number ?? -1);
        expect(player, event.id).toBeDefined();
        expect(event.player?.lastName).toBe(player?.lastName);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('without a roster both teams are generated as before; the same seed and roster give the same match', () => {
    expect(generatedMatch({ sets: 3, seed: 8, roster: [] }).lines).toEqual(generatedMatch({ sets: 3, seed: 8 }).lines);
    const a = generatedMatch({ sets: 3, seed: 8, roster: ROSTER, ourSide: 'away' });
    expect(generatedMatch({ sets: 3, seed: 8, roster: ROSTER, ourSide: 'away' }).lines).toEqual(a.lines);
    expect(generatedMatch({ sets: 3, seed: 8, roster: ROSTER, ourSide: 'home' }).lines).not.toEqual(a.lines);
  });
});
