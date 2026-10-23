import { parseDvw } from '@arenalive/dvw-parser';
import { describe, expect, it } from 'vitest';
import type { PlaybackLine } from './index.js';
import {
  AVERAGE_GAP_SECONDS,
  generateMatch,
  MIN_SPEED_BREAK_SECONDS,
  matchSeconds,
  planPlayback,
  renderDvw,
  timeSeconds,
} from './index.js';

/** Scout lines of a generated match as the parser reads them (with the times written by the generator). */
const entriesOf = (seed: number, sets: 3 | 4 | 5 = 3) => {
  const match = generateMatch({ seed, sets });
  return { match, entries: parseDvw(renderDvw(match, match.lines.length)).scout };
};

const setEndIndexes = (lines: readonly PlaybackLine[]) => lines.flatMap((l, i) => (l.kind === 'setEnd' ? [i] : []));

describe('timeSeconds', () => {
  it('reads HH.MM.SS and refuses anything else', () => {
    expect(timeSeconds('18.00.05')).toBe(18 * 3600 + 5);
    expect(timeSeconds(' 9.30.00 ')).toBe(9 * 3600 + 30 * 60);
    expect(timeSeconds(undefined)).toBeNull();
    expect(timeSeconds('')).toBeNull();
    expect(timeSeconds('25.00.00')).toBeNull();
    expect(timeSeconds('18:00:05')).toBeNull();
  });
});

describe('matchSeconds', () => {
  it('follows the times of the file, across midnight, cutting long stops and never going back', () => {
    const lines = [
      { kind: 'action', time: '23.59.50' },
      { kind: 'action', time: '23.59.58' },
      { kind: 'point', time: '00.00.04' },
      { kind: 'action', time: '00.00.01' },
      { kind: 'action', time: '01.00.00' },
    ];
    expect(matchSeconds(lines)).toEqual([0, 8, 14, 14, 614]);
  });

  it('uses the average rhythm without times (or with times on fewer than half of the lines)', () => {
    const lines = [
      { kind: 'action' },
      { kind: 'point' },
      { kind: 'timeout' },
      { kind: 'setEnd' },
      { kind: 'action', time: '18.00.00' },
    ];
    const a = AVERAGE_GAP_SECONDS;
    expect(matchSeconds(lines)).toEqual([
      0,
      a.action,
      a.action + a.point,
      a.action + a.point + a.timeout,
      a.action + a.point + a.timeout + a.setEnd,
    ]);
  });
});

