import { defaultIntermissions, EMPTY_SCHEDULE } from '@sir/shared';
import type { ScheduleResponse } from '@sir/shared';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_SCHEDULE } from '../blocks/sampleSchedule.ts';
import { hasScheduleData, intermissionsUseSchedule, loadSchedule, nextFixture, SCHEDULE_PATH } from './schedule.ts';

const first = SAMPLE_SCHEDULE.fixtures[0];
if (!first) throw new Error('sample without matches');

const withLive: ScheduleResponse = {
  ...SAMPLE_SCHEDULE,
  fixtures: [{ ...first, live: true }, ...SAMPLE_SCHEDULE.fixtures.slice(1)],
};

describe('schedule of the club', () => {
  it('shows the first match that is not being played now', () => {
    expect(nextFixture(SAMPLE_SCHEDULE)).toBe(first);
    expect(nextFixture(withLive)).toBe(SAMPLE_SCHEDULE.fixtures[1]);
    expect(nextFixture({ fixtures: [{ ...first, live: true }], standings: null })).toBeNull();
    expect(nextFixture(EMPTY_SCHEDULE)).toBeNull();
    expect(nextFixture(null)).toBeNull();
  });

  it('leaves out the blocks and slides without data', () => {
    expect(hasScheduleData('nextMatch', SAMPLE_SCHEDULE)).toBe(true);
    expect(hasScheduleData('standings', SAMPLE_SCHEDULE)).toBe(true);
    for (const empty of [EMPTY_SCHEDULE, null, undefined]) {
      expect(hasScheduleData('nextMatch', empty)).toBe(false);
      expect(hasScheduleData('standings', empty)).toBe(false);
    }
    expect(
      hasScheduleData('standings', { fixtures: [], standings: { leagueName: null, updatedAt: null, rows: [] } }),
    ).toBe(false);
    expect(hasScheduleData('players', null)).toBe(true);
  });

  it('asks for the data only when a pause has a slide that reads them', () => {
    const config = defaultIntermissions();
    expect(intermissionsUseSchedule(config)).toBe(true);
    const bare = {
      ...config,
      setBreak: { ...config.setBreak, slides: [] },
      matchEnd: { ...config.matchEnd, slides: [] },
    };
    expect(intermissionsUseSchedule(bare)).toBe(false);
    expect(intermissionsUseSchedule(null)).toBe(false);
  });

  it('reads the public route and checks the answer; any failure is null', async () => {
    const ok = vi.fn(() => Promise.resolve(new Response(JSON.stringify(SAMPLE_SCHEDULE))));
    expect(await loadSchedule({ fetch: ok as unknown as typeof fetch })).toEqual(SAMPLE_SCHEDULE);
    expect(ok).toHaveBeenCalledWith(SCHEDULE_PATH, expect.objectContaining({ credentials: 'omit' }));
    const bad = () => Promise.resolve(new Response(JSON.stringify({ fixtures: 3 })));
    expect(await loadSchedule({ fetch: bad as unknown as typeof fetch })).toBeNull();
    const down = () => Promise.resolve(new Response('', { status: 500 }));
    expect(await loadSchedule({ fetch: down as unknown as typeof fetch })).toBeNull();
    const offline = () => Promise.reject(new Error('rete'));
    expect(await loadSchedule({ fetch: offline })).toBeNull();
  });
});
