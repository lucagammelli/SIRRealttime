import type { ReactNode } from 'react';
import { useContext, useMemo, useRef } from 'react';
import { useTemplate } from '../lib/branding.ts';
import type { Device, LayoutBlock } from '../lib/layout.ts';
import {
  groupMinRem,
  rotationIndex,
  rowMinRem,
  screenWidth,
  TABLET_GRID_FLOW,
  tabletSpan,
  TV_ROTATION_MS,
  TV_MAX_SHRINK,
  tvGroups,
  tvMinRemFor,
  tvZoom,
} from '../lib/layout.ts';
import { useReducedMotion } from '../lib/theme.ts';
import {
  DeviceContext,
  LayoutScaleContext,
  rootFontPx,
  useElementSize,
  useTicker,
  useTouch,
} from '../lib/useLayout.ts';
import { FitCellContext } from './FitToBox.tsx';
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
 *   height left; with more than one group they rotate every 12 s (fixed on the first with reduced motion). The groups
 *   and the height of every row come only from the layout and from the heights of the types and of the options
 *   (`TV_BLOCK_MIN_REM`, `blockMinRem`: rows of the lists chosen), never from the content of the moment: an empty block (start of the match) takes the same cell it will have with
 *   the data, and the screens do not change when the data arrive. With touch a card taller than its cell scrolls
 *   inside its body (`index.css`); without touch it never scrolls: its content fits the cell (`FitToBox` in `Card`:
 *   scaled down, then «+N» rows), never cut without a sign.
 * Without touch (option «Touch» of the device) the phone and the tablet are laid out in screens like the big screen
 * (nobody can scroll them): same rotation, the columns of their own grid (`screenWidth`).
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
  const touch = useTouch();
  return (
    <DeviceContext.Provider value={device}>
      {device === 'tv' || !touch ? (
        <TvLayout blocks={blocks} device={device} renderBlock={renderBlock} paused={rotationPaused} touch={touch} />
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
  blocks: given,
  device,
  renderBlock,
  paused,
  touch,
}: {
  blocks: readonly LayoutBlock[];
  device: Device;
  renderBlock: RenderBlock;
  paused: boolean;
  touch: boolean;
}) {
  const area = useRef<HTMLDivElement>(null);
  const scale = useContext(LayoutScaleContext) || 1;
  const size = useElementSize(area);
  const heightPx = size.height / scale;
  // Phone and tablet in screens: the columns their grid gives the blocks (the width of the area, not of the window).
  const gridPx = size.width / scale;
  const blocks = useMemo(
    () =>
      device === 'tv'
        ? given
        : given.map((b) => {
            const width = screenWidth(b.width, device, gridPx);
            return width === b.width ? b : { ...b, width };
          }),
    [given, device, gridPx],
  );
  const reduced = useReducedMotion();
  const scoreboard = blocks.find((b) => b.type === 'scoreboard');
  const template = useTemplate().id;
  const minRem = tvMinRemFor(template);
  const availableRem = heightPx / rootFontPx();
  // Width of the area: a narrow card puts its two player lists one under the other (taller).
  const widthRem = size.width / scale / rootFontPx();
  const groups = useMemo(
    () => tvGroups(blocks, availableRem, TV_GAP_REM, minRem, TV_MAX_SHRINK, widthRem),
    [blocks, availableRem, minRem, widthRem],
  );
  const tick = useTicker(groups.length > 1 && !reduced && !paused, TV_ROTATION_MS);
  const index = rotationIndex(tick, groups.length, reduced);
  const group = groups[index] ?? [];
  // A screen a little taller than the space is shown scaled down (up to 15 %) instead of being split in two. `zoom`
  // keeps the box of the container (it still fills the area) and gives the content `available / zoom` of room: the
  // heights of the rows stay in the same rem.
  const zoom = tvZoom(groupMinRem(group, TV_GAP_REM, minRem, widthRem), availableRem);

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4"
      data-layout={device === 'tv' ? 'tv' : 'screens'}
    >
      {scoreboard && (
        <div className="contents" {...studioAttrs(scoreboard)}>
          {renderBlock(scoreboard, device)}
        </div>
      )}
      <div ref={area} className="relative min-h-0 overflow-hidden" data-tv-area="">
        <div
          key={index}
          className="sir-fade flex h-full min-h-0 flex-col gap-4"
          style={zoom < 1 ? { zoom } : undefined}
        >
          {group.map((row) => (
            // Rows as tall as their smallest height asks (grow in proportion to it), never an equal share.
            <div
              key={row.map((b) => b.id).join('-')}
              className="grid min-h-0 grid-cols-12 gap-4"
              style={{ flex: `${Math.max(1, rowMinRem(row, minRem, widthRem))} 1 0%` }}
            >
              {row.map((block) => (
                <div
                  key={block.id}
                  data-tv-block={block.id}
                  data-touch={touch}
                  {...studioAttrs(block)}
                  className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${span(block)}`}
                >
                  <FitCellContext.Provider value={true}>{renderBlock(block, device)}</FitCellContext.Provider>
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
