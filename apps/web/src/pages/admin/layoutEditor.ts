import type { BlockType, LayoutBlock, LayoutDevice, TenantLayout } from '@sir/shared';
import { defaultDeviceBlocks, LAYOUT_MAX_BLOCKS, newBlock, TenantLayoutSchema } from '@sir/shared';

/** Pure editing of the blocks of one device (editor «Pagina pubblica»): every function returns a new layout. */

const withBlocks = (layout: TenantLayout, device: LayoutDevice, blocks: LayoutBlock[]): TenantLayout => ({
  ...layout,
  [device]: blocks,
});

/** Moves the block at `from` to the position `to` (clamped to the list). */
export function moveBlock(layout: TenantLayout, device: LayoutDevice, from: number, to: number): TenantLayout {
  const blocks = [...layout[device]];
  const target = Math.max(0, Math.min(blocks.length - 1, to));
  const [moved] = blocks.splice(from, 1);
  if (!moved || from === target) return layout;
  blocks.splice(target, 0, moved);
  return withBlocks(layout, device, blocks);
}

/** Changes the block with `id` (its type stays the same). */
export function updateBlock(
  layout: TenantLayout,
  device: LayoutDevice,
  id: string,
  change: (block: LayoutBlock) => LayoutBlock,
): TenantLayout {
  return withBlocks(
    layout,
    device,
    layout[device].map((b) => (b.id === id ? change(b) : b)),
  );
}

export function removeBlock(layout: TenantLayout, device: LayoutDevice, id: string): TenantLayout {
  return withBlocks(
    layout,
    device,
    layout[device].filter((b) => b.id !== id),
  );
}

/** First free id `<type>-<n>` in the list of the device. */
export function freeId(blocks: readonly LayoutBlock[], type: BlockType): string {
  const used = new Set(blocks.map((b) => b.id));
  if (!used.has(type)) return type;
  for (let n = 2; ; n++) if (!used.has(`${type}-${n}`)) return `${type}-${n}`;
}

/** Whether a block of `type` can still be added (list not full, one scoreboard only). */
export function canAdd(blocks: readonly LayoutBlock[], type: BlockType): boolean {
  if (blocks.length >= LAYOUT_MAX_BLOCKS) return false;
  return type !== 'scoreboard' || !blocks.some((b) => b.type === 'scoreboard');
}

/** Adds a block of `type` at the end, with its default options (half width when allowed, full on the phone). */
export function addBlock(layout: TenantLayout, device: LayoutDevice, type: BlockType): TenantLayout {
  const blocks = layout[device];
  if (!canAdd(blocks, type)) return layout;
  const block = newBlock(type, freeId(blocks, type), device === 'phone' ? 12 : 6);
  return withBlocks(layout, device, [...blocks, block]);
}

/** Back to the default blocks of the device (the other devices stay as they are). */
export function resetDevice(layout: TenantLayout, device: LayoutDevice): TenantLayout {
  return withBlocks(layout, device, defaultDeviceBlocks(device));
}

/** Ids of the blocks with a problem (empty text, ...), by device; empty when the layout can be saved. */
export function layoutProblems(layout: TenantLayout): Partial<Record<LayoutDevice, Set<string>>> {
  const parsed = TenantLayoutSchema.safeParse(layout);
  if (parsed.success) return {};
  const out: Partial<Record<LayoutDevice, Set<string>>> = {};
  for (const issue of parsed.error.issues) {
    const [device, index] = issue.path;
    if (device !== 'tv' && device !== 'tablet' && device !== 'phone') continue;
    const set = (out[device] ??= new Set());
    const block = typeof index === 'number' ? layout[device][index] : undefined;
    set.add(block?.id ?? '');
  }
  return out;
}
