import type { ReactNode } from 'react';
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTemplate } from '../lib/branding.ts';
import type { Device, LayoutBlock } from '../lib/layout.ts';
import type { MeasuredRem } from '../lib/layout.ts';
import {
  raiseMeasured,
  rotationIndex,
  rowMinRem,
  TABLET_GRID_FLOW,
  tabletSpan,
  TV_ROTATION_MS,
  tvGroups,
  tvMinRemFor,
} from '../lib/layout.ts';
import { useReducedMotion } from '../lib/theme.ts';
import { DeviceContext, LayoutScaleContext, rootFontPx, useElementHeight, useTicker } from '../lib/useLayout.ts';
import { CardCollapseContext } from './ui.tsx';

/** Columns of a block on the 12-column grid (tablet and big screen); written out for Tailwind. */
const SPAN: readonly string[] = [
  'col-span-12',
  'col-span-1',
  'col-span-2',
  'col-span-3',
  'col-span-4',
  'col-span-5',
  'col-span-6',
  'col-span-7',
  'col-span-8',
  'col-span-9',
  'col-span-10',
  'col-span-11',
  'col-span-12',
];
const span = (block: LayoutBlock): string => SPAN[block.width] ?? 'col-span-12';
/** Gap between the rows of the big screen, in rem (`gap-4`). */
const TV_GAP_REM = 1;
const NO_MEASURES: MeasuredRem = {};

export type RenderBlock = (block: LayoutBlock, device: Device) => ReactNode;

/**
 * Inert marks of a block (id and type) on its cell: the «Studio grafico» of the reserved area finds the block in its
 * preview with them (highlight, click to open its settings). No style and no behaviour on the public page.
 */
const studioAttrs = (block: LayoutBlock): Record<'data-studio-block' | 'data-studio-type', string> => ({
  'data-studio-block': block.id,
  'data-studio-type': block.type,
});

/**
 * Lays out the blocks of the match page in the given order for one device (the visible ones: see `blocksFor`):
 * - `phone`: one column, every block with a title but the scoreboard a collapsible section;
 * - `tablet`: 12-column grid; on the desktop each block as wide as its `width`, on a tablet in landscape the narrow
 *   blocks half wide and the wide ones full, on a tablet in portrait one column (see `tabletSpan`);
 * - `tv`: one 16:9 screen without scrolling, the scoreboard always on top and the other blocks in groups that fit the
 *   height left; with more than one group they rotate every 12 s (fixed on the first with reduced motion). A block
 *   whose content is taller than its cell is measured and the groups are made again with its real height; a block
 *   taller than the whole screen scrolls inside its card (`index.css`): content is never cut without a sign.
 */
