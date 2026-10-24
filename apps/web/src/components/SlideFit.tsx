import type { IntermissionFullscreenSize } from '@arenalive/shared';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useTouch } from '../lib/useLayout.ts';

/** Limits of the scale of a slide for every size but `normal` (as designed: no scale). */
export const FIT_LIMITS: Record<Exclude<IntermissionFullscreenSize, 'normal'>, { min: number; max: number }> = {
  large: { min: 1, max: 1.5 },
  fill: { min: 0.4, max: 4 },
};
/** Steps of the search of the scale (precision about (max − min) / 2^steps). */
const FIT_STEPS = 10;

/**
 * Pure: the largest scale in [min, max] for which `fits` says yes (binary search, `fits` growing false with the
 * scale); `min` when not even that fits.
 */
export function largestFit(fits: (scale: number) => boolean, min: number, max: number, steps = FIT_STEPS): number {
  if (fits(max)) return max;
  if (!fits(min)) return min;
  let lo = min;
  let hi = max;
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Slide of a full screen pause in the space left by its title. `normal`: as designed, it scrolls when taller than
 * the space. Without touch nobody can scroll it: what does not fit is cut (overflow hidden), no other scale. `large` and `fill`: the slide is laid out narrower and scaled up (CSS transform) as far as it stays
 * whole in the space, centred; `fill` also scales it down when it does not fit. Measured again when the space or
 * the slide change size; without measures (no layout, e.g. tests) the slide is not scaled.
 */
export function SlideFit({
  size,
  children,
  className = '',
  ...rest
}: {
  size: IntermissionFullscreenSize;
  children: ReactNode;
  className?: string;
  'data-studio-slide'?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const touch = useTouch();
  const fitting = size !== 'normal';

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!fitting || !box || !content) return;
    const limits = FIT_LIMITS[size];
    let busy = false;
    const measure = (): void => {
      if (busy) return;
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (width <= 0 || height <= 0) return;
      busy = true;
      const fits = (scale: number): boolean => {
        content.style.width = `${width / scale}px`;
        return content.offsetHeight * scale <= height + 0.5 && content.scrollWidth <= content.offsetWidth + 1;
      };
      const scale = largestFit(fits, limits.min, limits.max);
      content.style.width = `${width / scale}px`;
      content.style.transform = `scale(${scale})`;
      content.style.top = `${Math.max(0, (height - content.offsetHeight * scale) / 2)}px`;
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
    observer.observe(content);
    return () => observer.disconnect();
  });

  if (!fitting)
    return (
      <div {...rest} className={`${className} ${touch ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'}`}>
        {children}
      </div>
    );
  return (
    <div
      {...rest}
      ref={outer}
      data-slide-fit={size}
      className={`${className} relative ${touch ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'}`}
    >
      <div ref={inner} className="absolute left-0 top-0 w-full origin-top-left">
        {children}
      </div>
    </div>
  );
}
