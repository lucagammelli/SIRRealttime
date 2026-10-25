import { describe, expect, it } from 'vitest';
import type { LayoutBlockInput, TenantLayout } from '@arenalive/shared';
import { LayoutBlockSchema, TenantLayoutSchema } from '@arenalive/shared';
import type { LayoutBlock } from './layout.ts';
import {
  blockMinRem,
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
  groupMinRem,
  tvGroups,
  tvModeOf,
  tvZoom,
  TV_MAX_SHRINK,
  TV_LIST_ROW_REM,
  TV_PLAYERS_ROWS,
  tvContentRem,
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

  it('the page of the mockup on the big screen: two screens, the player table whole', () => {
    // 1920 × 1080 with --sir-tv-font-size of the template: 1 rem = 17.28 px; about 40 rem under the scoreboard.
    // The table of the players of a team (14 rows) needs 36 rem: 18 + 1 + 36 = 55 > 40 / 0.85, so two screens.
    const minRem = tvMinRemFor('sir-volley');
    const groups = tvGroups(templateLayouts['sir-volley'].tv, 40, 1, minRem, TV_MAX_SHRINK);
    expect(types(groups)).toEqual([[['momentum', 'comparison', 'court']], [['players', 'rotations']]]);
    expect(groupMinRem(groups[1] ?? [], 1, minRem)).toBe(36);
    expect(tvZoom(groupMinRem(groups[1] ?? [], 1, minRem), 40)).toBe(1);
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
    expect(rowMinRem([block({ type: 'momentum', width: 6 }), block({ type: 'comparison', width: 6 })])).toBe(18);
    // The players of a team (14 rows), whatever the template.
    expect(rowMinRem([block({ type: 'momentum', width: 6 }), block({ type: 'players', width: 6 })])).toBe(36);
    expect(rowMinRem([block({ type: 'players', width: 6 })], tvMinRemFor('sir-volley'))).toBe(36);
  });
});

describe('screens of a TV page with long lists (sir-volley, 1920 × 1080: 1 rem = 17.28 px, 40.1 rem under the scoreboard)', () => {
  // Page of a client: aces, blocks and attack in a row, scorers, then the court with the vertical rotations.
  const page = () => [
    block({ type: 'scoreboard', width: 12 }),
    block({ type: 'aces', width: 4 }),
    block({ type: 'blocks', width: 4 }),
    block({ type: 'attack', width: 4 }),
    block({ type: 'setScorers', width: 12 }),
    block({ type: 'court', width: 8 }),
    block({ type: 'rotations', width: 4, options: { orientation: 'vertical' } }),
  ];
  // Heights measured on the real screen with 3 attackers and 5 scorers per team: 21.43, 21.03 and 21.66 rem (vertical
  // rotations). The heights from the options hold them, so the screens are the same with and without data.
  const minRem = tvMinRemFor('sir-volley');

  it('two screens, the first scaled down, from the layout only', () => {
    const tv = page();
    const groups = tvGroups(tv, 40.1, 1, minRem, TV_MAX_SHRINK);
    expect(types(groups)).toEqual([[['aces', 'blocks', 'attack'], ['setScorers']], [['court', 'rotations']]]);
    const first = groups[0] ?? [];
    const needed = 14 + 3 * 2.55 + 1 + 8.5 + 5 * 2.55;
    expect(groupMinRem(first, 1, minRem)).toBeCloseTo(needed, 5);
    expect(tvZoom(groupMinRem(first, 1, minRem), 40.1)).toBeCloseTo(40.1 / needed, 3);
    expect(tvZoom(groupMinRem(groups[1] ?? [], 1, minRem), 40.1)).toBe(1);
  });

  it('without scaling down: three screens', () => {
    expect(types(tvGroups(page(), 40.1, 1, minRem))).toEqual([
      [['aces', 'blocks', 'attack']],
      [['setScorers']],
      [['court', 'rotations']],
    ]);
  });

  it('never makes a screen smaller than TV_MAX_SHRINK: a row too tall for it goes to the next screen', () => {
    // 21.65 + 1 + 21.25 = 43.9 > 36 / 0.85 = 42.4
    expect(types(tvGroups(page(), 36, 1, minRem, TV_MAX_SHRINK))[0]).toEqual([['aces', 'blocks', 'attack']]);
    expect(tvZoom(60, 40.1)).toBe(TV_MAX_SHRINK);
  });
});

describe('tvZoom', () => {
  it('is 1 when the screen fits or there is nothing to measure', () => {
    expect(tvZoom(30, 40)).toBe(1);
    expect(tvZoom(40, 40)).toBe(1);
    expect(tvZoom(30, 0)).toBe(1);
    expect(tvZoom(0, 0)).toBe(1);
  });

  it('scales down in proportion, to the minimum', () => {
    expect(tvZoom(44, 40)).toBeCloseTo(40 / 44, 6);
    expect(tvZoom(100, 40)).toBe(0.85);
  });
});

