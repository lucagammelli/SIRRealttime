import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPES,
  BLOCK_WIDTHS,
  defaultDeviceBlocks,
  defaultLayout,
  DeviceBlocksSchema,
  LAYOUT_DEVICES,
  LAYOUT_MAX_BLOCKS,
  layoutImageIds,
  LayoutBlockSchema,
  newBlock,
  PublicTenantResponseSchema,
  resolveLayout,
  TenantLayoutSchema,
} from './index.js';

const IMG_A = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const IMG_B = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const parseBlock = (block: Record<string, unknown>) => LayoutBlockSchema.safeParse({ id: 'b1', ...block });

describe('layout of the public page', () => {
  it('reads the empty database document as the default page of every device', () => {
    const layout = TenantLayoutSchema.parse({});
    expect(layout).toEqual(defaultLayout());
    expect(layout.version).toBe(1);
    for (const device of LAYOUT_DEVICES) {
      expect(layout[device][0]?.type).toBe('scoreboard');
      expect(layout[device].map((b) => b.type)).toEqual([
        'scoreboard',
        'momentum',
        'comparison',
        'players',
        'court',
        'rotations',
      ]);
      expect(layout[device].every((b) => b.visible)).toBe(true);
    }
    // The widths of the portal of today, on 12 columns: full 12, two thirds 8, half 6, third 4.
    expect(layout.tv.map((b) => b.width)).toEqual([12, 8, 4, 12, 6, 6]);
    expect(layout.tablet.map((b) => b.width)).toEqual([12, 6, 6, 12, 6, 6]);
    expect(layout.phone.map((b) => b.collapsed)).toEqual([false, false, true, true, true, true]);
  });

  it('gives a new default list at every call (no shared state between documents)', () => {
    const a = defaultDeviceBlocks('tv');
    a.pop();
    expect(defaultDeviceBlocks('tv')).toHaveLength(6);
    const b = TenantLayoutSchema.parse({});
    b.tv.pop();
    expect(TenantLayoutSchema.parse({}).tv).toHaveLength(6);
  });

  it('keeps a device missing from the document at its default', () => {
    const layout = TenantLayoutSchema.parse({ phone: [{ id: 's', type: 'scoreboard' }] });
    expect(layout.phone).toHaveLength(1);
    expect(layout.tv).toEqual(defaultDeviceBlocks('tv'));
  });

  it('refuses unknown types, unknown fields, other versions and bad ids', () => {
    expect(parseBlock({ type: 'html' }).success).toBe(false);
    expect(parseBlock({ type: 'message', script: 'x' }).success).toBe(false);
    expect(parseBlock({ type: 'logo', options: { variant: 'main', css: 'x' } }).success).toBe(false);
    expect(LayoutBlockSchema.safeParse({ id: 'a b', type: 'logo' }).success).toBe(false);
    expect(LayoutBlockSchema.safeParse({ id: '', type: 'logo' }).success).toBe(false);
    expect(TenantLayoutSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(TenantLayoutSchema.safeParse({ desktop: [] }).success).toBe(false);
  });

  it('court field modes are optional and validated', () => {
    expect(parseBlock({ type: 'court' }).data?.options).not.toHaveProperty('fieldMode');
    const tri = { fieldMode: 'tricolor', tricolor: ['#009246', '#ffffff', '#ce2b37'] };
    expect(parseBlock({ type: 'court', options: tri }).success).toBe(true);
    expect(parseBlock({ type: 'court', options: { fieldMode: 'single', fieldColor: '#112233' } }).success).toBe(true);
    expect(parseBlock({ type: 'court', options: { fieldMode: 'stripes' } }).success).toBe(false);
    expect(parseBlock({ type: 'court', options: { tricolor: ['#009246', '#ffffff'] } }).success).toBe(false);
  });

  it('fills the options of every type with their defaults', () => {
    for (const type of BLOCK_TYPES) expect(parseBlock({ type }).success).toBe(true);
    expect(parseBlock({ type: 'sponsor' }).data?.options).toEqual({ sponsors: [], images: [], seconds: 8 });
    expect(parseBlock({ type: 'qr' }).data?.options).toEqual({ caption: 'Segui la partita sul telefono' });
    expect(parseBlock({ type: 'topPlayers' }).data?.options).toEqual({ count: 5, team: 'both' });
    expect(parseBlock({ type: 'logo' }).data?.options).toEqual({ variant: 'main' });
    expect(parseBlock({ type: 'rotations' }).data?.options).toEqual({ orientation: 'horizontal' });
    expect(parseBlock({ type: 'rotations', options: { orientation: 'vertical' } }).data?.options).toEqual({
      orientation: 'vertical',
    });
    expect(parseBlock({ type: 'rotations', options: { orientation: 'diagonal' } }).success).toBe(false);
    expect(parseBlock({ type: 'momentum', options: { any: 1 } }).success).toBe(false);
  });

  it('statistics of a period as blocks too (the same options of the slides of the pauses)', () => {
    expect(parseBlock({ type: 'setScorers' }).data?.options).toEqual({ period: 'set', limit: 5 });
    expect(parseBlock({ type: 'aces' }).data?.options).toEqual({ period: 'set' });
    expect(parseBlock({ type: 'blocks', options: { period: 'match' } }).data?.options).toEqual({ period: 'match' });
    expect(parseBlock({ type: 'attack' }).data?.options).toEqual({ period: 'set', limit: 3 });
    expect(parseBlock({ type: 'roleDuel' }).data?.options).toEqual({ period: 'set', role: 'rotate' });
    expect(parseBlock({ type: 'teamDuel' }).data?.options).toEqual({ period: 'set', rows: [] });
    expect(parseBlock({ type: 'attack', options: { limit: 6 } }).success).toBe(false);
  });

  it('«Prossima partita» and «Classifica»: options, widths and limits', () => {
    expect(parseBlock({ type: 'nextMatch' }).data?.options).toEqual({ qr: true });
    expect(parseBlock({ type: 'nextMatch', options: { qr: false } }).data?.options).toEqual({ qr: false });
    expect(parseBlock({ type: 'standings' }).data?.options).toEqual({ scope: 'around', count: 5 });
    expect(parseBlock({ type: 'standings', options: { scope: 'top', count: 8 } }).success).toBe(true);
    expect(parseBlock({ type: 'standings', options: { scope: 'top', count: 2 } }).success).toBe(false);
    expect(parseBlock({ type: 'standings', options: { count: 17 } }).success).toBe(false);
    expect(parseBlock({ type: 'standings', options: { scope: 'metà' } }).success).toBe(false);
    expect(parseBlock({ type: 'nextMatch', options: { extra: 1 } }).success).toBe(false);
    const doc = {
      version: 1,
      tv: [
        { id: 'n', type: 'nextMatch', width: 4 },
        { id: 's', type: 'standings', width: 8 },
      ],
    };
    expect(TenantLayoutSchema.safeParse(doc).success).toBe(true);
    expect(TenantLayoutSchema.safeParse({ ...doc, tv: [{ id: 'n', type: 'nextMatch', width: 3 }] }).success).toBe(
      false,
    );
  });

  it('checks the options of each type: plain texts, image ids, durations and counts within limits', () => {
    expect(parseBlock({ type: 'message', options: { text: '  Forza ragazzi!  ' } }).data?.options).toEqual({
      text: 'Forza ragazzi!',
      size: 'normal',
    });
    expect(parseBlock({ type: 'message', options: { text: '' } }).success).toBe(false);
    expect(parseBlock({ type: 'message', options: { text: 'a\u0000b' } }).success).toBe(false);
    expect(parseBlock({ type: 'message', options: { text: 'riga\nnuova' } }).success).toBe(false);
    expect(parseBlock({ type: 'message', options: { text: 'x'.repeat(281) } }).success).toBe(false);
    expect(parseBlock({ type: 'qr', options: { caption: 'y'.repeat(81) } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: ['../evil.png'] } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: [IMG_A, IMG_A] } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: Array(13).fill(IMG_A) } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: [IMG_A], seconds: 2 } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: [IMG_A], seconds: 61 } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: [IMG_A], seconds: 4.5 } }).success).toBe(false);
    expect(parseBlock({ type: 'sponsor', options: { images: [IMG_A, IMG_B], seconds: 60 } }).success).toBe(true);
    expect(parseBlock({ type: 'topPlayers', options: { count: 0 } }).success).toBe(false);
    expect(parseBlock({ type: 'topPlayers', options: { count: 11 } }).success).toBe(false);
    expect(parseBlock({ type: 'topPlayers', options: { team: 'tutti' } }).success).toBe(false);
    expect(parseBlock({ type: 'logo', options: { variant: 'sponsor' } }).success).toBe(false);
  });

  it('allows only the widths of each type, unique ids, one scoreboard and at most 24 blocks', () => {
    const list = (blocks: Record<string, unknown>[]) => DeviceBlocksSchema.safeParse(blocks);
    expect(list([{ id: 'a', type: 'scoreboard', width: 6 }]).success).toBe(false);
    expect(list([{ id: 'a', type: 'players', width: 4 }]).success).toBe(false);
    expect(list([{ id: 'a', type: 'qr', width: 13 }]).success).toBe(false);
    expect(list([{ id: 'a', type: 'qr', width: 3 }]).success).toBe(true);
    expect(
      list([
        { id: 'a', type: 'qr' },
        { id: 'a', type: 'logo' },
      ]).success,
    ).toBe(false);
    expect(
      list([
        { id: 'a', type: 'scoreboard' },
        { id: 'b', type: 'scoreboard' },
      ]).success,
    ).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, type: 'message' }));
    expect(list(many(LAYOUT_MAX_BLOCKS)).success).toBe(true);
    expect(list(many(LAYOUT_MAX_BLOCKS + 1)).success).toBe(false);
    for (const widths of Object.values(BLOCK_WIDTHS)) expect(widths).toContain(12);
  });

  it('makes new blocks with an allowed width', () => {
    expect(newBlock('players', 'p1', 4).width).toBe(6);
    expect(newBlock('qr', 'q1', 4).width).toBe(4);
    expect(newBlock('scoreboard', 's1', 6).width).toBe(12);
    expect(newBlock('message', 'm1')).toMatchObject({ width: 12, visible: true, options: { size: 'normal' } });
  });

  it('reads an invalid stored document as the defaults and lists the images in use', () => {
    expect(resolveLayout({ tv: [{ id: 'x', type: 'iframe' }] })).toEqual(defaultLayout());
    expect(resolveLayout(null)).toEqual(defaultLayout());
    const layout = TenantLayoutSchema.parse({
      tv: [{ id: 's', type: 'sponsor', options: { images: [IMG_A, IMG_B] } }],
      phone: [{ id: 's', type: 'sponsor', options: { images: [IMG_B] } }],
    });
    expect(layoutImageIds(layout)).toEqual([IMG_A, IMG_B]);
    expect(layoutImageIds(defaultLayout())).toEqual([]);
  });

  it('reaches the portal with the graphics, defaults when an older answer has none', () => {
    const res = PublicTenantResponseSchema.parse({
      name: 'Sir',
      branding: {},
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
    });
    expect(res.layout).toEqual(defaultLayout());
  });

  it('reads the options of the court map: old layouts keep the defaults, colours and thickness are checked', () => {
    const old = parseBlock({ type: 'court' });
    expect(old.success && old.data.options).toEqual({ lineWidth: 1, arrowWidth: 1 });
    const empty = parseBlock({ type: 'court', options: {} });
    expect(empty.success && empty.data.options).toEqual({ lineWidth: 1, arrowWidth: 1 });
    const set = parseBlock({
      type: 'court',
      options: { fieldOurs: '#AABBCC', linesOpponent: '#000000', lineWidth: 2, arrowsOurs: '#ff0000', arrowWidth: 0.5 },
    });
    expect(set.success && set.data.options).toEqual({
      fieldOurs: '#aabbcc',
      linesOpponent: '#000000',
      lineWidth: 2,
      arrowsOurs: '#ff0000',
      arrowWidth: 0.5,
    });
    expect(parseBlock({ type: 'court', options: { fieldOurs: 'red' } }).success).toBe(false);
    expect(parseBlock({ type: 'court', options: { lineWidth: 0.1 } }).success).toBe(false);
    expect(parseBlock({ type: 'court', options: { arrowWidth: 9 } }).success).toBe(false);
    expect(parseBlock({ type: 'court', options: { other: 1 } }).success).toBe(false);
  });
});
