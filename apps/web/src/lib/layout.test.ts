import { describe, expect, it } from 'vitest';
import type { LayoutBlockInput, TenantLayout } from '@sir/shared';
import { LayoutBlockSchema, TenantLayoutSchema } from '@sir/shared';
import type { LayoutBlock } from './layout.ts';
import {
  blocksFor,
  defaultLayouts,
  deviceFor,
  tabletSpan,
  templateLayouts,
  tvMinRemFor,
  TV_BLOCK_MIN_REM,
  viewportClass,
  packRows,
  rotationIndex,
  rowMinRem,
  tvGroups,
  tvModeOf,
} from './layout.ts';

let next = 0;
/** Block of the contract with its defaults (a new id each time). */
const block = (b: Omit<LayoutBlockInput, 'id'>): LayoutBlock =>
  LayoutBlockSchema.parse({ id: `b${(next += 1)}`, ...b });

const types = (groups: LayoutBlock[][][]): string[][][] => groups.map((g) => g.map((r) => r.map((b) => b.type)));

describe('deviceFor', () => {
  const vp = (width: number, height: number) => ({ width, height });

  it('chooses phone and tablet from the breakpoints of the specifications', () => {
    expect(deviceFor(vp(320, 568))).toBe('phone');
    expect(deviceFor(vp(360, 780))).toBe('phone');
    expect(deviceFor(vp(430, 932))).toBe('phone');
    expect(deviceFor(vp(767, 1024))).toBe('phone');
    expect(deviceFor(vp(768, 1024))).toBe('tablet'); // iPad portrait
    expect(deviceFor(vp(1024, 768))).toBe('tablet'); // iPad landscape
    expect(deviceFor(vp(1366, 1024))).toBe('tablet'); // iPad Pro landscape
    expect(deviceFor(vp(1599, 900))).toBe('tablet');
  });

  it('lays a phone held sideways out as a tablet (horizontal scoreboard), the narrowest as a phone', () => {
    expect(deviceFor(vp(667, 375))).toBe('tablet');
    expect(deviceFor(vp(844, 390))).toBe('tablet');
    expect(deviceFor(vp(932, 430))).toBe('tablet');
    expect(deviceFor(vp(568, 320))).toBe('tablet');
    expect(deviceFor(vp(540, 320))).toBe('phone');
    // Never the big screen in full screen, but still with ?tv=1.
    expect(deviceFor(vp(844, 390), 'auto', true)).toBe('tablet');
    expect(deviceFor(vp(844, 390), 'on')).toBe('tv');
  });

  it('classifies the viewport as the specifications', () => {
    expect(viewportClass(vp(375, 812))).toBe('phone');
    expect(viewportClass(vp(844, 390))).toBe('phoneLandscape');
    expect(viewportClass(vp(768, 1024))).toBe('tabletPortrait');
    expect(viewportClass(vp(899, 1200))).toBe('tabletPortrait');
    expect(viewportClass(vp(900, 1200))).toBe('tabletLandscape');
    expect(viewportClass(vp(1199, 800))).toBe('tabletLandscape');
    expect(viewportClass(vp(1200, 800))).toBe('desktop');
    // Low but wide (desktop window, TV): not a phone.
    expect(viewportClass(vp(1920, 480))).toBe('desktop');
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

describe('grid of the tablet and of the desktop', () => {
  it('one column on a tablet in portrait, half or full in landscape, the chosen width on the desktop', () => {
    expect(tabletSpan(4)).toBe('col-span-12 @min-[856px]:col-span-6 @min-[1150px]:col-span-4');
    expect(tabletSpan(6)).toBe('col-span-12 @min-[856px]:col-span-6 @min-[1150px]:col-span-6');
    expect(tabletSpan(8)).toBe('col-span-12 @min-[856px]:col-span-12 @min-[1150px]:col-span-8');
    expect(tabletSpan(12)).toBe('col-span-12 @min-[856px]:col-span-12 @min-[1150px]:col-span-12');
    expect(tabletSpan(99)).toBe('col-span-12 @min-[856px]:col-span-12 @min-[1150px]:col-span-12');
  });
});

describe('default page of the template', () => {
  it('uses the page of the mockup without a layout of the client, the standard one otherwise', () => {
    const blocks = blocksFor(null, 'tablet', 'sir-volley');
    expect(blocks.map((b) => `${b.type}:${b.width}`)).toEqual([
      'scoreboard:12',
      'momentum:4',
      'comparison:4',
      'court:4',
      'players:8',
      'rotations:4',
    ]);
    expect(blocksFor(null, 'tablet')).toEqual(defaultLayouts.tablet);
    expect(templateLayouts.standard).toEqual(defaultLayouts);
  });

  it('fits the page of the mockup in one 16:9 screen of the big screen', () => {
    // 1920 × 1080 with --sir-tv-font-size of the template: 1 rem = 17.28 px; about 40 rem under the scoreboard.
    const groups = tvGroups(templateLayouts['sir-volley'].tv, 40, 1, tvMinRemFor('sir-volley'));
    expect(groups).toHaveLength(1);
    expect(types(groups)).toEqual([
      [
        ['momentum', 'comparison', 'court'],
        ['players', 'rotations'],
      ],
    ]);
    expect(tvMinRemFor('standard')).toBe(TV_BLOCK_MIN_REM);
  });
});

describe('defaultLayouts', () => {
  it('starts with the scoreboard and holds every block once on every device', () => {
    for (const blocks of Object.values(defaultLayouts)) {
      expect(blocks[0]?.type).toBe('scoreboard');
      expect(new Set(blocks.map((b) => b.type)).size).toBe(6);
    }
    expect(defaultLayouts.phone.every((b) => b.width === 12)).toBe(true);
  });
});

describe('blocksFor', () => {
  it('uses the layout of the client for the device and leaves out the hidden blocks', () => {
    const layout: TenantLayout = TenantLayoutSchema.parse({
      tv: [
        { id: 's', type: 'scoreboard' },
        { id: 'q', type: 'qr', width: 4, visible: false },
        { id: 'm', type: 'message', width: 8 },
      ],
      phone: [{ id: 'm', type: 'message' }],
    });
    expect(blocksFor(layout, 'tv').map((b) => b.id)).toEqual(['s', 'm']);
    expect(blocksFor(layout, 'phone').map((b) => b.type)).toEqual(['message']);
    expect(blocksFor(layout, 'tablet')).toEqual(defaultLayouts.tablet);
    expect(blocksFor(null, 'tv')).toEqual(defaultLayouts.tv);
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
      block({ type: 'momentum', width: 6 }),
      block({ type: 'comparison', width: 4 }),
      block({ type: 'qr', width: 3 }),
      block({ type: 'court', width: 4 }),
      block({ type: 'rotations', width: 4 }),
      block({ type: 'logo', width: 4 }),
      block({ type: 'players', width: 12 }),
    ]);
    expect(thirds.map((r) => r.length)).toEqual([2, 3, 1, 1]);
  });

  it('measures a row by its tallest block', () => {
    expect(rowMinRem([block({ type: 'momentum', width: 6 }), block({ type: 'players', width: 6 })])).toBe(22);
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
    expect(tvGroups([block({ type: 'scoreboard' })], 30)).toEqual([]);
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
