import type { AfterMatch } from '@arenalive/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateAfter } from '../test/fixtures.ts';
import { afterMatchDueAt, useAfterMatchImage } from './afterMatch.ts';
import type { LiveData } from './liveConnection.ts';

const IMAGE = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const END = '2026-10-23T19:00:00.000Z';
const on: AfterMatch = { enabled: true, image: IMAGE, delayMinutes: 30 };
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
