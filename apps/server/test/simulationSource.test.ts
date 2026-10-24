import { parseDvw } from '@arenalive/dvw-parser';
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
