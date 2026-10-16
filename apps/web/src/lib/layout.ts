/**
 * Layout of the match page as a list of blocks, one list per device (pure functions, no DOM). The shape of the
 * blocks, their widths on 12 columns and the defaults are the contract of @sir/shared (`TenantLayoutSchema`): the
 * client chooses them in the page «Pagina pubblica» of the reserved area.
 */
import type { BlockType, LayoutBlock, LayoutDevice, TemplateId, TenantLayout } from '@sir/shared';
import { defaultDeviceBlocks, LAYOUT_COLUMNS, TEMPLATE_IDS } from '@sir/shared';

export type { BlockType, LayoutBlock };

/** Device class of the screen: big screen 16:9, tablet (2 columns), smartphone (1 column). */
export type Device = LayoutDevice;

/**
 * Breakpoints of the graphic specifications (CSS px of the viewport): smartphone up to 767, tablet portrait 768-899,
 * tablet landscape 900-1199, desktop from 1200.
 */
export const TABLET_MIN_WIDTH = 768;
export const TABLET_LANDSCAPE_MIN_WIDTH = 900;
export const DESKTOP_MIN_WIDTH = 1200;
/** Smartphone held sideways: landscape and at most this high (667 × 375, 844 × 390, 932 × 430). */
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;
/** Narrowest phone held sideways laid out as a tablet (horizontal scoreboard); narrower stays a phone. */
export const PHONE_LANDSCAPE_MIN_WIDTH = 560;
/** Big screen chosen by itself: at least this wide and this high (CSS px), and at least 16:10 (TV, not a monitor). */
export const TV_MIN_WIDTH = 1600;
export const TV_MIN_HEIGHT = 800;
export const TV_MIN_ASPECT = 16 / 10;

/** Class of the viewport, from the breakpoints of the specifications. */
export type ViewportClass = 'phone' | 'phoneLandscape' | 'tabletPortrait' | 'tabletLandscape' | 'desktop';

export function viewportClass({ width, height }: Viewport): ViewportClass {
  if (width > height && height <= PHONE_LANDSCAPE_MAX_HEIGHT && width < DESKTOP_MIN_WIDTH) return 'phoneLandscape';
  if (width < TABLET_MIN_WIDTH) return 'phone';
  if (width < TABLET_LANDSCAPE_MIN_WIDTH) return 'tabletPortrait';
  if (width < DESKTOP_MIN_WIDTH) return 'tabletLandscape';
  return 'desktop';
}

/** `?tv=` of the URL: `on` (`?tv=1`) forces the big screen, `off` (`?tv=0`) excludes it, `auto` otherwise. */
export type TvMode = 'auto' | 'on' | 'off';

