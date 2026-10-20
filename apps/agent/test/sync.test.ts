import { hashScoutLines } from '@arenalive/shared';
import { describe, expect, it } from 'vitest';
import { planRequests } from '../src/sync.js';

const lines = (n: number, tag = 'l'): string[] => Array.from({ length: n }, (_, i) => `${tag}${i}`);

describe('planRequests', () => {
  it('prima volta: snapshot con header', async () => {
    const [r, ...rest] = await planRequests(null, { header: 'H', lines: lines(3) });
    expect(rest).toHaveLength(0);
    expect(r).toEqual({
      kind: 'snapshot',
      fromIndex: 0,
      lines: lines(3),
      header: 'H',
      contentHash: await hashScoutLines(lines(3)),
    });
  });

  it('righe nuove: append senza header se uguale, con header se cambiato', async () => {
    const base = { header: 'H', lines: lines(3) };
    const [a] = await planRequests(base, { header: 'H', lines: lines(5) });
    expect(a).toMatchObject({ kind: 'append', fromIndex: 3, lines: ['l3', 'l4'] });
    expect(a).not.toHaveProperty('header');
    const [b] = await planRequests(base, { header: 'H2', lines: lines(3) });
    expect(b).toMatchObject({ kind: 'append', fromIndex: 3, lines: [], header: 'H2' });
  });

  it('niente da inviare se righe e header sono uguali, anche con forceSnapshot', async () => {
    const base = { header: 'H', lines: lines(3) };
    expect(await planRequests(base, { header: 'H', lines: lines(3) })).toEqual([]);
    expect(await planRequests(base, { header: 'H', lines: lines(3) }, true)).toEqual([]);
  });

  it('riga passata corretta o righe tolte: snapshot; forceSnapshot trasforma un append in snapshot', async () => {
    const base = { header: 'H', lines: lines(3) };
    const [a] = await planRequests(base, { header: 'H', lines: ['l0', 'X', 'l2'] });
    expect(a).toMatchObject({ kind: 'snapshot', fromIndex: 0, header: 'H' });
    const [b] = await planRequests(base, { header: 'H', lines: lines(2) });
    expect(b).toMatchObject({ kind: 'snapshot', lines: lines(2) });
    const [c] = await planRequests(base, { header: 'H', lines: lines(4) }, true);
    expect(c).toMatchObject({ kind: 'snapshot', lines: lines(4) });
  });

  it('divide oltre il massimo di righe, con hash cumulativo', async () => {
    const next = { header: 'H', lines: lines(12) };
    const parts = await planRequests({ header: 'H', lines: lines(1) }, next, false, 5);
    expect(parts.map((p) => [p.kind, p.fromIndex, p.lines.length])).toEqual([
      ['append', 1, 5],
      ['append', 6, 5],
      ['append', 11, 1],
    ]);
    expect(parts[1]?.contentHash).toBe(await hashScoutLines(lines(11)));
    const snap = await planRequests(null, next, false, 5);
    expect(snap.map((p) => [p.kind, p.fromIndex, p.lines.length, p.header])).toEqual([
      ['snapshot', 0, 5, 'H'],
      ['append', 5, 5, undefined],
      ['append', 10, 2, undefined],
    ]);
    expect(snap[2]?.contentHash).toBe(await hashScoutLines(lines(12)));
  });
});
