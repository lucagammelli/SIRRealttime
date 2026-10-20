import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeDvw, parseDvw } from '@arenalive/dvw-parser';
import { applyCorrection, generateMatch, renderDvw } from '@arenalive/dvw-simulator';
import { computeMatchState } from '@arenalive/volley-stats';
import { describe, expect, it } from 'vitest';
import type { JsonValue, PatchOp } from './index.js';
import {
  PatchError,
  PatchMessageSchema,
  PatchOpsSchema,
  ServerMessageSchema,
  applyPatch,
  buildDvwText,
  diffJson,
  jsonEqual,
  splitDvwText,
} from './index.js';

const roundTrip = (a: JsonValue, b: JsonValue): JsonValue => applyPatch(a, diffJson(a, b));

describe('diffJson / applyPatch', () => {
  it('gives no operations for equal values, also with another key order', () => {
    expect(diffJson({ a: 1, b: [1, { c: 2 }] }, { a: 1, b: [1, { c: 2 }] })).toEqual([]);
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('sets changed keys, adds new ones and deletes missing ones', () => {
    const name = 'nome lungo della squadra di casa '.repeat(5);
    const a = { score: { home: 1, away: 0 }, old: true, name };
    const b = { score: { home: 2, away: 0 }, name, added: [1] };
    expect(diffJson(a, b)).toEqual([
      { op: 'del', path: ['old'] },
      { op: 'set', path: ['score', 'home'], value: 2 },
      { op: 'set', path: ['added'], value: [1] },
    ]);
    expect(JSON.stringify(roundTrip(a, b))).toBe(JSON.stringify(b));
  });

  it('appends to arrays, replaces by index and truncates', () => {
    expect(diffJson({ l: [1, 2] }, { l: [1, 2, 3, 4] })).toEqual([{ op: 'push', path: ['l'], values: [3, 4] }]);
    expect(diffJson({ l: [1, 2, 3] }, { l: [1] })).toEqual([{ op: 'trunc', path: ['l'], length: 1 }]);
    expect(diffJson({ l: [1, 2, 3] }, { l: [1, 9, 3] })).toEqual([{ op: 'set', path: ['l', 1], value: 9 }]);
    const a = { l: [{ v: 1 }, { v: 2 }, { v: 3 }] };
    const b = { l: [{ v: 1 }, { v: 5 }] };
    expect(JSON.stringify(roundTrip(a, b))).toBe(JSON.stringify(b));
  });

  it('replaces values of another type and the root', () => {
    expect(diffJson({ a: [1] }, { a: { x: 1 } })).toEqual([{ op: 'set', path: ['a'], value: { x: 1 } }]);
    expect(diffJson([1], { x: 1 })).toEqual([{ op: 'set', path: [], value: { x: 1 } }]);
    expect(diffJson(1, null)).toEqual([{ op: 'set', path: [], value: null }]);
    expect(roundTrip({ a: 1 }, 'testo')).toBe('testo');
  });

  it('keeps the key order of the new value (same JSON text)', () => {
    const a = { a: 1, c: 3 };
    const b = { a: 1, b: 2, c: 3 };
    expect(JSON.stringify(roundTrip(a, b))).toBe(JSON.stringify(b));
    const swapped = { c: 3, a: 1 };
    expect(JSON.stringify(roundTrip(a, swapped))).toBe(JSON.stringify(swapped));
  });

  it('sends a container whole when that is shorter than its changes', () => {
    const a = { l: [1, 2, 3, 4, 5, 6] };
    const b = { l: [7, 8, 9, 10, 11, 12] };
    expect(diffJson(a, b)).toEqual([{ op: 'set', path: ['l'], value: b.l }]);
  });

  it('does not change the input and shares the untouched parts', () => {
    const a = { big: { deep: [1, 2, 3] }, score: { home: 1 } };
    const frozen = JSON.stringify(a);
    const next = applyPatch(a, [{ op: 'set', path: ['score', 'home'], value: 2 }]) as typeof a;
    expect(JSON.stringify(a)).toBe(frozen);
    expect(next.score.home).toBe(2);
    expect(next.big).toBe(a.big);
  });

  it('is deterministic', () => {
    const a = { x: [1, { y: 2 }], z: 'a' };
    const b = { x: [1, { y: 3 }, 4], w: null };
    expect(JSON.stringify(diffJson(a, b))).toBe(JSON.stringify(diffJson(a, b)));
  });

  it('keeps "__proto__" as a plain key', () => {
    const b = JSON.parse('{"__proto__":{"polluted":true}}') as JsonValue;
    const out = applyPatch({}, diffJson({}, b)) as Record<string, unknown>;
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('throws PatchError for operations that do not fit', () => {
    const doc = { a: [1, 2], o: { k: 1 } };
    const bad: PatchOp[][] = [
      [{ op: 'set', path: ['missing', 'x'], value: 1 }],
      [{ op: 'set', path: ['a', 5], value: 1 }],
      [{ op: 'set', path: ['a', 'x'], value: 1 }],
      [{ op: 'del', path: ['o', 'nope'] }],
      [{ op: 'del', path: ['a', 0] }],
      [{ op: 'push', path: ['o'], values: [1] }],
      [{ op: 'trunc', path: ['a'], length: 3 }],
      [{ op: 'set', path: ['a', 0, 'x'], value: 1 }],
      [{ op: 'set', path: ['o', 0], value: 1 }],
    ];
    for (const ops of bad) expect(() => applyPatch(doc, ops), JSON.stringify(ops)).toThrow(PatchError);
  });

  it('validates operations and patch messages with zod', () => {
    const id = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
    const ops = [{ op: 'set', path: ['a', 0], value: { b: 1 } }];
    expect(PatchOpsSchema.safeParse(ops).success).toBe(true);
    expect(PatchOpsSchema.safeParse([{ op: 'del', path: [] }]).success).toBe(false);
    expect(PatchOpsSchema.safeParse([{ op: 'trunc', path: [], length: -1 }]).success).toBe(false);
    expect(PatchOpsSchema.safeParse([{ op: 'set', path: [-1], value: 1 }]).success).toBe(false);
    expect(PatchOpsSchema.safeParse([{ op: 'move', path: [] }]).success).toBe(false);
    const message = { type: 'patch', matchId: id, baseVersion: 1, version: 2, ops };
    expect(PatchMessageSchema.safeParse(message).success).toBe(true);
    expect(ServerMessageSchema.safeParse(message).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ ...message, version: 1 }).success).toBe(false);
  });
});

/** States of a match as the server computes them, from the scout lines visible after each new row. */
function statesOf(header: string, lines: readonly string[], counts: readonly number[]): JsonValue[] {
  return counts.map(
    (n) =>
      JSON.parse(JSON.stringify(computeMatchState(parseDvw(buildDvwText(header, lines.slice(0, n)))))) as JsonValue,
  );
}

/** Applies the patch of every step to the first state; checks every step and returns the bytes sent. */
function replay(states: JsonValue[]): { full: number; patches: number[] } {
  let shown = states[0] as JsonValue;
  const patches: number[] = [];
  for (let i = 1; i < states.length; i++) {
    const next = states[i] as JsonValue;
    const ops = diffJson(states[i - 1] as JsonValue, next);
    patches.push(JSON.stringify(ops).length);
    shown = applyPatch(shown, ops);
    expect(JSON.stringify(shown), `passo ${i}`).toBe(JSON.stringify(next));
  }
  return { full: JSON.stringify(states.at(-1)).length, patches };
}

const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));
const sampleFiles = readdirSync(SAMPLES).filter((f) => f.toLowerCase().endsWith('.dvw'));

