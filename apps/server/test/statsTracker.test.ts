import type { HelloMessage } from '@sir/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, romeDay } from '../src/stats/days.js';
import type { SocketView } from '../src/stats/tracker.js';
import {
  BUFFER_LIMIT,
  MAX_VISITS,
  PEAK_BUFFER_LIMIT,
  MIN_VISIT_MS,
  RECONNECT_GRACE_MS,
  VisitTracker,
} from '../src/stats/tracker.js';

const START = new Date('2026-10-17T10:00:00.000Z').getTime();
let clock = START;
beforeEach(() => {
  clock = START;
});
const advance = (ms: number): void => {
  clock += ms;
};
const tracker = () => new VisitTracker(() => new Date(clock));
const link = (tenantId = 't1', shareTokenId = 'l1') => ({ tenantId, shareTokenId, clientFixtureId: null });
const hello = (visit: string, over: Partial<HelloMessage> = {}): HelloMessage => ({
  type: 'hello',
  visit: visit.padEnd(16, 'x'),
  device: 'phone',
  source: 'link',
  app: false,
  ...over,
});
const view = (matchId: string | null = 'm1', simulated = false): SocketView => ({ matchId, simulated });

describe('VisitTracker', () => {
  it('ends a visit 30 seconds after its last socket closed, with the end of the viewing', () => {
    const t = tracker();
    const s = {};
    t.connect(s, link(), hello('a'), () => view());
    advance(90_000);
    t.disconnect(s, view());
    advance(RECONNECT_GRACE_MS - 1);
    expect(t.take().visits).toEqual([]);
    advance(1);
    const [v] = t.take().visits;
    expect(v).toMatchObject({ seconds: 90, matchId: 'm1', day: '2026-10-17', tenantId: 't1' });
    expect((v?.endedAt.getTime() ?? 0) - (v?.startedAt.getTime() ?? 0)).toBe(90_000);
    expect(t.openVisits).toBe(0);
  });

  it('joins a reconnection within the grace time to the same visit, even from another socket', () => {
    const t = tracker();
    const a = {};
    const b = {};
    t.connect(a, link(), hello('a'), () => view());
    advance(10_000);
    t.disconnect(a, view());
    advance(20_000);
    expect(t.connect(b, link(), hello('a'), () => view())).toBe(true);
    advance(10_000);
    t.disconnect(b, view());
    advance(RECONNECT_GRACE_MS);
    const taken = t.take().visits;
    expect(taken).toHaveLength(1);
    expect(taken[0]?.seconds).toBe(40);
  });

  it('after the grace time the same id is a new visit; the same id on another link or client is not joined', () => {
    const t = tracker();
    const a = {};
    t.connect(a, link(), hello('a'), () => view());
    advance(5_000);
    t.disconnect(a, view());
    advance(RECONNECT_GRACE_MS);
    expect(t.take().visits).toHaveLength(1);
    t.connect({}, link(), hello('a'), () => view());
    t.connect({}, link('t1', 'other'), hello('a'), () => view());
    t.connect({}, link('t2', 'l3'), hello('a'), () => view());
    expect(t.openVisits).toBe(3);
  });

  it('counts one visit per socket: a second hello of the same socket is ignored', () => {
    const t = tracker();
    const s = {};
    expect(t.connect(s, link(), hello('a'), () => view())).toBe(true);
    expect(t.connect(s, link(), hello('b'), () => view())).toBe(false);
    expect(t.openVisits).toBe(1);
  });

  it('does not record visits shorter than the minimum, nor simulated ones', () => {
    const t = tracker();
    const quick = {};
    t.connect(quick, link(), hello('quick'), () => view());
    advance(MIN_VISIT_MS - 1);
    t.disconnect(quick, view());
    const sim = {};
    t.connect(sim, link(), hello('sim'), () => view('sim-match', true));
    advance(60_000);
    t.samplePeaks();
    t.disconnect(sim, view('sim-match', true));
    advance(RECONNECT_GRACE_MS);
    const taken = t.take();
    expect(taken.visits).toEqual([]);
    expect(taken.peaks).toEqual([]);
  });

  it('samples the spectators of each match per minute (highest of the minute), clients apart', () => {
    const t = tracker();
    const [s1, s2, s3, s4] = [{}, {}, {}, {}];
    t.connect(s1, link(), hello('a'), () => view('m1'));
    t.connect(s2, link(), hello('b'), () => view('m1'));
    t.connect(s3, link('t2', 'l2'), hello('c'), () => view('m2'));
    t.connect(s4, link(), hello('d'), () => view(null));
    t.samplePeaks();
    t.disconnect(s2, view('m1'));
    t.samplePeaks();
    advance(60_000);
    t.samplePeaks();
    const peaks = t.take().peaks.sort((x, y) => x.matchId.localeCompare(y.matchId) || +x.minute - +y.minute);
    expect(peaks.map((p) => [p.tenantId, p.matchId, p.viewers, p.minute.toISOString()])).toEqual([
      ['t1', 'm1', 2, '2026-10-17T10:00:00.000Z'],
      ['t1', 'm1', 1, '2026-10-17T10:01:00.000Z'],
      ['t2', 'm2', 1, '2026-10-17T10:00:00.000Z'],
      ['t2', 'm2', 1, '2026-10-17T10:01:00.000Z'],
    ]);
  });

  it('reads who is connected now, by client, from the live view of the sockets', () => {
    const t = tracker();
    let shown = view(null);
    t.connect({}, link(), hello('a'), () => shown);
    t.connect({}, link('t2', 'l2'), hello('b'), () => view('m9'));
    expect(t.currently('t1').matches.get(null)).toBe(1);
    shown = view('m1');
    const now = t.currently('t1');
    expect(now.viewers).toBe(1);
    expect(now.matches.get('m1')).toBe(1);
    expect(now.links.get('l1')).toBe(1);
    expect(t.currently('t3').viewers).toBe(0);
  });

  it('at the shutdown the open visits end now; a refused batch goes back to the buffer', () => {
    const t = tracker();
    t.connect({}, link(), hello('a'), () => view('m1'));
    advance(30_000);
    t.samplePeaks();
    expect(t.take().visits).toEqual([]);
    const batch = t.take(true);
    expect(batch.visits).toHaveLength(1);
    expect(batch.visits[0]?.seconds).toBe(30);
    t.giveBack(batch);
    expect(t.pending.visits).toBe(1);
    expect(t.take().visits).toHaveLength(1);
  });

  it('keeps the buffer bounded and handles 5000 spectators without per-message work', () => {
    const t = tracker();
    const started = performance.now();
    const sockets: object[] = [];
    for (let i = 0; i < 5000; i++) {
      const s = {};
      sockets.push(s);
      t.connect(s, link(), hello(`v${i}`), () => view('m1'));
    }
    t.samplePeaks();
    expect(t.pending.peaks).toBe(1);
    expect(t.currently('t1').viewers).toBe(5000);
    advance(60_000);
    for (const s of sockets) t.disconnect(s, view('m1'));
    advance(RECONNECT_GRACE_MS);
    expect(t.take().visits).toHaveLength(5000);
    // Whole cycle for 5000 spectators in well under a second: the cost is per visit and per minute, never per message.
    expect(performance.now() - started).toBeLessThan(1000);
    const full = tracker();
    full.giveBack({
      visits: Array.from({ length: BUFFER_LIMIT + 5 }, () => ({
        id: crypto.randomUUID(),
        tenantId: 't',
        shareTokenId: 'l',
        clientFixtureId: null,
        matchId: null,
        startedAt: new Date(clock),
        endedAt: new Date(clock),
        seconds: 5,
        device: 'phone' as const,
        source: 'link' as const,
        app: false,
        day: '2026-10-17',
      })),
      peaks: [],
    });
    expect(full.pending.visits).toBe(BUFFER_LIMIT);
    expect(full.dropped).toBe(5);
  });
});