describe('tvGroups', () => {
  const tv = defaultLayouts.tv;

  it('fits all the rows in one screen when the height is enough', () => {
    expect(types(tvGroups(tv, 100))).toEqual([[['momentum', 'comparison'], ['players'], ['court', 'rotations']]]);
  });

  it('splits the rows in groups by the available height (gaps included)', () => {
    // Rows: 18, 36 (the 14 players of a team), 22 rem; gap 1.
    expect(types(tvGroups(tv, 55))).toEqual([[['momentum', 'comparison'], ['players']], [['court', 'rotations']]]);
    expect(types(tvGroups(tv, 54.9))).toEqual([[['momentum', 'comparison']], [['players']], [['court', 'rotations']]]);
    expect(types(tvGroups(tv, 59))).toEqual([[['momentum', 'comparison'], ['players']], [['court', 'rotations']]]);
    expect(types(tvGroups(tv, 78))).toHaveLength(1);
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

describe('heights of the blocks on the big screen', () => {
  it('come from the type, «Rotazioni» in vertical is taller', () => {
    expect(blockMinRem(block({ type: 'comparison', width: 4 }))).toBe(18);
    expect(blockMinRem(block({ type: 'rotations', width: 4 }))).toBe(14);
    expect(blockMinRem(block({ type: 'rotations', width: 4, options: { orientation: 'vertical' } }))).toBe(22);
  });

  it('the blocks with lists take the height of the rows their options let them show', () => {
    // Measured on the real screen: 3 attackers 21.43 rem, 5 scorers 21.03 rem.
    expect(blockMinRem(block({ type: 'attack', width: 4 }))).toBeGreaterThanOrEqual(21.43);
    expect(blockMinRem(block({ type: 'setScorers', width: 12 }))).toBeGreaterThanOrEqual(21.03);
    const scorers8 = blockMinRem(block({ type: 'setScorers', width: 12, options: { limit: 8 } }));
    expect(scorers8).toBeCloseTo(8.5 + 8 * TV_LIST_ROW_REM, 5);
    expect(blockMinRem(block({ type: 'attack', width: 4, options: { limit: 5 } }))).toBeCloseTo(14 + 5 * 2.55, 5);
    const top10 = blockMinRem(block({ type: 'topPlayers', width: 4, options: { count: 10 } }));
    expect(top10).toBe(32);
    expect(top10).toBeGreaterThan(blockMinRem(block({ type: 'topPlayers', width: 4, options: { count: 5 } })));
    expect(blockMinRem(block({ type: 'standings', width: 4, options: { scope: 'top', count: 16 } }))).toBe(39);
    expect(blockMinRem(block({ type: 'standings', width: 4, options: { scope: 'all' } }))).toBe(39);
    expect(blockMinRem(block({ type: 'standings', width: 4 }))).toBe(20);
    expect(blockMinRem(block({ type: 'players', width: 12 }))).toBe(8 + TV_PLAYERS_ROWS * 2);
  });

  it('a narrow card puts the two lists one under the other: twice the rows', () => {
    // 1920 px at 24 px per rem: 80 rem; 4 columns = 4 × 5.75 + 3 − 2.5 = 23.5 rem of content, under 28.
    expect(tvContentRem(4, 80)).toBeCloseTo(23.5, 5);
    expect(tvContentRem(4, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    const scorers = block({ type: 'setScorers', width: 4, options: { limit: 8 } });
    expect(blockMinRem(scorers, TV_BLOCK_MIN_REM, 80)).toBeCloseTo(8.5 + 16 * TV_LIST_ROW_REM + 1, 5);
    expect(blockMinRem({ ...scorers, width: 12 }, TV_BLOCK_MIN_REM, 80)).toBeCloseTo(8.5 + 8 * TV_LIST_ROW_REM, 5);
  });

  it('the screens follow the options: more scorers push the next row to another screen', () => {
    const tv = [
      block({ type: 'scoreboard', width: 12 }),
      block({ type: 'setScorers', width: 12 }),
      block({ type: 'topPlayers', width: 12 }),
    ];
    expect(tvGroups(tv, 40.1, 1, TV_BLOCK_MIN_REM, TV_MAX_SHRINK)).toHaveLength(1);
    const more = tv.map((b) =>
      b.type === 'setScorers' ? block({ type: 'setScorers', width: 12, options: { limit: 8 } }) : b,
    );
    const long = more.map((b) =>
      b.type === 'topPlayers' ? block({ type: 'topPlayers', width: 12, options: { count: 10 } }) : b,
    );
    expect(tvGroups(long, 40.1, 1, TV_BLOCK_MIN_REM, TV_MAX_SHRINK)).toHaveLength(2);
  });
});