export function BlockLayout({
  blocks,
  device,
  renderBlock,
  rotationPaused = false,
}: {
  blocks: readonly LayoutBlock[];
  device: Device;
  renderBlock: RenderBlock;
  /** Big screen: rotation stopped by the viewer (button «Ferma rotazione», WCAG 2.2.2). */
  rotationPaused?: boolean;
}) {
  return (
    <DeviceContext.Provider value={device}>
      {device === 'tv' ? (
        <TvLayout blocks={blocks} renderBlock={renderBlock} paused={rotationPaused} />
      ) : device === 'phone' ? (
        <div className="sir-blocks flex flex-col gap-3" data-layout="phone">
          {blocks.map((block) =>
            block.type === 'scoreboard' ? (
              <div key={block.id} className="contents" {...studioAttrs(block)}>
                {renderBlock(block, device)}
              </div>
            ) : (
              <div key={block.id} className="contents" {...studioAttrs(block)}>
                <CardCollapseContext.Provider value={{ collapsible: true, defaultOpen: !block.collapsed }}>
                  {renderBlock(block, device)}
                </CardCollapseContext.Provider>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="@container">
          <div className={`sir-blocks grid grid-cols-12 gap-4 ${TABLET_GRID_FLOW}`} data-layout="tablet">
            {blocks.map((block) => (
              <div
                key={block.id}
                className={`flex min-w-0 flex-col ${tabletSpan(block.width)}`}
                {...studioAttrs(block)}
              >
                {renderBlock(block, device)}
              </div>
            ))}
          </div>
        </div>
      )}
    </DeviceContext.Provider>
  );
}

function TvLayout({
  blocks,
  renderBlock,
  paused,
}: {
  blocks: readonly LayoutBlock[];
  renderBlock: RenderBlock;
  paused: boolean;
}) {
  const area = useRef<HTMLDivElement>(null);
  const heightPx = useElementHeight(area) / (useContext(LayoutScaleContext) || 1);
  const reduced = useReducedMotion();
  const scoreboard = blocks.find((b) => b.type === 'scoreboard');
  const template = useTemplate().id;
  const minRem = tvMinRemFor(template);
  // Real heights of the blocks, measured on this screen: forgotten when the blocks or the height of the screen change.
  const measureKey = `${template}|${Math.round(heightPx)}|${blocks.map((b) => `${b.id}:${b.width}`).join(',')}`;
  const [measures, setMeasures] = useState<{ key: string; rem: MeasuredRem }>({ key: '', rem: {} });
  const measured = measures.key === measureKey ? measures.rem : NO_MEASURES;
  const groups = useMemo(
    () => tvGroups(blocks, heightPx / rootFontPx(), TV_GAP_REM, minRem, measured),
    [blocks, heightPx, minRem, measured],
  );
  const tick = useTicker(groups.length > 1 && !reduced && !paused, TV_ROTATION_MS);
  const index = rotationIndex(tick, groups.length, reduced);
  const group = groups[index] ?? [];
  const shown = useRef<HTMLDivElement>(null);

  // After every render: a block whose content overflows its cell (the cell, or the body of its card) needs that much
  // more; the groups are made again with it. Only raises, so it settles in a few renders.
  useLayoutEffect(() => {
    const root = shown.current;
    if (!root || heightPx <= 0) return;
    const rem = rootFontPx();
    const found: Record<string, number> = {};
    for (const cell of root.querySelectorAll<HTMLElement>('[data-tv-block]')) {
      const id = cell.dataset.tvBlock;
      if (!id) continue;
      let overflow = cell.scrollHeight - cell.clientHeight;
      for (const body of cell.querySelectorAll<HTMLElement>('.sir-card-body'))
        overflow = Math.max(overflow, body.scrollHeight - body.clientHeight);
      if (overflow > 2) found[id] = (cell.clientHeight + overflow) / rem + 0.25;
    }
    setMeasures((m) => {
      const known = m.key === measureKey ? m.rem : NO_MEASURES;
      const next = raiseMeasured(known, found);
      return next === known && m.key === measureKey ? m : { key: measureKey, rem: next };
    });
  });

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4" data-layout="tv">
      {scoreboard && (
        <div className="contents" {...studioAttrs(scoreboard)}>
          {renderBlock(scoreboard, 'tv')}
        </div>
      )}
      <div ref={area} className="relative min-h-0 overflow-hidden" data-tv-area="">
        <div key={index} ref={shown} className="sir-fade flex h-full min-h-0 flex-col gap-4">
          {group.map((row) => (
            // Rows as tall as their smallest height asks (grow in proportion to it), never an equal share.
            <div
              key={row.map((b) => b.id).join('-')}
              className="grid min-h-0 grid-cols-12 gap-4"
              style={{ flex: `${Math.max(1, rowMinRem(row, minRem, measured))} 1 0%` }}
            >
              {row.map((block) => (
                <div
                  key={block.id}
                  data-tv-block={block.id}
                  {...studioAttrs(block)}
                  className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${span(block)}`}
                >
                  {renderBlock(block, 'tv')}
                </div>
              ))}
            </div>
          ))}
        </div>
        {groups.length > 1 && !reduced && (
          <div
            role="img"
            aria-label={`Schermata ${index + 1} di ${groups.length}`}
            className="pointer-events-none absolute bottom-2 right-3 flex gap-1.5"
          >
            {groups.map((g, i) => (
              <span
                key={g
                  .flat()
                  .map((b) => b.id)
                  .join('-')}
                className={`inline-block h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                  i === index ? 'w-6 bg-primary' : 'w-1.5 bg-axis'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
