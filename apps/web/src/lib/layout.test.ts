import { describe, expect, it } from 'vitest';
import type { LayoutBlock } from './layout.ts';
import { defaultLayouts, deviceFor, packRows, rotationIndex, rowMinRem, tvGroups, tvModeOf } from './layout.ts';

const types = (groups: LayoutBlock[][][]): string[][][] => groups.map((g) => g.map((r) => r.map((b) => b.type)));

describe('deviceFor', () => {
  const vp = (width: number, height: number) => ({ width, height });

  it('chooses phone and tablet from the width', () => {
    expect(deviceFor(vp(360, 780))).toBe('phone');
    expect(deviceFor(vp(699, 900))).toBe('phone');
    expect(deviceFor(vp(700, 1000))).toBe('tablet');
    expect(deviceFor(vp(1599, 900))).toBe('tablet');
  });

  it('big screen by itself only from 1600 × 800 and at least 16:10', () => {
    expect(deviceFor(vp(1600, 1000))).toBe('tv'); // exactly 16:10
    expect(deviceFor(vp(1920, 1080))).toBe('tv');
    expect(deviceFor(vp(3840, 2160))).toBe('tv');
    expect(deviceFor(vp(1920, 799))).toBe('tablet'); // too low
    expect(deviceFor(vp(1600, 1200))).toBe('tablet'); // 4:3 monitor
    expect(deviceFor(vp(1920, 1201))).toBe('tablet'); // just under 16:10
  });

  it('?tv=1 forces it, ?tv=0 excludes it', () => {
    expect(deviceFor(vp(360, 780), 'on')).toBe('tv');
    expect(deviceFor(vp(1024, 768), 'on')).toBe('tv');
    expect(deviceFor(vp(1920, 1080), 'off')).toBe('tablet');
    expect(deviceFor(vp(1920, 1080), 'off', true)).toBe('tablet');
    expect(deviceFor(vp(390, 800), 'off')).toBe('phone');
  });

  it('full screen gives the big screen from tablet up, never on a phone', () => {
    expect(deviceFor(vp(1024, 768), 'auto', true)).toBe('tv');
    expect(deviceFor(vp(390, 844), 'auto', true)).toBe('phone');
  });

  it('reads ?tv= of the URL', () => {
    expect([tvModeOf('1'), tvModeOf('0'), tvModeOf(null), tvModeOf('si')]).toEqual(['on', 'off', 'auto', 'auto']);
  });
});

describe('defaultLayouts', () => {
  it('starts with the scoreboard and holds every block once on every device', () => {
    for (const blocks of Object.values(defaultLayouts)) {
      expect(blocks[0]?.type).toBe('scoreboard');
      expect(new Set(blocks.map((b) => b.type)).size).toBe(6);
    }
    expect(defaultLayouts.phone.every((b) => b.width === 'full')).toBe(true);
  });
});

describe('packRows', () => {
  it('puts side by side the blocks that fit in a row', () => {
    const rows = packRows(defaultLayouts.tv.slice(1));
    expect(rows.map((r) => r.map((b) => b.type))).toEqual([
      ['momentum', 'comparison'],
      ['players'],
      ['court', 'rotations'],
    ]);
    const thirds = packRows([
      { type: 'momentum', width: 'third' },
      { type: 'comparison', width: 'third' },
      { type: 'court', width: 'third' },
      { type: 'rotations', width: 'half' },
    ]);
    expect(thirds.map((r) => r.length)).toEqual([3, 1]);
  });

  it('measures a row by its tallest block', () => {
    expect(
      rowMinRem([
        { type: 'momentum', width: 'half' },
        { type: 'players', width: 'half' },
      ]),
    ).toBe(22);
  });
});

describe('tvGroups', () => {
  const tv = defaultLayouts.tv;

  it('fits all the rows in one screen when the height is enough', () => {
    expect(types(tvGroups(tv, 100))).toEqual([[['momentum', 'comparison'], ['players'], ['court', 'rotations']]]);
  });

  it('splits the rows in groups by the available height (gaps included)', () => {
    // Rows: 18, 22, 22 rem; gap 1.
    expect(types(tvGroups(tv, 41))).toEqual([[['momentum', 'comparison'], ['players']], [['court', 'rotations']]]);
    expect(types(tvGroups(tv, 40.9))).toEqual([[['momentum', 'comparison']], [['players']], [['court', 'rotations']]]);
    expect(types(tvGroups(tv, 45))).toEqual([[['momentum', 'comparison'], ['players']], [['court', 'rotations']]]);
    expect(types(tvGroups(tv, 64))).toHaveLength(1);
  });

  it('keeps a row taller than the space as a group of its own, and never shows the scoreboard in a group', () => {
    const groups = tvGroups(tv, 0);
    expect(groups).toHaveLength(3);
    expect(groups.flat(2).some((b) => b.type === 'scoreboard')).toBe(false);
    expect(tvGroups([{ type: 'scoreboard', width: 'full' }], 30)).toEqual([]);
  });
});

describe('rotationIndex', () => {
  it('cycles through the groups and stays on the first with reduced motion or one group', () => {
    expect([0, 1, 2, 3, 4].map((t) => rotationIndex(t, 3, false))).toEqual([0, 1, 2, 0, 1]);
    expect(rotationIndex(5, 3, true)).toBe(0);
    expect(rotationIndex(5, 1, false)).toBe(0);
    expect(rotationIndex(5, 0, false)).toBe(0);
  });
});
