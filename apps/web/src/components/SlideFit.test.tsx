import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TouchContext } from '../lib/useLayout.ts';
import { FIT_LIMITS, largestFit, SlideFit } from './SlideFit.tsx';

describe('largestFit', () => {
  it('gives the largest scale that fits, the maximum when all fit and the minimum when none does', () => {
    expect(largestFit(() => true, 1, 1.5)).toBe(1.5);
    expect(largestFit(() => false, 0.4, 4)).toBe(0.4);
    const scale = largestFit((s) => s <= 2.2, 0.4, 4);
    expect(scale).toBeLessThanOrEqual(2.2);
    expect(scale).toBeGreaterThan(2.19);
  });
});

/** Layout of jsdom: the space is 1000 × 500 px; the slide has a fixed area (250 000 px²), taller when narrower. */
const props = ['clientWidth', 'clientHeight', 'offsetHeight', 'offsetWidth', 'scrollWidth'] as const;
const saved = props.map((p) => [p, Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)] as const);
function fakeLayout(): void {
  const width = (el: HTMLElement): number => Number.parseFloat(el.style.width) || 1000;
  const box = (el: HTMLElement): boolean => el.hasAttribute('data-slide-fit');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return box(this) ? 1000 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return box(this) ? 500 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return 250_000 / width(this);
    },
  });
  for (const p of ['offsetWidth', 'scrollWidth'] as const)
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get(this: HTMLElement) {
        return width(this);
      },
    });
}

afterEach(() => {
  cleanup();
  for (const [p, d] of saved) {
    if (d) Object.defineProperty(HTMLElement.prototype, p, d);
    else Reflect.deleteProperty(HTMLElement.prototype, p);
  }
});

const scaleOf = (container: HTMLElement): number =>
  Number(container.querySelector<HTMLElement>('[data-slide-fit] > div')?.dataset.scale);

describe('SlideFit', () => {
  it('«normal»: the slide as designed, scrolling, never scaled', () => {
    const { container } = render(
      <SlideFit size="normal" data-studio-slide="a">
        <p>Slide</p>
      </SlideFit>,
    );
    const box = container.querySelector('[data-studio-slide="a"]');
    expect(box?.className).toContain('overflow-y-auto');
    expect(container.querySelector('[data-slide-fit]')).toBeNull();
  });

  it('without touch never scrolls: what does not fit is cut, «Normale» still not scaled', () => {
    for (const size of ['normal', 'large', 'fill'] as const) {
      const { container, unmount } = render(
        <TouchContext.Provider value={false}>
          <SlideFit size={size} data-studio-slide="a">
            <p>Slide</p>
          </SlideFit>
        </TouchContext.Provider>,
      );
      const box = container.querySelector('[data-studio-slide="a"]');
      expect(box?.className).toContain('overflow-hidden');
      expect(box?.className).not.toContain('overflow-y-auto');
      if (size === 'normal') expect(container.querySelector('[style*="scale"]')).toBeNull();
      unmount();
    }
  });

  it('without layout (no measures) the slide is not scaled', () => {
    const { container } = render(
      <SlideFit size="fill">
        <p>Slide</p>
      </SlideFit>,
    );
    expect(container.querySelector('[data-slide-fit="fill"]')).not.toBeNull();
    expect(Number.isNaN(scaleOf(container))).toBe(true);
  });

  it('«fill» and «large» scale the slide as far as it stays whole in the space, «large» at most 1.5', () => {
    fakeLayout();
    // 250 s² ≤ 500: s ≤ √2.
    const fill = render(
      <SlideFit size="fill">
        <p>Slide</p>
      </SlideFit>,
    );
    expect(scaleOf(fill.container)).toBeCloseTo(Math.SQRT2, 2);
    expect(scaleOf(fill.container)).toBeLessThanOrEqual(Math.SQRT2);
    const inner = fill.container.querySelector<HTMLElement>('[data-slide-fit] > div');
    expect(inner?.style.transform).toMatch(/^scale\(1\.41/);
    cleanup();
    expect(FIT_LIMITS.large.max).toBe(1.5);
    const large = render(
      <SlideFit size="large">
        <p>Slide</p>
      </SlideFit>,
    );
    expect(scaleOf(large.container)).toBeCloseTo(Math.SQRT2, 2);
  });
});
