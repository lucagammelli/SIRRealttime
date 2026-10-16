import { defaultIntermissions, TenantIntermissionsSchema } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import { describe, expect, it } from 'vitest';
import { midMatchState, scoreAt } from '../test/fixtures.ts';
import type { MilestoneMemory } from './intermission.ts';
import { milestonePause, milestoneStep, pauseTitle, previewState, statPeriod } from './intermission.ts';

const mid = midMatchState();
const SET = mid.live.set;

const pause = defaultIntermissions().milestone;

/** The example match in the 5th set (tie-break) at `home`-`away`. */
function tieBreakAt(home: number, away: number): MatchState {
  const base = scoreAt(home, away);
  const fifth = { ...base.sets[base.sets.length - 1], number: 5, homeScore: home, awayScore: away, finished: false };
  return {
    ...base,
    sets: [...base.sets.filter((s) => s.number !== SET), fifth as MatchState['sets'][number]],
    live: { ...base.live, set: 5 },
    phase: { kind: 'rally', set: 5 },
  };
}

/** Runs the states one after the other (live updates unless said), returning the thresholds opened. */
function run(states: { state: MatchState; live?: boolean; blocked?: boolean }[], config = pause): (number | null)[] {
  let memory: MilestoneMemory | null = null;
  return states.map(({ state, live = true, blocked = false }) => {
    const step = milestoneStep(memory, state, { pause: config, live, blocked });
    memory = step.memory;
    return step.open?.threshold ?? null;
  });
}

describe('«ogni N punti»: when it opens', () => {
  it('at every new multiple of N points played, never at the first state', () => {
    expect(
      run([{ state: scoreAt(4, 3) }, { state: scoreAt(4, 4) }, { state: scoreAt(5, 4) }, { state: scoreAt(8, 8) }]),
    ).toEqual([null, 8, null, 16]);
    // the first state already past a threshold is only remembered, also as a live update
    expect(run([{ state: scoreAt(5, 4) }, { state: scoreAt(6, 4) }])).toEqual([null, null]);
  });

  it('nothing for a state that is not a live update (opening, reconnection, resync): remembered anyway', () => {
    expect(run([{ state: scoreAt(4, 3) }, { state: scoreAt(4, 4), live: false }, { state: scoreAt(5, 4) }])).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('a scout correction that takes a point back gives a lower threshold: nothing, also when it comes back', () => {
    expect(
      run([{ state: scoreAt(4, 3) }, { state: scoreAt(4, 4) }, { state: scoreAt(4, 3) }, { state: scoreAt(4, 4) }]),
    ).toEqual([null, 8, null, null]);
  });

  it('never in the last K points of the set (25, 15 at the tie-break; K = 5 by default)', () => {
    expect(run([{ state: scoreAt(19, 12) }, { state: scoreAt(19, 13) }])).toEqual([null, 32]);
    // 24 already met: 19-18 opens 32, 20-19 (the leading team 5 points from 25) does not
    const met: MilestoneMemory = { every: 8, bySet: { [String(SET)]: 24 } };
    const at = (home: number, away: number) =>
      milestoneStep(met, scoreAt(home, away), { pause, live: true, blocked: false }).open?.threshold ?? null;
    expect(at(19, 18)).toBe(32);
    expect(at(20, 19)).toBeNull();
    expect(run([{ state: scoreAt(20, 11) }, { state: scoreAt(20, 12) }])).toEqual([null, null]);
    const late = TenantIntermissionsSchema.parse({ milestone: { stopBeforeEnd: 3 } }).milestone;
    expect(run([{ state: scoreAt(20, 11) }, { state: scoreAt(20, 12) }], late)).toEqual([null, 32]);
  });

  it('at the tie-break the end is at 15: 8-8 opens, 13-11 does not', () => {
    expect(run([{ state: tieBreakAt(8, 7) }, { state: tieBreakAt(8, 8) }])).toEqual([null, 16]);
    expect(run([{ state: tieBreakAt(12, 11) }, { state: tieBreakAt(13, 11) }])).toEqual([null, null]);
    const four = { ...pause, every: 4 };
    expect(run([{ state: tieBreakAt(9, 6) }, { state: tieBreakAt(10, 6) }], four)).toEqual([null, null]);
    expect(run([{ state: tieBreakAt(9, 6) }, { state: tieBreakAt(9, 7) }], four)).toEqual([null, 16]);
  });

  it('never over a more important pause, and that threshold is not shown later', () => {
    expect(run([{ state: scoreAt(7, 8) }, { state: scoreAt(8, 8), blocked: true }, { state: scoreAt(9, 8) }])).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('off, or another N: nothing; a new N starts again from the state on screen', () => {
    const off = TenantIntermissionsSchema.parse({ milestone: { enabled: false } }).milestone;
    expect(run([{ state: scoreAt(4, 3) }, { state: scoreAt(4, 4) }], off)).toEqual([null, null]);
    let memory: MilestoneMemory | null = null;
    memory = milestoneStep(memory, scoreAt(4, 3), { pause, live: true, blocked: false }).memory;
    const ten = { ...pause, every: 10 };
    const step = milestoneStep(memory, scoreAt(5, 5), { pause: ten, live: true, blocked: false });
    expect(step.open).toBeNull();
    expect(step.memory).toEqual({ every: 10, bySet: { [String(SET)]: 10 } });
  });

  it('nothing at the end of the set or out of play', () => {
    const closed = scoreAt(25, 23);
    const finished = { ...closed, sets: closed.sets.map((s) => (s.number === SET ? { ...s, finished: true } : s)) };
    expect(run([{ state: scoreAt(24, 23) }, { state: finished }])).toEqual([null, null]);
  });
});

describe('«ogni N punti»: the pause', () => {
  it('has its key, its set and the score in the title', () => {
    const step = milestoneStep({ every: 8, bySet: {} }, scoreAt(9, 7), { pause, live: true, blocked: false });
    if (!step.open) throw new Error('milestone');
    const active = milestonePause(step.open, pause);
    expect(active).toMatchObject({ kind: 'milestone', key: `milestone-set-${SET}-16`, set: SET });
    expect(pauseTitle(active, () => '')).toBe(`${SET}° set: 9-7`);
    expect(previewState(mid, 'milestone').phase).toEqual({ kind: 'rally', set: SET });
  });

  it('periods of the statistics: the set given or the match', () => {
    expect(statPeriod('set', 3)).toEqual({ kind: 'set', set: 3 });
    expect(statPeriod('match', 3)).toEqual({ kind: 'match' });
  });
});
