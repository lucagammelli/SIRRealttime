import type { IntermissionFullscreenSize } from '@arenalive/shared';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';

/** Limits of the scale of a slide for every size but `normal` (as designed: no scale). */
export const FIT_LIMITS: Record<Exclude<IntermissionFullscreenSize, 'normal'>, { min: number; max: number }> = {
  large: { min: 1, max: 1.5 },
  fill: { min: 0.4, max: 4 },
};
/** Steps of the search of the scale (precision about (max − min) / 2^steps). */
const FIT_STEPS = 10;
/** Longest time (ms) the slide stays hidden waiting for an image: then it is shown anyway. */
export const IMAGE_WAIT_MS = 2500;

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
 * the space. With `cut` (big screen without touch) nobody can scroll it: what does not fit is cut (overflow hidden), no other scale. `large` and `fill`: the slide is laid out narrower and scaled up (CSS transform) as far as it stays
 * whole in the space, centred; `fill` also scales it down when it does not fit. Measured again when the space or
 * the slide change size; without measures (no layout, e.g. tests) the slide is not scaled.
 */
export function SlideFit({
  size,
  children,
  className = '',
  cut = false,
  ...rest
}: {
  size: IntermissionFullscreenSize;
  children: ReactNode;
  className?: string;
  /** Big screen without touch: nobody can scroll the slide, what does not fit is cut. */
  cut?: boolean;
  'data-studio-slide'?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fitting = size !== 'normal';
  // Start of the wait for the images (null: none pending); kept across renders so the limit does not restart.
  const waitingSince = useRef<number | null>(null);

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!fitting || !box || !content) return;
    const limits = FIT_LIMITS[size];
    let busy = false;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const measure = (): void => {
      if (busy) return;
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (width <= 0 || height <= 0) return;
      busy = true;
      // Slide as at rest: no entrance animation (CSS rule) and hidden while an image has no size yet.
      content.setAttribute('data-fit-measuring', '');
      const fits = (scale: number): boolean => {
        content.style.width = `${width / scale}px`;
        return content.offsetHeight * scale <= height + 0.5 && content.scrollWidth <= content.offsetWidth + 1;
      };
      const scale = largestFit(fits, limits.min, limits.max);
      content.style.width = `${width / scale}px`;
      content.style.transform = `scale(${scale})`;
      content.style.top = `${Math.max(0, (height - content.offsetHeight * scale) / 2)}px`;
      content.dataset.scale = scale.toFixed(3);
      content.removeAttribute('data-fit-measuring');
      const missing = Array.from(content.querySelectorAll('img')).some((img) => !img.complete);
      if (!missing) {
        waitingSince.current = null;
        clearTimeout(giveUp);
        giveUp = undefined;
        content.style.visibility = '';
      } else {
        waitingSince.current ??= Date.now();
        const left = IMAGE_WAIT_MS - (Date.now() - waitingSince.current);
        if (left <= 0) content.style.visibility = '';
        else {
          content.style.visibility = 'hidden';
          giveUp ??= setTimeout(() => {
            giveUp = undefined;
            content.style.visibility = '';
          }, left);
        }
      }
      // The observers see the sizes just set: the next frame may measure again.
      requestAnimationFrame(() => {
        busy = false;
      });
    };
    measure();
    // Safety nets: the animations end, the images get their size (load, or error: the alt text shows).
    const again = (): void => {
      if (busy) requestAnimationFrame(measure);
      else measure();
    };
    content.addEventListener('animationend', again);
    content.addEventListener('load', again, true);
    content.addEventListener('error', again, true);
    const stop = (): void => {
      content.removeEventListener('animationend', again);
      content.removeEventListener('load', again, true);
      content.removeEventListener('error', again, true);
    };
    if (typeof ResizeObserver !== 'function')
      return () => {
        stop();
        clearTimeout(giveUp);
      };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => {
      stop();
      clearTimeout(giveUp);
      observer.disconnect();
    };
  });

  if (!fitting)
    return (
      <div {...rest} className={`${className} ${cut ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain'}`}>
        {children}
      </div>
    );
  return (
    <div
      {...rest}
      ref={outer}
      data-slide-fit={size}
      className={`${className} relative ${cut ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}
    >
      <div ref={inner} className="absolute left-0 top-0 w-full origin-top-left">
        {children}
      </div>
    </div>
  );
}
