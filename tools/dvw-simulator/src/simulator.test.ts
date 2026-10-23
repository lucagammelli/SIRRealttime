import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCorrection, generateMatch, play, playGapMs, renderDvw } from './index.js';

const decode = (b: Uint8Array): string => iconv.decode(Buffer.from(b), 'win1252');
const scoutRows = (text: string): string[] =>
  text
    .split('\r\n')
    .slice(text.split('\r\n').indexOf('[3SCOUT]') + 1)
    .filter(Boolean);

describe('generateMatch', () => {
  it('is deterministic for the same seed and differs for another', () => {
    const a = renderDvw(generateMatch({ seed: 7 }), 100000);
    const b = renderDvw(generateMatch({ seed: 7 }), 100000);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = renderDvw(generateMatch({ seed: 8 }), 100000);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('has 12-14 players per team', () => {
    const m = generateMatch({ seed: 3 });
    for (const t of [m.home, m.away]) {
      expect(t.players.length).toBeGreaterThanOrEqual(12);
      expect(t.players.length).toBeLessThanOrEqual(14);
    }
  });

  it.each([3, 4, 5] as const)('plays valid sets for %i sets', (n) => {
    for (let seed = 1; seed <= 5; seed++) {
      const m = generateMatch({ seed, sets: n });
      expect(m.sets).toHaveLength(n);
      let homeSets = 0;
      for (const s of m.sets) {
        const target = n === 5 && s.number === 5 ? 15 : 25;
        const winner = Math.max(s.home, s.away);
        expect(winner).toBeGreaterThanOrEqual(target);
        expect(Math.abs(s.home - s.away)).toBeGreaterThanOrEqual(2);
        if (winner === target) expect(Math.abs(s.home - s.away)).toBeGreaterThanOrEqual(2);
        else expect(Math.abs(s.home - s.away)).toBe(2);
        if (s.home > s.away) homeSets++;
        const points = m.lines.filter((l) => l.set === s.number && l.kind === 'point');
        let prev: [number, number] = [0, 0];
        let server = -1;
        for (const p of points) {
          const sc = p.score as [number, number];
          const dh = sc[0] - prev[0];
          const da = sc[1] - prev[1];
          expect(dh >= 0 && da >= 0 && dh + da === 1).toBe(true);
          prev = sc;
          server = dh === 1 ? 0 : 1;
        }
        expect(prev).toEqual([s.home, s.away]);
        expect(server).toBe(s.home > s.away ? 0 : 1);
        expect(m.lines.filter((l) => l.set === s.number).at(-1)?.code).toBe(`**${s.number}set`);
      }
      const awaySets = n - homeSets;
      expect(Math.max(homeSets, awaySets)).toBe(3);
    }
  });

  it('serves are by the team that won the previous point (service alternation)', () => {
    const m = generateMatch({ seed: 11 });
    const set1 = m.lines.filter((l) => l.set === 1);
    let lastWinner: string | null = null;
    for (const l of set1) {
      if (l.kind === 'action' && l.code[3] === 'S' && lastWinner) expect(l.code[0]).toBe(lastWinner);
      if (l.kind === 'point') lastWinner = l.code[0] as string;
    }
  });
});

describe('renderDvw', () => {
  const m = generateMatch({ seed: 1 });

  it('writes all sections, CRLF and a partial scout section', () => {
    const text = decode(renderDvw(m, 10));
    for (const s of [
      '[3DATAVOLLEYSCOUT]',
      '[3MATCH]',
      '[3TEAMS]',
      '[3MORE]',
      '[3SET]',
      '[3PLAYERS-H]',
      '[3PLAYERS-V]',
      '[3ATTACKCOMBINATION]',
      '[3SETTERCALL]',
      '[3SCOUT]',
    ]) {
      expect(text).toContain(s);
    }
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
    expect(scoutRows(text)).toHaveLength(10);
    expect(scoutRows(decode(renderDvw(m, 0)))).toHaveLength(0);
    expect(scoutRows(decode(renderDvw(m, m.lines.length)))).toHaveLength(m.lines.length);
  });

  it('encodes accents as Windows-1252 by default and UTF-8 on request', () => {
    const win = renderDvw(m, 1);
    expect(Buffer.from(win).includes(Buffer.from([0x43, 0x69, 0x74, 0x74, 0xe0]))).toBe(true);
    expect(decode(win)).toContain('Pallavolo Città');
    const utf = renderDvw(m, 1, { encoding: 'utf8' });
    expect(Buffer.from(utf).toString('utf8')).toContain('Città');
  });

  it('updates partials and sets won only with the visible rows', () => {
    const early = decode(renderDvw(m, 20));
    expect(early).toMatch(/\[3SET\]\r\nFalse;/);
    const full = decode(renderDvw(m, m.lines.length));
    expect(full).toMatch(/\[3SET\]\r\nTrue;/);
  });

  it('writes scout fields after the code', () => {
    const row = scoutRows(decode(renderDvw(m, 5)))[0] as string;
    const f = row.split(';');
    expect(f).toHaveLength(27);
    expect(f[7]).toMatch(/^\d\d\.\d\d\.\d\d$/);
  });
});

describe('applyCorrection', () => {
  it('changes exactly one row and keeps the original untouched', () => {
    const m = generateMatch({ seed: 2 });
    const c = applyCorrection(m, 40, 5);
    const diff = m.lines.filter((l, i) => l.code !== (c.lines[i] as { code: string }).code);
    expect(c.lines).toHaveLength(m.lines.length);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.kind).toBe('action');
  });
});

describe('applyCorrection visible', () => {
  it('only corrects rows among the first `visible`', () => {
    const m = generateMatch({ seed: 2 });
    for (let seed = 1; seed <= 20; seed++) {
      const c = applyCorrection(m, 5, seed, 30);
      const idx = m.lines.findIndex((l, i) => l.code !== (c.lines[i] as { code: string }).code);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(30);
    }
  });
});

describe('playGapMs', () => {
  it('waits at least the minimum break after the end of a set, whatever the speed', () => {
    const match = generateMatch({ seed: 1 });
    const end = match.lines.findIndex((l) => l.kind === 'endset');
    const n = end + 2; // 1-based row right after the `endset` row
    expect(playGapMs(match, n, 1000, 0)).toBeLessThan(1000);
    expect(playGapMs(match, n, 1000, 20)).toBe(20_000);
    // At normal speed the real break (5 minutes) is longer than the minimum: it stays.
    expect(playGapMs(match, n, 1, 20)).toBe(300_000);
    // A row in the middle of a rally is not affected.
    expect(playGapMs(match, 3, 1000, 20)).toBeLessThan(1000);
  });
});

describe('play', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it.each(['atomic', 'direct'] as const)('ends with the complete file (%s)', async (mode) => {
    dir = await mkdtemp(join(tmpdir(), 'dvw-sim-'));
    const out = join(dir, 'live.dvw');
    const m = generateMatch({ seed: 4 });
    await play(m, { out, speed: 1e9, mode, corrections: false });
    const written = await readFile(out);
    expect(written.equals(Buffer.from(renderDvw(m, m.lines.length)))).toBe(true);
  });

  it('with corrections the file converges to a corrected match', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dvw-sim-'));
    const out = join(dir, 'live.dvw');
    const m = generateMatch({ seed: 4 });
    await play(m, { out, speed: 1e9, mode: 'atomic', corrections: true });
    const rows = scoutRows(decode(await readFile(out)));
    expect(rows).toHaveLength(m.lines.length);
  });

  it('stops when aborted', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dvw-sim-'));
    const controller = new AbortController();
    const m = generateMatch({ seed: 4 });
    const p = play(m, {
      out: join(dir, 'live.dvw'),
      speed: 1,
      mode: 'atomic',
      corrections: false,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await p;
    expect(controller.signal.aborted).toBe(true);
  });
});
