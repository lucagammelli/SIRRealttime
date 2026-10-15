/**
 * Layout of the match page as a list of blocks, one list per device (pure functions, no DOM). The shape of the
 * blocks, their widths on 12 columns and the defaults are the contract of @sir/shared (`TenantLayoutSchema`): the
 * client chooses them in the page «Pagina pubblica» of the reserved area.
 */
import type { BlockType, LayoutBlock, LayoutDevice, TenantLayout } from '@sir/shared';
import { defaultDeviceBlocks, LAYOUT_COLUMNS } from '@sir/shared';

export type { BlockType, LayoutBlock };

/** Device class of the screen: big screen 16:9, tablet (2 columns), smartphone (1 column). */
export type Device = LayoutDevice;

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

/** Default order of the blocks, from the most important; the scoreboard always first (from the shared contract). */
export const defaultLayouts: Record<Device, readonly LayoutBlock[]> = {
  tv: defaultDeviceBlocks('tv'),
  tablet: defaultDeviceBlocks('tablet'),
  phone: defaultDeviceBlocks('phone'),
};

/** Blocks shown on `device`: the visible ones of the layout of the client, or the defaults without a layout. */
export function blocksFor(layout: TenantLayout | null | undefined, device: Device): readonly LayoutBlock[] {
  return (layout ? layout[device] : defaultLayouts[device]).filter((b) => b.visible);
}

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