export function tvModeOf(param: string | null): TvMode {
  if (param === '1') return 'on';
  if (param === '0') return 'off';
  return 'auto';
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Device for the viewport. Phone up to 767 px; a phone held sideways is laid out as a tablet (horizontal scoreboard,
 * sizes of the low screens in the CSS) when at least 560 px wide; tablet (portrait and landscape) and desktop share the
 * tablet blocks, the grid adapts its columns to the width. Big screen: forced with `?tv=1`; with `auto` when the
 * viewport is ≥ 1600 × 800 px and at least 16:10, or in full screen on a tablet or a desktop (never on a phone, also
 * held sideways); never with `?tv=0`.
 */
export function deviceFor(viewport: Viewport, tv: TvMode = 'auto', fullscreen = false): Device {
  const { width, height } = viewport;
  const kind = viewportClass(viewport);
  const phone = kind === 'phone' || (kind === 'phoneLandscape' && width < PHONE_LANDSCAPE_MIN_WIDTH);
  const base: Device = phone ? 'phone' : 'tablet';
  if (tv === 'on') return 'tv';
  if (tv === 'off') return base;
  const big = width >= TV_MIN_WIDTH && height >= TV_MIN_HEIGHT && width >= height * TV_MIN_ASPECT;
  if (big || (fullscreen && base === 'tablet' && kind !== 'phoneLandscape')) return 'tv';
  return base;
}

const layoutsOf = (template: TemplateId): Record<Device, readonly LayoutBlock[]> => ({
  tv: defaultDeviceBlocks('tv', template),
  tablet: defaultDeviceBlocks('tablet', template),
  phone: defaultDeviceBlocks('phone', template),
});

/** Default order of the blocks, from the most important; the scoreboard always first (from the shared contract). */
export const defaultLayouts: Record<Device, readonly LayoutBlock[]> = layoutsOf('standard');

/** Default blocks of every template, for every device. */
export const templateLayouts: Record<TemplateId, Record<Device, readonly LayoutBlock[]>> = Object.fromEntries(
  TEMPLATE_IDS.map((t) => [t, layoutsOf(t)]),
) as Record<TemplateId, Record<Device, readonly LayoutBlock[]>>;

/**
 * Blocks shown on `device`: the visible ones of the layout of the client, or without a layout the default page of
 * the template.
 */
export function blocksFor(
  layout: TenantLayout | null | undefined,
  device: Device,
  template: TemplateId = 'standard',
): readonly LayoutBlock[] {
  return (layout ? layout[device] : templateLayouts[template][device]).filter((b) => b.visible);
}

/**
 * Widths of the grid (CSS px, container query on the grid: the preview of the editor behaves as the real screen) at
 * which the tablet landscape (viewport ≥ 900 px) and the desktop (viewport ≥ 1200 px) layouts start: the viewport less
 * the side padding of the page.
 */
export const GRID_LANDSCAPE_MIN_PX = 856;
export const GRID_DESKTOP_MIN_PX = 1150;

/** Desktop columns of a block, written out for Tailwind (see `tabletSpan`). */
const DESKTOP_SPAN: readonly string[] = [
  '@min-[1150px]:col-span-12',
  '@min-[1150px]:col-span-1',
  '@min-[1150px]:col-span-2',
  '@min-[1150px]:col-span-3',
  '@min-[1150px]:col-span-4',
  '@min-[1150px]:col-span-5',
  '@min-[1150px]:col-span-6',
  '@min-[1150px]:col-span-7',
  '@min-[1150px]:col-span-8',
  '@min-[1150px]:col-span-9',
  '@min-[1150px]:col-span-10',
  '@min-[1150px]:col-span-11',
  '@min-[1150px]:col-span-12',
];

/**
 * Classes of a block in the grid of the tablet and of the desktop, from the breakpoints of the specifications. Tablet
 * portrait: one column. Tablet landscape: the wide blocks (8 columns and more) full width, the others half (two cards
 * side by side, the grid fills the holes). Desktop: the width chosen for the block.
 */
export function tabletSpan(width: number): string {
  const columns = Math.min(LAYOUT_COLUMNS, Math.max(1, width));
  const landscape = columns >= 8 ? '@min-[856px]:col-span-12' : '@min-[856px]:col-span-6';
  return `col-span-12 ${landscape} ${DESKTOP_SPAN[columns] ?? '@min-[1150px]:col-span-12'}`;
}

/** Classes of the grid itself: in the tablet landscape range it fills the holes left by a full width block. */
export const TABLET_GRID_FLOW = '@min-[856px]:grid-flow-row-dense @min-[1150px]:grid-flow-row';

/**
 * Smallest height of a block on the big screen, in rem (the TV text scales with the screen, so do these). Below it the
 * block is not readable and goes to another group.
 */
export const TV_BLOCK_MIN_REM: Record<BlockType, number> = {
  scoreboard: 0,
  momentum: 16,
  comparison: 18,
  players: 22,
  court: 22,
  rotations: 14,
  logo: 6,
  sponsor: 8,
  message: 6,
  qr: 14,
  lastPoint: 6,
  setScores: 6,
  topPlayers: 14,
};

/**
 * Smallest heights of the templates with their own (smaller text on the big screen, see `--sir-tv-font-size`): with
 * «SIR VOLLEY» the default page of the mockup (two rows under the scoreboard) fits one 16:9 screen.
 */
const TEMPLATE_TV_BLOCK_MIN_REM: Partial<Record<TemplateId, Record<BlockType, number>>> = {
  'sir-volley': { ...TV_BLOCK_MIN_REM, momentum: 14, comparison: 18, players: 16, court: 18, rotations: 14 },
};

/** Smallest heights of the blocks on the big screen for a template. */
export function tvMinRemFor(template: TemplateId): Record<BlockType, number> {
  return TEMPLATE_TV_BLOCK_MIN_REM[template] ?? TV_BLOCK_MIN_REM;
}

/** Blocks side by side on the big screen. */
export type LayoutRow = LayoutBlock[];
/** Rows shown together on the big screen (one screen of the rotation). */
export type LayoutGroup = LayoutRow[];

/** Blocks in rows, in order: a block that does not fit in the columns left starts a new row. */
export function packRows(blocks: readonly LayoutBlock[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let row: LayoutRow = [];
  let used = 0;
  for (const block of blocks) {
    const columns = Math.min(LAYOUT_COLUMNS, Math.max(1, block.width));
    if (row.length > 0 && used + columns > LAYOUT_COLUMNS) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(block);
    used += columns;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Height of a row: the tallest of its blocks. */
export function rowMinRem(row: LayoutRow, minRem: Record<BlockType, number> = TV_BLOCK_MIN_REM): number {
  return Math.max(0, ...row.map((b) => minRem[b.type]));
}

/**
 * Groups of the big screen: the blocks under the scoreboard in rows, and the rows in groups that fit `availableRem`
 * (height under the scoreboard, `gapRem` between rows). A row taller than the space is a group on its own; the first
 * group holds the most important blocks (shown fixed with reduced motion).
 */
export function tvGroups(
  blocks: readonly LayoutBlock[],
  availableRem: number,
  gapRem = 1,
  minRem: Record<BlockType, number> = TV_BLOCK_MIN_REM,
): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  let group: LayoutGroup = [];
  let used = 0;
  for (const row of packRows(blocks.filter((b) => b.type !== 'scoreboard'))) {
    const height = rowMinRem(row, minRem);
    const needed = group.length === 0 ? height : used + gapRem + height;
    if (group.length > 0 && needed > availableRem) {
      groups.push(group);
      group = [row];
      used = height;
    } else {
      group.push(row);
      used = needed;
    }
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

/** Seconds every group stays on the big screen. */
export const TV_ROTATION_MS = 12_000;

/** Group on screen at `tick` (counted from the start of the rotation); always 0 with one group or reduced motion. */
export function rotationIndex(tick: number, groups: number, reducedMotion: boolean): number {
  if (groups <= 1 || reducedMotion) return 0;
  return ((tick % groups) + groups) % groups;
}
