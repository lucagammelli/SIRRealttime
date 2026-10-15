import { describe, expect, it } from 'vitest';
import { canonicalJson, frameHeader, percentile, stepCounts, summarize } from './metrics.js';

describe('frameHeader', () => {
  it('reads type, match and versions of state and patch messages', () => {
    const id = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
    expect(frameHeader(JSON.stringify({ type: 'state', matchId: id, version: 3, state: {} }))).toEqual({
      type: 'state',
      matchId: id,
      baseVersion: null,
      version: 3,
    });
    expect(
      frameHeader(JSON.stringify({ type: 'patch', matchId: id, baseVersion: 3, version: 4, ops: [] })),
    ).toMatchObject({ type: 'patch', baseVersion: 3, version: 4 });
    expect(frameHeader('{"type":"noMatch"}')).toMatchObject({ type: 'noMatch', matchId: null });
    expect(frameHeader('niente')).toBeNull();
  });
});

describe('stepCounts', () => {
  const lines = ['*13SM+', 'a05RM#', '*p01:00', '*z1', 'ap01:01', '*13SM-'];
  it('ends a step at every point line, and keeps the last lines', () => {
    expect(stepCounts(lines, 'point')).toEqual([3, 5, 6]);
    expect(stepCounts(lines, 'line')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stepCounts([], 'point')).toEqual([]);
  });
});

describe('percentile and summarize', () => {
  it('uses the nearest rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(summarize(values)).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(summarize([]).count).toBe(0);
  });
});

describe('canonicalJson', () => {
  it('ignores the key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});
