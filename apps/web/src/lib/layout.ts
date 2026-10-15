/**
 * Layout of the match page as a list of blocks, one list per device (pure functions, no DOM).
 * Today the lists are the defaults below; the block editor of the reserved area will produce the same shape.
 */

/** Device class of the screen: big screen 16:9, tablet (2 columns), smartphone (1 column). */
export type Device = 'tv' | 'tablet' | 'phone';

/** Smallest width (CSS px) of a tablet: below it the page is a phone. */
export const TABLET_MIN_WIDTH = 700;
/** Big screen chosen by itself: at least this wide and this high (CSS px), and at least 16:10 (TV, not a monitor). */
export const TV_MIN_WIDTH = 1600;
export const TV_MIN_HEIGHT = 800;
export const TV_MIN_ASPECT = 16 / 10;

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
 * Device for the viewport. Big screen: forced with `?tv=1`; with `auto` when the viewport is ≥ 1600 × 800 px and at
 * least 16:10, or in full screen from tablet width up (never on a phone); never with `?tv=0`.
 */
export function deviceFor({ width, height }: Viewport, tv: TvMode = 'auto', fullscreen = false): Device {
  const base: Device = width >= TABLET_MIN_WIDTH ? 'tablet' : 'phone';
  if (tv === 'on') return 'tv';
  if (tv === 'off') return base;
  const big = width >= TV_MIN_WIDTH && height >= TV_MIN_HEIGHT && width >= height * TV_MIN_ASPECT;
  if (big || (fullscreen && base === 'tablet')) return 'tv';
  return base;
}

/** Blocks of the match page. */
export const BLOCK_TYPES = ['scoreboard', 'momentum', 'comparison', 'players', 'court', 'rotations'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Share of the row taken by a block (on the phone every block is full width). */
export type BlockWidth = 'full' | 'twoThirds' | 'half' | 'third';
export const WIDTH_SHARE: Record<BlockWidth, number> = { full: 1, twoThirds: 2 / 3, half: 1 / 2, third: 1 / 3 };

export interface LayoutBlock {
  type: BlockType;
  width: BlockWidth;
  /** Phone only: the section starts closed. */
  collapsed?: boolean;
}

/** Default order of the blocks, from the most important; the scoreboard always first. */
export const defaultLayouts: Record<Device, readonly LayoutBlock[]> = {
  tv: [
    { type: 'scoreboard', width: 'full' },
    { type: 'momentum', width: 'twoThirds' },
    { type: 'comparison', width: 'third' },
    { type: 'players', width: 'full' },
    { type: 'court', width: 'half' },
    { type: 'rotations', width: 'half' },
  ],
  tablet: [
    { type: 'scoreboard', width: 'full' },
    { type: 'momentum', width: 'half' },
    { type: 'comparison', width: 'half' },
    { type: 'players', width: 'full' },
    { type: 'court', width: 'half' },
    { type: 'rotations', width: 'half' },
  ],
  phone: [
    { type: 'scoreboard', width: 'full' },
    { type: 'momentum', width: 'full' },
    { type: 'comparison', width: 'full', collapsed: true },
    { type: 'players', width: 'full', collapsed: true },
    { type: 'court', width: 'full', collapsed: true },
    { type: 'rotations', width: 'full', collapsed: true },
  ],
};

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
};

/** Blocks side by side on the big screen. */
export type LayoutRow = LayoutBlock[];
/** Rows shown together on the big screen (one screen of the rotation). */
export type LayoutGroup = LayoutRow[];

/** Blocks in rows, in order: a block that does not fit in the width left starts a new row. */
export function packRows(blocks: readonly LayoutBlock[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let row: LayoutRow = [];
  let used = 0;
  for (const block of blocks) {
    const share = WIDTH_SHARE[block.width];
    // Tolerance: three thirds or 2/3 + 1/3 are a full row despite the floating point.
    if (row.length > 0 && used + share > 1 + 1e-9) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(block);
    used += share;
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
