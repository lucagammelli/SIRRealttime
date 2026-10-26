import type { AfterMatch } from '@arenalive/shared';
import { defaultIntermissions } from '@arenalive/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateAfter } from '../test/fixtures.ts';
import { afterMatchDueAt, SIMULATED_AFTER_MATCH_MS, useAfterMatchImage } from './afterMatch.ts';
import type { LiveData } from './liveConnection.ts';
import { resetSchedule } from './schedule.ts';

const IMAGE = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const END = '2026-10-23T19:00:00.000Z';
const on: AfterMatch = { ...defaultIntermissions().afterMatch, enabled: true, image: IMAGE, delayMinutes: 30 };
const finished = stateAfter();
const data = (over: Partial<Extract<LiveData, { kind: 'state' }>> = {}): LiveData => ({
  kind: 'state',
  matchId: '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c',
  version: 9,
  state: finished,
  finishedAt: END,
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('afterMatchDueAt', () => {
  it('is the end of the match plus the minutes chosen', () => {
    expect(finished.status).toBe('finished');
    expect(afterMatchDueAt(data(), on)).toBe(Date.parse(END) + 30 * 60_000);
    expect(afterMatchDueAt(data(), { ...on, delayMinutes: 0 })).toBe(Date.parse(END));
  });

  it('a simulated match does not wait the real minutes: 15 s, or less if the client chose less', () => {
    expect(SIMULATED_AFTER_MATCH_MS).toBe(15_000);
    expect(afterMatchDueAt(data({ simulated: true }), on)).toBe(Date.parse(END) + 15_000);
    expect(afterMatchDueAt(data({ simulated: true }), { ...on, delayMinutes: 0 })).toBe(Date.parse(END));
    expect(afterMatchDueAt(data({ simulated: true }), { ...on, enabled: false })).toBeNull();
    expect(afterMatchDueAt(data({ simulated: false }), on)).toBe(Date.parse(END) + 30 * 60_000);
  });

  it('is null without a finished match with its end, or with the screen off or without a photo', () => {
    expect(afterMatchDueAt(data({ state: stateAfter(200) }), on)).toBeNull();
    const { finishedAt: _end, ...noEnd } = data() as Extract<LiveData, { kind: 'state' }>;
    expect(afterMatchDueAt(noEnd, on)).toBeNull();
    expect(afterMatchDueAt(data({ finishedAt: 'ieri' }), on)).toBeNull();
    expect(afterMatchDueAt(data(), { ...on, enabled: false })).toBeNull();
    expect(afterMatchDueAt(data(), { ...on, image: null })).toBeNull();
    expect(afterMatchDueAt(data(), null)).toBeNull();
    expect(afterMatchDueAt({ kind: 'noMatch' }, on)).toBeNull();
    expect(afterMatchDueAt(null, on)).toBeNull();
  });
});

describe('useAfterMatchImage', () => {
  it('a simulated match shows the photo 15 s after its end', () => {
    vi.useFakeTimers({ now: new Date(Date.parse(END) + 1000) });
    const { result } = renderHook(() => useAfterMatchImage(data({ simulated: true }), on));
    expect(result.current).toBeNull();
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(result.current).toBe(IMAGE);
  });

  it('gives the photo only once the minutes have passed, with one timer', () => {
    vi.useFakeTimers({ now: new Date('2026-10-23T19:10:00.000Z') });
    const { result, rerender } = renderHook(({ d }) => useAfterMatchImage(d, on), {
      initialProps: { d: data() as LiveData | null },
    });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(20 * 60_000 - 1);
    });
    expect(result.current).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(IMAGE);
    expect(vi.getTimerCount()).toBe(0);
    // A correction takes the match out of «finished»: the screen goes away.
    rerender({ d: data({ state: stateAfter(200) }) });
    expect(result.current).toBeNull();
  });

  it('opened long after the end: the photo at once', () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T08:00:00.000Z') });
    const { result } = renderHook(() => useAfterMatchImage(data(), on));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(IMAGE);
  });
});

describe('useAfterMatchImage: a video with reduced motion', () => {
  const NEXT = {
    startsAt: '2026-10-25T17:00:00.000Z',
    home: { name: 'Sir Susa Scai Perugia', logoUrl: null },
    away: { name: 'Itas Trentino', logoUrl: null },
    ourSide: 'home',
    venue: null,
    venueCity: null,
    roundLabel: '3ª Giornata Andata',
    leagueName: null,
    live: false,
    shortUrl: null,
  };
  const video: AfterMatch = { ...on, kind: 'video' };
  let schedules: number;

  function stub(reduce: boolean, fixtures: unknown[]): void {
    schedules = 0;
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: reduce && query.includes('reduced-motion'),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    vi.stubGlobal('fetch', () => {
      schedules += 1;
      // A plain answer: the body of a real Response is read with timers that the fake clock holds.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ fixtures, standings: null }) });
    });
  }
  const opened = async (config: AfterMatch) => {
    vi.useFakeTimers({ now: new Date('2026-10-24T08:00:00.000Z') });
    const hook = renderHook(() => useAfterMatchImage(data(), config));
    for (let i = 0; i < 3; i += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    return hook.result;
  };

  afterEach(() => {
    cleanup();
    resetSchedule();
    vi.unstubAllGlobals();
  });

  it('without a next match: null, the end-of-match pause stays (no empty screen)', async () => {
    stub(true, []);
    expect((await opened(video)).current).toBeNull();
  });

  it('with a next match: the screen with the countdown only', async () => {
    stub(true, [NEXT]);
    expect((await opened(video)).current).toBe(IMAGE);
  });

  it('a photo, or no reduced motion: shown, without reading the schedule', async () => {
    stub(true, []);
    expect((await opened(on)).current).toBe(IMAGE);
    stub(false, []);
    expect((await opened(video)).current).toBe(IMAGE);
    expect(schedules).toBe(0);
  });
});
