/**
 * Layout of the match page as a list of blocks, one list per device (pure functions, no DOM). The shape of the
 * blocks, their widths on 12 columns and the defaults are the contract of @arenalive/shared (`TenantLayoutSchema`): the
 * client chooses them in the page «Pagina pubblica» of the reserved area.
 */
import type { BlockType, LayoutBlock, LayoutDevice, TemplateId, TenantLayout } from '@arenalive/shared';
import {
  defaultDeviceBlocks,
  LAYOUT_COLUMNS,
  STANDINGS_AROUND,
  STANDINGS_MAX_ROWS,
  TEMPLATE_IDS,
  TEMPLATES,
} from '@arenalive/shared';

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
 * Smallest height of a block on the big screen, in rem (the TV text scales with the screen, so do these); the blocks
 * with lists need more, from their options (`blockMinRem`). The screens are made only from these heights and from the
 * layout, never from the content of the moment: an empty block takes the cell it will have with the data, and the
 * screens do not change when the first data arrive.
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
  setScorers: 14,
  aces: 12,
  blocks: 12,
  attack: 14,
  roleDuel: 16,
  teamDuel: 16,
  nextMatch: 14,
  standings: 20,
};

/** Smallest heights of the blocks on the big screen for a template. */
export function tvMinRemFor(template: TemplateId): Record<BlockType, number> {
  const own = TEMPLATES[template].tvMinRem;
  return own ? { ...TV_BLOCK_MIN_REM, ...own } : TV_BLOCK_MIN_REM;
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

/** «Rotazioni» with the charts one above the other: they need about the height of two. */
export const TV_ROTATIONS_VERTICAL_REM = 22;

/**
 * Heights (rem) of the parts of the blocks with lists, measured on the big screen (1920 × 1080): with them the height of
 * a block comes from its options (rows chosen), the most it can show, and never from the data of the moment.
 * - player lists of «Parziale e marcatori» and «Attacco» (`PlayerList`): a row, and what stays above the lists;
 *   the two lists are side by side from `TV_LISTS_SIDE_BY_SIDE_REM` of content, one under the other below;
 * - «Migliori giocatori» and «Classifica»: a row of the table and the rest of the card;
 * - «Statistiche giocatori»: a row, the rest of the card and the rows of a team (`TV_PLAYERS_ROWS`, the 14 players of a
 *   match sheet), whatever height the template gives the table.
 */
export const TV_LIST_ROW_REM = 2.55;
export const TV_LISTS_SIDE_BY_SIDE_REM = 28;
const TV_SCORERS_BASE_REM = 8.5;
const TV_ATTACK_BASE_REM = 14;
const TV_TABLE_BASE_REM = 7;
const TV_TOP_PLAYERS_ROW_REM = 2.5;
const TV_STANDINGS_ROW_REM = 2;
const TV_PLAYERS_BASE_REM = 8;
const TV_PLAYERS_ROW_REM = 2;
export const TV_PLAYERS_ROWS = 14;
/** Horizontal padding of a card and gap between the columns of the grid of the big screen (rem). */
const TV_CARD_PADDING_REM = 2.5;
const TV_COLUMN_GAP_REM = 1;

/** Width of the content of a card of `columns` columns in an area `widthRem` wide (Infinity: not known). */
export function tvContentRem(columns: number, widthRem: number): number {
  if (!Number.isFinite(widthRem) || widthRem <= 0) return Number.POSITIVE_INFINITY;
  const column = (widthRem - (LAYOUT_COLUMNS - 1) * TV_COLUMN_GAP_REM) / LAYOUT_COLUMNS;
  return columns * column + (columns - 1) * TV_COLUMN_GAP_REM - TV_CARD_PADDING_REM;
}

/** The two player lists of a block: `rows` each, side by side or one under the other (with their gap). */
const listsRem = (rows: number, sideBySide: boolean): number =>
  sideBySide ? rows * TV_LIST_ROW_REM : 2 * rows * TV_LIST_ROW_REM + 1;

/** Height a block needs for what its options let it show (0 for the blocks without lists). */
function contentRem(block: LayoutBlock, widthRem: number): number {
  const sideBySide = tvContentRem(block.width, widthRem) >= TV_LISTS_SIDE_BY_SIDE_REM;
  switch (block.type) {
    case 'rotations':
      return block.options.orientation === 'vertical' ? TV_ROTATIONS_VERTICAL_REM : 0;
    case 'setScorers':
      return TV_SCORERS_BASE_REM + listsRem(block.options.limit, sideBySide);
    case 'attack':
      return TV_ATTACK_BASE_REM + listsRem(block.options.limit, sideBySide);
    case 'topPlayers':
      return TV_TABLE_BASE_REM + block.options.count * TV_TOP_PLAYERS_ROW_REM;
    case 'standings': {
      const rows =
        block.options.scope === 'top'
          ? block.options.count
          : block.options.scope === 'around'
            ? 2 * STANDINGS_AROUND + 1
            : STANDINGS_MAX_ROWS;
      return TV_TABLE_BASE_REM + rows * TV_STANDINGS_ROW_REM;
    }
    case 'players':
      return TV_PLAYERS_BASE_REM + TV_PLAYERS_ROWS * TV_PLAYERS_ROW_REM;
    default:
      return 0;
  }
}

/**
 * Height of a block on the big screen: the one of its type, or more when its options let it show more rows (lists of
 * scorers and attackers, best players, standings, the players of a team, «Rotazioni» in vertical). `widthRem`: width of
 * the area of the blocks (the two lists of a narrow card go one under the other).
 */
export function blockMinRem(
  block: LayoutBlock,
  minRem: Record<BlockType, number> = TV_BLOCK_MIN_REM,
  widthRem = Number.POSITIVE_INFINITY,
): number {
  return Math.max(minRem[block.type], contentRem(block, widthRem));
}

/** Height of a row: the tallest of its blocks. */
export function rowMinRem(
  row: LayoutRow,
  minRem: Record<BlockType, number> = TV_BLOCK_MIN_REM,
  widthRem = Number.POSITIVE_INFINITY,
): number {
  return Math.max(0, ...row.map((b) => blockMinRem(b, minRem, widthRem)));
}

/**
 * Smallest scale (CSS `zoom`) the big screen gives the blocks of a screen to make one more row fit instead of
 * starting another screen: text and spaces are at most 15 % smaller.
 */
export const TV_MAX_SHRINK = 0.85;

/** Height of a group of rows, in rem (the rows and the `gapRem` between them). */
export function groupMinRem(
  group: LayoutGroup,
  gapRem = 1,
  minRem: Record<BlockType, number> = TV_BLOCK_MIN_REM,
  widthRem = Number.POSITIVE_INFINITY,
): number {
  return group.reduce((sum, row, i) => sum + (i > 0 ? gapRem : 0) + rowMinRem(row, minRem, widthRem), 0);
}

/** Pure: scale of a group of `neededRem` in `availableRem`: 1 when it fits, never below `maxShrink`. */
export function tvZoom(neededRem: number, availableRem: number, maxShrink = TV_MAX_SHRINK): number {
  if (!(neededRem > availableRem) || !(availableRem > 0)) return 1;
  return Math.max(maxShrink, availableRem / neededRem);
}

/**
 * Groups of the big screen: the blocks under the scoreboard in rows, and the rows in groups that fit `availableRem`
 * (height under the scoreboard, `gapRem` between rows). A row taller than the space is a group on its own; the first
 * group holds the most important blocks (shown fixed with reduced motion). Only the layout and the heights of the
 * types count, never the content of the moment (see `TV_BLOCK_MIN_REM`). `maxShrink` (default 1: none): a group may need up
 * to `availableRem / maxShrink`, the screen then shows it scaled down (`tvZoom`). `widthRem`: width of the area (see
 * `blockMinRem`).
 */
export function tvGroups(
  blocks: readonly LayoutBlock[],
  availableRem: number,
  gapRem = 1,
  minRem: Record<BlockType, number> = TV_BLOCK_MIN_REM,
  maxShrink = 1,
  widthRem = Number.POSITIVE_INFINITY,
): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  let group: LayoutGroup = [];
  let used = 0;
  const room = availableRem / Math.min(1, Math.max(0.1, maxShrink));
  for (const row of packRows(blocks.filter((b) => b.type !== 'scoreboard'))) {
    const height = rowMinRem(row, minRem, widthRem);
    const needed = group.length === 0 ? height : used + gapRem + height;
    if (group.length > 0 && needed > room) {
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
