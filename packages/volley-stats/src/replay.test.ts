import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDvw } from '@sir/dvw-parser';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { describe, expect, it } from 'vitest';
import { computeMatchState, matchPoints, matchStateUntilPoint, pointsExtend, RECENT_POINTS_LIMIT } from './index.js';
import type { MatchState } from './index.js';

const match = generateMatch({ seed: 3, sets: 4 });
const full = computeMatchState(parseDvw(renderDvw(match, match.lines.length)));
const parsedFull = parseDvw(renderDvw(match, match.lines.length));
const pointRows = parsedFull.scout.filter((e) => e.kind === 'point').map((e) => e.index);

/** State computed from the file cut right after the `count`-th point (and the `**Nset` line that follows it). */
function stateAfter(count: number): MatchState {
  const row = pointRows[count - 1] ?? -1;
  const next = parsedFull.scout[row + 1];
  const end = next?.kind === 'setEnd' ? row + 2 : row + 1;
  return computeMatchState(parseDvw(renderDvw(match, end)));
}

describe('matchStateUntilPoint', () => {
  it('ricostruisce punteggio, set, battuta, ultimo punto e andamento come il file fermo a quel punto', () => {
    const total = matchPoints(full).length;
    expect(total).toBe(pointRows.length);
    for (const count of [1, 2, 3, 24, 25, 40, 47, 48, 49, 60, 99, total - 3, total - 2, total - 1]) {
      const real = stateAfter(count);
      const rebuilt = matchStateUntilPoint(full, count);
      expect(rebuilt.live.set, `punto ${count}`).toBe(real.live.set);
      expect([rebuilt.live.homeScore, rebuilt.live.awayScore]).toEqual([real.live.homeScore, real.live.awayScore]);
      expect(rebuilt.sets.map((s) => [s.number, s.homeScore, s.awayScore, s.finished, s.winner])).toEqual(
        real.sets.map((s) => [s.number, s.homeScore, s.awayScore, s.finished, s.winner]),
      );
      expect(rebuilt.setsWon).toEqual(real.setsWon);
      expect(rebuilt.status).toBe(real.status);
      expect(rebuilt.live.run).toEqual(real.live.run);
      expect(rebuilt.momentum).toEqual(real.momentum);
      if (!rebuilt.sets.find((s) => s.number === rebuilt.live.set)?.finished)
        expect(rebuilt.live.servingTeam).toBe(real.live.lastPoint?.team);
      // Only the last points of the match are described; older ones keep team and score.
      if (count > total - RECENT_POINTS_LIMIT) {
        // Time-out and substitutions are exact for the last points (those the portal shows one at a time).
        expect(rebuilt.live.timeouts).toEqual(real.live.timeouts);
        expect(rebuilt.live.substitutions).toEqual(real.live.substitutions);
        expect(rebuilt.live.lastPoint).toEqual(real.live.lastPoint);
        expect(rebuilt.live.recentPoints).toEqual(real.live.recentPoints.slice(-rebuilt.live.recentPoints.length));
      } else {
        expect(rebuilt.live.lastPoint).toMatchObject({
          team: real.live.lastPoint?.team,
          homeScore: real.live.homeScore,
          awayScore: real.live.awayScore,
          label: 'punto',
        });
      }
      expect(rebuilt.events.every((e) => e.index <= (pointRows[count - 1] ?? -1))).toBe(true);
      expect(rebuilt.phase).toEqual({ kind: 'rally', set: real.live.set });
    }
  });

  it('gli eventi fino al punto sono quelli dello stato completo, senza quelli dopo', () => {
    const count = matchPoints(full).length - 2;
    const rebuilt = matchStateUntilPoint(full, count);
    const row = pointRows[count - 1] ?? -1;
    expect(rebuilt.events).toEqual(full.events.filter((e) => e.index <= row));
    expect(rebuilt.events.length).toBeLessThan(full.events.length);
  });

  it('oltre i punti dello stato restituisce lo stato stesso; zero punti: partita non iniziata', () => {
    const total = matchPoints(full).length;
    expect(matchStateUntilPoint(full, total)).toBe(full);
    expect(matchStateUntilPoint(full, total + 5)).toBe(full);
    const zero = matchStateUntilPoint(full, 0);
    expect(zero.status).toBe('notStarted');
    expect(zero.sets).toEqual([]);
    expect(zero.live.lastPoint).toBeNull();
    expect(zero.phase).toEqual({ kind: 'preMatch' });
  });

  it('non cambia lo stato di partenza e accetta stati senza recentPoints né eventi', () => {
    const copy = structuredClone(full);
    matchStateUntilPoint(full, 30);
    expect(full).toEqual(copy);
    const { recentPoints: _drop, ...live } = full.live;
    const old = { ...full, live, events: undefined } as unknown as MatchState;
    const rebuilt = matchStateUntilPoint(old, matchPoints(full).length - 1);
    expect(rebuilt.live.lastPoint?.label).toBe('punto');
    expect(rebuilt.events).toEqual([]);
  });
});

describe('pointsExtend', () => {
  it('vero per punti aggiunti in fondo, falso per punti tolti o cambiati', () => {
    const before = matchStateUntilPoint(full, 30);
    expect(pointsExtend(before, full)).toBe(true);
    expect(pointsExtend(full, full)).toBe(true);
    expect(pointsExtend(full, before)).toBe(false);
    const changed = structuredClone(full);
    const first = changed.momentum.sets[0]?.points[3];
    if (first) first.scorer = first.scorer === 'home' ? 'away' : 'home';
    expect(pointsExtend(before, changed)).toBe(false);
    expect(matchPoints({ momentum: {} as MatchState['momentum'] })).toEqual([]);
  });
});

/** What a step of the sequence must show exactly like the file cut at that point. */
const shown = (s: MatchState) => ({
  score: [s.live.set, s.live.homeScore, s.live.awayScore],
  sets: s.sets.map((x) => [x.number, x.homeScore, x.awayScore, x.finished, x.winner]),
  setsWon: s.setsWon,
  status: s.status,
  serving: s.live.servingTeam,
  run: s.live.run,
  momentum: s.momentum,
  timeouts: s.live.timeouts,
  substitutions: s.live.substitutions,
});

describe('matchStateUntilPoint: proprietà su file veri', () => {
  const files = {
    'samples/partita-sintetica.dvw': '../../../samples/partita-sintetica.dvw',
    'fixture del parser': '../../dvw-parser/test/fixtures/partita.dvw',
  };
  for (const [name, path] of Object.entries(files)) {
    it(`${name}: dallo stato al punto k, i punti da k-5 a k-1 come il file troncato lì`, () => {
      const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'latin1');
      const lines = text.split(/\r?\n/);
      const scoutAt = lines.findIndex((l) => l.startsWith('[3SCOUT]'));
      const parsed = parseDvw(text);
      const rows = parsed.scout.filter((e) => e.kind === 'point').map((e) => e.index);
      // State after the n-th point (and the `**Nset` line right after it), as the server computes it.
      const states = rows.map((row) => {
        const end = parsed.scout[row + 1]?.kind === 'setEnd' ? row + 2 : row + 1;
        return computeMatchState(parseDvw(`${lines.slice(0, scoutAt + 1 + end).join('\n')}\n`));
      });
      expect(states.length).toBeGreaterThan(1);
      for (let k = 2; k <= states.length; k++) {
        const at = states[k - 1] as MatchState;
        for (let n = Math.max(1, k - 5); n < k; n++)
          expect(shown(matchStateUntilPoint(at, n)), `k ${k}, n ${n}`).toEqual(shown(states[n - 1] as MatchState));
      }
    });
  }
});
