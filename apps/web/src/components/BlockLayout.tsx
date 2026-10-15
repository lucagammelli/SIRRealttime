import type { ReactNode } from 'react';
import { Fragment, useMemo, useRef } from 'react';
import type { BlockWidth, Device, LayoutBlock } from '../lib/layout.ts';
import { rotationIndex, TV_ROTATION_MS, tvGroups } from '../lib/layout.ts';
import { useReducedMotion } from '../lib/theme.ts';
import { DeviceContext, rootFontPx, useElementHeight, useTicker } from '../lib/useLayout.ts';
import { CardCollapseContext } from './ui.tsx';

/** Columns of a block on a 6-column grid (tablet and big screen). */
const SPAN: Record<BlockWidth, string> = {
  full: 'col-span-6',
  twoThirds: 'col-span-4',
  half: 'col-span-3',
  third: 'col-span-2',
};
/** Gap between the rows of the big screen, in rem (`gap-4`). */
const TV_GAP_REM = 1;

export type RenderBlock = (block: LayoutBlock, device: Device) => ReactNode;

/**
 * Lays out the blocks of the match page in the given order for one device:
 * - `phone`: one column, every block but the scoreboard a collapsible section;
 * - `tablet`: two columns (`half`) or full width, scoreboard on top;
 * - `tv`: one 16:9 screen without scrolling, the scoreboard always on top and the other blocks in groups that fit the
 *   height left; with more than one group they rotate every 12 s (fixed on the first with reduced motion).
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
        <div className="flex flex-col gap-3" data-layout="phone">
          {blocks.map((block) =>
            block.type === 'scoreboard' ? (
              <Fragment key={block.type}>{renderBlock(block, device)}</Fragment>
            ) : (
              <CardCollapseContext.Provider
                key={block.type}
                value={{ collapsible: true, defaultOpen: block.collapsed !== true }}
              >
                {renderBlock(block, device)}
              </CardCollapseContext.Provider>
            ),
          )}
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-4" data-layout="tablet">
          {blocks.map((block) => (
            <div key={block.type} className={`flex min-w-0 flex-col ${SPAN[block.width]}`}>
              {renderBlock(block, device)}
            </div>
          ))}
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
  const heightPx = useElementHeight(area);
  const reduced = useReducedMotion();
  const scoreboard = blocks.find((b) => b.type === 'scoreboard');
  const groups = useMemo(() => tvGroups(blocks, heightPx / rootFontPx(), TV_GAP_REM), [blocks, heightPx]);
  const tick = useTicker(groups.length > 1 && !reduced && !paused, TV_ROTATION_MS);
  const index = rotationIndex(tick, groups.length, reduced);
  const group = groups[index] ?? [];

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4" data-layout="tv">
      {scoreboard && renderBlock(scoreboard, 'tv')}
      <div ref={area} className="relative min-h-0 overflow-hidden" data-tv-area="">
        <div key={index} className="sir-fade flex h-full min-h-0 flex-col gap-4">
          {group.map((row) => (
            <div key={row.map((b) => b.type).join('-')} className="grid min-h-0 flex-1 grid-cols-6 gap-4">
              {row.map((block) => (
                <div key={block.type} className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${SPAN[block.width]}`}>
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
                  .map((b) => b.type)
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
