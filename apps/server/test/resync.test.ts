import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESYNC_MIN_INTERVAL_MS, ResyncScheduler } from '../src/lib/resync.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

const scheduler = (maxPerIp = 100) => new ResyncScheduler(() => new Date(), RESYNC_MIN_INTERVAL_MS, maxPerIp);

describe('ResyncScheduler', () => {
  it('waits 5 s between two full states of a socket', () => {
    expect(RESYNC_MIN_INTERVAL_MS).toBe(5000);
  });

  it('answers at once, then answers a request inside the interval when it ends, only once', () => {
    const send = vi.fn();
    const gate = scheduler().forSocket('10.0.0.1', send);
    gate.request();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    gate.request();
    gate.request();
    gate.request();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3999);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    // The interval counts from the delayed answer.
    gate.request();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not answer after cancel (socket closed)', () => {
    const send = vi.fn();
    const gate = scheduler().forSocket(null, send);
    gate.request();
    gate.request();
    gate.cancel();
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends at most N full states per second to the sockets of one IP, the others in the next seconds', () => {
    const s = scheduler(2);
    const sends = Array.from({ length: 5 }, () => vi.fn());
    for (const send of sends) s.forSocket('10.0.0.1', send).request();
    const other = vi.fn();
    s.forSocket('10.0.0.2', other).request();
    const calls = () => sends.map((f) => f.mock.calls.length);
    expect(calls()).toEqual([1, 1, 0, 0, 0]);
    expect(other).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(calls()).toEqual([1, 1, 1, 1, 0]);
    vi.advanceTimersByTime(1000);
    expect(calls()).toEqual([1, 1, 1, 1, 1]);
  });
});
