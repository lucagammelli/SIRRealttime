import { parseDvw } from '@arenalive/dvw-parser';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, PROFILE_LIMITS, generateMatch, renderDvw, resolveProfile } from './index.js';
import type { GeneratedMatch, MatchProfile } from './index.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const matchesWith = (profile: Partial<MatchProfile> = {}): GeneratedMatch[] =>
  SEEDS.map((seed) => generateMatch({ seed, sets: ([3, 4, 5] as const)[seed % 3] ?? 3, profile }));

/** Averages per team and per set counted on the codes of the lines, and side-out share of the rallies. */
function averages(matches: GeneratedMatch[]) {
  let teamSets = 0;
  const c = { aces: 0, serveErrors: 0, blocks: 0, substitutions: 0, timeouts: 0, sideOuts: 0, rallies: 0 };
  for (const m of matches) {
    teamSets += m.sets.length * 2;
    let server: string | undefined;
    for (const l of m.lines) {
      if (/^[*a]\d\dS.#/.test(l.code)) c.aces++;
      if (/^[*a]\d\dS.=/.test(l.code)) c.serveErrors++;
      if (/^[*a]\d\dB.#/.test(l.code)) c.blocks++;
      if (l.kind === 'substitution') c.substitutions++;
      if (l.kind === 'timeout') c.timeouts++;
      if (l.kind === 'action' && l.code[3] === 'S') server = l.code[0];
      if (l.kind === 'point') {
        c.rallies++;
        if (l.code[0] !== server) c.sideOuts++;
      }
    }
  }
  return {
    acesPerSet: c.aces / teamSets,
    serveErrorsPerSet: c.serveErrors / teamSets,
    blocksPerSet: c.blocks / teamSets,
    substitutionsPerSet: c.substitutions / teamSets,
    timeoutsPerSet: c.timeouts / teamSets,
    sideOut: c.sideOuts / c.rallies,
  };
}

describe('resolveProfile', () => {
  it('fills the missing fields with the defaults and brings the values inside the limits', () => {
    expect(resolveProfile()).toEqual(DEFAULT_PROFILE);
    expect(resolveProfile({ acesPerSet: 3, homeStrength: 140, timeoutsPerSet: -1, blocksPerSet: Number.NaN })).toEqual({
      ...DEFAULT_PROFILE,
      acesPerSet: 3,
      homeStrength: PROFILE_LIMITS.homeStrength.max,
      timeoutsPerSet: 0,
    });
    for (const [key, { min, max }] of Object.entries(PROFILE_LIMITS)) {
      const value = DEFAULT_PROFILE[key as keyof MatchProfile];
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });
});

// Hundreds of matches generated: a few seconds on a busy machine.
describe('realistic matches', { timeout: 30_000 }, () => {
  const plain = matchesWith();

  it('has the scores of real sets: close on average, sometimes at deuce, never a whitewash', () => {
    const sets = plain.flatMap((m) => m.sets);
    const margins = sets.map((s) => Math.abs(s.home - s.away));
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(6.5);
    // The losing team of a set to 25 scores at least 10 points almost always.
    const full = sets.filter((s) => !(s.number === 5 && Math.max(s.home, s.away) <= 17));
    const lopsided = full.filter((s) => Math.min(s.home, s.away) < 10).length;
    expect(lopsided / full.length).toBeLessThan(0.03);
    expect(Math.min(...sets.map((s) => Math.min(s.home, s.away)))).toBeGreaterThan(3);
    const deuce = sets.filter((s) => Math.max(s.home, s.away) > (s.number === 5 ? 15 : 25)).length;
    expect(deuce / sets.length).toBeGreaterThan(0.04);
    const close = sets.filter((s) => Math.abs(s.home - s.away) <= 3).length;
    expect(close / sets.length).toBeGreaterThan(0.3);
  });

  it('alternates the serve: the receiving team wins about 60-65% of the rallies', () => {
    const { sideOut } = averages(plain);
    expect(sideOut).toBeGreaterThan(0.58);
    expect(sideOut).toBeLessThan(0.7);
    // Long runs of points are rare.
    for (const m of plain.slice(0, 20)) {
      let run = 0;
      let longest = 0;
      let last = '';
      for (const l of m.lines.filter((x) => x.kind === 'point')) {
        run = l.code[0] === last ? run + 1 : 1;
        last = l.code[0] ?? '';
        longest = Math.max(longest, run);
      }
      expect(longest).toBeLessThan(12);
    }
  });

  it('teams on a par win about half of the sets', () => {
    const sets = plain.flatMap((m) => m.sets);
    const home = sets.filter((s) => s.home > s.away).length / sets.length;
    expect(home).toBeGreaterThan(0.35);
    expect(home).toBeLessThan(0.65);
  });

  it('matches the defaults on average: aces, serve errors, blocks, substitutions, time-outs', () => {
    const got = averages(plain);
    for (const key of ['acesPerSet', 'serveErrorsPerSet', 'blocksPerSet', 'substitutionsPerSet'] as const) {
      expect(got[key]).toBeGreaterThan(DEFAULT_PROFILE[key] * 0.8);
      expect(got[key]).toBeLessThan(DEFAULT_PROFILE[key] * 1.2);
    }
    expect(got.timeoutsPerSet).toBeGreaterThan(1.2);
    expect(got.timeoutsPerSet).toBeLessThanOrEqual(1.6);
  });

  it('follows the profile chosen, within a fifth of the targets', () => {
    const profile = { acesPerSet: 4, serveErrorsPerSet: 1, blocksPerSet: 4, substitutionsPerSet: 4, timeoutsPerSet: 1 };
    const got = averages(matchesWith(profile).slice(0, 40));
    for (const [key, target] of Object.entries(profile)) {
      expect(got[key as keyof typeof profile]).toBeGreaterThan(target * 0.8);
      expect(got[key as keyof typeof profile]).toBeLessThan(target * 1.2);
    }
    const none = averages(
      matchesWith({
        acesPerSet: 0,
        serveErrorsPerSet: 0,
        blocksPerSet: 0,
        substitutionsPerSet: 0,
        timeoutsPerSet: 0,
      }).slice(0, 10),
    );
    expect(none).toMatchObject({ acesPerSet: 0, serveErrorsPerSet: 0, blocksPerSet: 0, substitutionsPerSet: 0 });
    expect(none.timeoutsPerSet).toBe(0);
  });

  it('gives most matches to the stronger team, still with real sets', () => {
    const homeWins = (strength: number) =>
      matchesWith({ homeStrength: strength })
        .slice(0, 40)
        .filter((m) => m.sets.filter((s) => s.home > s.away).length === 3).length / 40;
    expect(homeWins(85)).toBeGreaterThan(0.75);
    expect(homeWins(15)).toBeLessThan(0.25);
    const strong = matchesWith({ homeStrength: 100 })
      .slice(0, 20)
      .flatMap((m) => m.sets);
    expect(Math.min(...strong.map((s) => Math.min(s.home, s.away)))).toBeGreaterThan(3);
  });

  it('follows the rules: at most 6 substitutions and 2 time-outs per team and set, a substitute only back for his player', () => {
    for (const m of matchesWith({ substitutionsPerSet: 6, timeoutsPerSet: 2 }).slice(0, 15)) {
      for (const s of m.sets) {
        for (const team of ['*', 'a']) {
          const own = m.lines.filter((l) => l.set === s.number && l.code[0] === team);
          const subs = own.filter((l) => l.kind === 'substitution');
          expect(subs.length).toBeLessThanOrEqual(6);
          expect(own.filter((l) => l.kind === 'timeout').length).toBeLessThanOrEqual(2);
          const replaced = new Map<number, number>();
          const done = new Set<number>();
          for (const l of subs) {
            const [out, inn] = l.code.slice(2).split(':').map(Number) as [number, number];
            expect(done.has(out) || done.has(inn)).toBe(false);
            if (replaced.get(out) === inn) {
              replaced.delete(out);
              done.add(out).add(inn);
            } else {
              expect([...replaced.values()]).not.toContain(inn);
              replaced.set(inn, out);
            }
          }
        }
      }
    }
  });

  it('writes only lines the parser knows, with the same counts', () => {
    for (const m of matchesWith({ acesPerSet: 4, blocksPerSet: 5, substitutionsPerSet: 5, timeoutsPerSet: 2 }).slice(
      0,
      6,
    )) {
      const parsed = parseDvw(renderDvw(m, m.lines.length));
      expect(parsed.warnings).toEqual([]);
      expect(parsed.scout.filter((e) => e.kind === 'unknown')).toEqual([]);
      const count = (kind: string) => parsed.scout.filter((e) => e.kind === kind).length;
      expect(count('substitution')).toBe(m.lines.filter((l) => l.kind === 'substitution').length);
      expect(count('timeout')).toBe(m.lines.filter((l) => l.kind === 'timeout').length);
      const aces = parsed.scout.filter((e) => e.kind === 'action' && e.skill === 'serve' && e.evaluation === '#');
      expect(aces.length).toBe(m.lines.filter((l) => /^[*a]\d\dS.#/.test(l.code)).length);
    }
  });

  it('is deterministic with a profile too, and another profile gives another match', () => {
    const profile = { homeStrength: 65, variability: 80, acesPerSet: 2.5 };
    const a = renderDvw(generateMatch({ seed: 9, sets: 5, profile }), 100000);
    const b = renderDvw(generateMatch({ seed: 9, sets: 5, profile }), 100000);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = renderDvw(generateMatch({ seed: 9, sets: 5, profile: { ...profile, acesPerSet: 0.5 } }), 100000);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
    // The defaults written out are the same as no profile.
    const d = renderDvw(generateMatch({ seed: 9, sets: 5, profile: DEFAULT_PROFILE }), 100000);
    expect(Buffer.from(d).equals(Buffer.from(renderDvw(generateMatch({ seed: 9, sets: 5 }), 100000)))).toBe(true);
  });
});