describe('limits', () => {
  it('stops counting new visits past the cap, and the peaks given back are bounded', () => {
    const t = tracker();
    for (let i = 0; i < MAX_VISITS; i++) t.connect({}, link(), hello(`v${i}`), () => view());
    expect(t.connect({}, link(), hello('one-more'), () => view())).toBe(false);
    expect(t.dropped).toBe(1);
    const peaks = Array.from({ length: PEAK_BUFFER_LIMIT + 3 }, (_, i) => ({
      tenantId: 't1',
      matchId: 'm1',
      minute: new Date(START + i * 60_000),
      viewers: 1,
      day: '2026-10-17',
    }));
    t.giveBack({ visits: [], peaks });
    expect(t.pending.peaks).toBe(PEAK_BUFFER_LIMIT);
    expect(t.dropped).toBe(4);
  });

  it('gives every finished visit its own id', () => {
    const t = tracker();
    for (const n of ['a', 'b']) {
      const s = {};
      t.connect(s, link(), hello(n), () => view());
      advance(5_000);
      t.disconnect(s, view());
    }
    advance(RECONNECT_GRACE_MS);
    const ids = t.take().visits.map((v) => v.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('days', () => {
  it('uses the day of Rome', () => {
    expect(romeDay(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
    expect(romeDay(new Date('2026-01-01T22:59:00Z'))).toBe('2026-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-17', -90)).toBe('2026-07-19');
  });
});