describe('planPlayback', () => {
  it('with a duration, every set lasts the seconds chosen and the breaks between them too', () => {
    const { entries } = entriesOf(4, 4);
    const plan = planPlayback(entries, { kind: 'duration', setSeconds: 20, breakSeconds: 10 });
    expect(plan.offsetsMs[0]).toBe(0);
    expect(plan.sets.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    for (const s of plan.sets) expect(s.endMs - s.startMs).toBe(20_000);
    for (let i = 1; i < plan.sets.length; i++) {
      const prev = plan.sets[i - 1];
      expect((plan.sets[i]?.startMs ?? 0) - (prev?.endMs ?? 0)).toBe(10_000);
    }
    expect(plan.totalMs).toBe(4 * 20_000 + 3 * 10_000);
    // The line closing a set is the last one of that set.
    expect(setEndIndexes(entries).map((i) => plan.offsetsMs[i])).toEqual(plan.sets.map((s) => s.endMs));
  });

  it('with a speed, follows the real rhythm of the lines divided by the speed', () => {
    const { match, entries } = entriesOf(2);
    const real = planPlayback(entries, { kind: 'speed', speed: 1 });
    const fast = planPlayback(entries, { kind: 'speed', speed: 10 });
    const first = match.lines[0]?.second ?? 0;
    // The generator writes HH.MM.SS: the times of the file are its seconds (start of the match at 0).
    expect(real.offsetsMs).toEqual(match.lines.map((l) => (l.second - first) * 1000));
    fast.offsetsMs.forEach((ms, i) => expect(ms).toBe(Math.round((real.offsetsMs[i] ?? 0) / 10)));
    expect(fast.totalMs).toBe(Math.round(real.totalMs / 10));
  });

  it('with a speed and no times, keeps the average rhythm', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ kind: i % 5 === 4 ? 'point' : 'action' }));
    const plan = planPlayback(lines, { kind: 'speed', speed: 2 });
    expect(plan.offsetsMs.slice(0, 6)).toEqual([0, 1500, 3000, 4500, 6000, 16_000]);
  });

  it('with a speed, the next set never starts before the minimum break, even if the file has no gap', () => {
    // As a real file: the times do not stop between the end of a set and the lineup of the next one.
    const set = (t: number) => [
      { kind: 'setter', time: `20.${t}.00` },
      { kind: 'action', time: `20.${t}.05` },
      { kind: 'point', time: `20.${t}.10` },
      { kind: 'setEnd', time: `20.${t}.12` },
    ];
    const lines = [...set(10), ...set(10), ...set(10)];
    for (const speed of [1, 5, 10, 60]) {
      const plan = planPlayback(lines, { kind: 'speed', speed });
      for (const end of [3, 7]) {
        const gap = (plan.offsetsMs[end + 1] ?? 0) - (plan.offsetsMs[end] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(MIN_SPEED_BREAK_SECONDS * 1000);
      }
    }
  });

  it('with a speed, keeps a real break longer than the minimum and the rhythm inside the sets', () => {
    const lines = [
      { kind: 'action', time: '20.00.00' },
      { kind: 'point', time: '20.00.10' },
      { kind: 'setEnd', time: '20.00.12' },
      { kind: 'setter', time: '20.05.12' },
      { kind: 'point', time: '20.05.22' },
    ];
    const plan = planPlayback(lines, { kind: 'speed', speed: 2 });
    expect(plan.offsetsMs).toEqual([0, 5000, 6000, 156_000, 161_000]);
  });

  it('with a speed, the minimum break can be chosen set by set', () => {
    const set = (t: number) => [
      { kind: 'setter', time: `20.${t}.00` },
      { kind: 'point', time: `20.${t}.10` },
      { kind: 'setEnd', time: `20.${t}.12` },
    ];
    const lines = [...set(10), ...set(10), ...set(10)];
    const plan = planPlayback(lines, { kind: 'speed', speed: 10 }, { minBreakSeconds: (n) => (n === 1 ? 84 : 0) });
    expect((plan.offsetsMs[3] ?? 0) - (plan.offsetsMs[2] ?? 0)).toBe(84_000);
    // After set 2 no minimum: the next set follows at once (the file has no gap).
    expect((plan.offsetsMs[6] ?? 0) - (plan.offsetsMs[5] ?? 0)).toBe(0);
  });

  it('with a duration, no line of the next set comes before the end of the break', () => {
    const { entries } = entriesOf(6, 4);
    const plan = planPlayback(entries, { kind: 'duration', setSeconds: 15, breakSeconds: 40 });
    const ends = setEndIndexes(entries);
    for (const end of ends.slice(0, -1)) {
      expect((plan.offsetsMs[end + 1] ?? 0) - (plan.offsetsMs[end] ?? 0)).toBe(40_000);
    }
  });

  it('is deterministic and never goes back', () => {
    const { entries } = entriesOf(9, 5);
    const pace = { kind: 'duration', setSeconds: 30, breakSeconds: 5 } as const;
    const a = planPlayback(entries, pace);
    expect(planPlayback(entries, pace)).toEqual(a);
    a.offsetsMs.forEach((ms, i) => expect(ms).toBeGreaterThanOrEqual(a.offsetsMs[i - 1] ?? 0));
    expect(a.sets).toHaveLength(5);
  });

  it('handles a file without points or lines', () => {
    expect(planPlayback([], { kind: 'speed', speed: 5 })).toEqual({ offsetsMs: [], totalMs: 0, sets: [] });
    const plan = planPlayback([{ kind: 'action' }, { kind: 'unknown' }], {
      kind: 'duration',
      setSeconds: 20,
      breakSeconds: 10,
    });
    expect(plan).toEqual({ offsetsMs: [0, 0], totalMs: 0, sets: [] });
  });
});