describe('patch sequence of a real match', () => {
  it('has at least one sample', () => {
    expect(sampleFiles.length).toBeGreaterThan(0);
  });

  for (const file of sampleFiles) {
    it(`rebuilds the final state of ${file}, row by row`, { timeout: 120_000 }, () => {
      const { header, scoutLines } = splitDvwText(decodeDvw(readFileSync(SAMPLES + file)));
      const counts = Array.from({ length: scoutLines.length + 1 }, (_, n) => n);
      const { full, patches } = replay(statesOf(header, scoutLines, counts));
      const median = [...patches].sort((x, y) => x - y)[Math.floor(patches.length / 2)] ?? 0;
      // The point of the patches: a typical step is a small fraction of the full state.
      expect(median).toBeLessThan(full / 10);
    });
  }

  it('follows corrections of past rows (snapshots) of a simulated match', () => {
    let match = generateMatch({ seed: 7 });
    const at = (m: typeof match, n: number) => splitDvwText(decodeDvw(renderDvw(m, n)));
    const states: JsonValue[] = [];
    for (let n = 0; n <= 120; n += 3) {
      if (n === 60) match = applyCorrection(match, 10, 99, n);
      const { header, scoutLines } = at(match, n);
      states.push(...statesOf(header, scoutLines, [scoutLines.length]));
    }
    replay(states);
  });
});
