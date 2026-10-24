import type { ReactNode } from 'react';
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { largestFit } from './SlideFit.tsx';

/** Smallest scale of the content of a card (with or without lists); below it the lists lose rows (shown as «+N»). */
export const FIT_MIN_SCALE = 0.5;

/**
 * Rows each list inside a `FitToBox` may show (null: all). Set by the box only when the content does not fit even at
 * `FIT_MIN_SCALE`; the lists read it with `useFitRows`.
 */
export const FitRowsContext = createContext<number | null>(null);

/**
 * Pure: how many of `count` rows a list shows with the limit of its box, and how many it leaves out (shown as «+N»).
 */
export function fitRows(count: number, limit: number | null): { shown: number; hidden: number } {
  if (limit === null || count <= limit) return { shown: count, hidden: 0 };
  const shown = Math.max(1, limit);
  return { shown, hidden: count - shown };
}

/**
 * Pure: the rows shown of a list of `count` when only `shown` fit, kept around the row `anchor` (our team in the
 * standings: always visible, the rows farthest from it go first); without an anchor (-1) the first ones. `start`/`end`:
 * the indexes shown (end excluded); `above`/`below`: the rows left out before and after them.
 */
export function rowsAround(
  count: number,
  shown: number,
  anchor: number,
): { start: number; end: number; above: number; below: number } {
  const n = Math.min(count, Math.max(1, shown));
  if (anchor < 0 || anchor >= count) return { start: 0, end: n, above: 0, below: count - n };
  // Centred on the anchor, moved back inside the list at its ends.
  const start = Math.max(0, Math.min(anchor - Math.floor((n - 1) / 2), count - n));
  return { start, end: start + n, above: start, below: count - start - n };
}

/** The rows of a list of `count` that fit its box (see `fitRows`). */
export function useFitRows(count: number): { shown: number; hidden: number } {
  return fitRows(count, useContext(FitRowsContext));
}

/**
 * The rows of a list of `count` that fit its box, for a component that renders its card itself (the hook there would
 * read the context outside the box): `children` gets `useFitRows(count)`.
 */
export function FitRows({
  count,
  children,
}: {
  count: number;
  children: (fit: { shown: number; hidden: number }) => ReactNode;
}) {
  return children(useFitRows(count));
}

/**
 * Cell of a screen (big screen, or a device without touch): the cards inside have a fixed height and fit their
 * content in it (`FitToBox`) instead of scrolling.
 */
export const FitCellContext = createContext(false);

/** Rows of the longest list inside `root` (`data-fit-list` = rows of the list before the limit), 0 without lists. */
function longestList(root: HTMLElement): number {
  let rows = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-fit-list]'))
    rows = Math.max(rows, Number(el.dataset.fitList) || 0);
  return rows;
}

/**
 * Content that never scrolls: when taller (or wider) than its box it is scaled down (CSS transform, laid out in
 * `size / scale` of room so that its own `h-full` parts still fill it) down to `FIT_MIN_SCALE`; when the height is still
 * missing the lists inside (`useFitRows`) show fewer rows and say «+N».
 * Measured again when the box or the content change size; without measures (no layout, e.g. tests) not scaled. No
 * animation of the scale (fine with `prefers-reduced-motion`). The box must have a definite height (cell of a screen).
 */
export function FitToBox({
  children,
  className = '',
  min = FIT_MIN_SCALE,
}: {
  children: ReactNode;
  /** Classes of the content (layout of the body of the card: flex, gap…). */
  className?: string;
  min?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const last = useRef({ width: 0, height: 0, lists: '' });

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    let busy = false;
    const measure = (): void => {
      if (busy) return;
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (width <= 0 || height <= 0) return;
      const lists = [...content.querySelectorAll<HTMLElement>('[data-fit-list]')]
        .map((el) => el.dataset.fitList)
        .join(',');
      const seen = last.current;
      // A new space or new lists: all the rows again, the limit is searched again.
      if (limit !== null && (seen.width !== width || seen.height !== height || seen.lists !== lists)) {
        last.current = { width, height, lists };
        setLimit(null);
        return;
      }
      last.current = { width, height, lists };
      busy = true;
      const fits = (scale: number): boolean => {
        content.style.width = `${width / scale}px`;
        content.style.height = `${height / scale}px`;
        return content.scrollHeight <= content.clientHeight + 1 && content.scrollWidth <= content.clientWidth + 1;
      };
      const scale = largestFit(fits, min, 1);
      // Rows go only when the height is missing (fewer rows do not make the content narrower).
      if (!fits(scale) && content.scrollHeight > content.clientHeight + 1) {
        const rows = limit ?? longestList(content);
        if (rows > 1) {
          // Not even at the smallest scale: one row less in every list, then measured again.
          setLimit(rows - 1);
          requestAnimationFrame(() => {
            busy = false;
          });
          return;
        }
      }
      content.style.width = `${width / scale}px`;
      content.style.height = `${height / scale}px`;
      content.style.transform = scale < 1 ? `scale(${scale})` : '';
      content.dataset.scale = scale.toFixed(3);
      // The observers see the sizes just set: the next frame may measure again.
      requestAnimationFrame(() => {
        busy = false;
      });
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    for (const child of content.children) observer.observe(child);
    return () => observer.disconnect();
  });

  return (
    <div ref={outer} data-fit-box="" className="relative h-full min-h-0 overflow-hidden">
      <div ref={inner} className={`sir-fit absolute inset-0 origin-top-left overflow-hidden ${className}`}>
        <FitRowsContext.Provider value={limit}>{children}</FitRowsContext.Provider>
      </div>
    </div>
  );
}

/** Mark of the rows a list leaves out to fit its box: «+N», with the full sense for the screen readers. */
export function MoreRows({
  hidden,
  of = 'players',
  className = '',
}: {
  hidden: number;
  /** What the rows are: players (lists, tables) or teams (standings). */
  of?: 'players' | 'teams';
  className?: string;
}) {
  if (hidden <= 0) return null;
  const text =
    of === 'teams'
      ? hidden === 1
        ? 'Un’altra squadra non mostrata'
        : `Altre ${hidden} squadre non mostrate`
      : hidden === 1
        ? 'Un altro giocatore non mostrato'
        : `Altri ${hidden} giocatori non mostrati`;
  return (
    <span data-fit-more={hidden} title={text} className={`font-display font-bold text-muted ${className}`}>
      <span aria-hidden="true">+{hidden}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
