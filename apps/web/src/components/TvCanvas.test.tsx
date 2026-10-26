import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { midMatchState } from '../test/fixtures.ts';
import { tvCanvasFit } from '../lib/tvCanvas.ts';
import { MatchView } from './MatchView.tsx';
import { TvCanvas } from './TvCanvas.tsx';

vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

function noReducedMotion(): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const VIEWPORTS: ReadonlyArray<[number, number]> = [
  [1280, 720],
  [1920, 1080],
  [3840, 2160],
  [1366, 768],
];

describe('TvCanvas', () => {
  it('draws the children on a 1920 × 1080 box scaled to the screen and centred', () => {
    setViewport(1366, 768);
    const { container } = render(
      <TvCanvas>
        <p>pagina</p>
      </TvCanvas>,
    );
    const canvas = container.querySelector<HTMLElement>('[data-tv-canvas]');
    const fit = tvCanvasFit(1366, 768);
    expect(canvas?.style.width).toBe('1920px');
    expect(canvas?.style.height).toBe('1080px');
    expect(canvas?.style.transform).toBe(`scale(${fit.scale})`);
    expect(canvas?.style.top).toBe(`${fit.top}px`);
    expect(screen.getByText('pagina')).toBeTruthy();
    expect(canvas?.contains(screen.getByText('pagina'))).toBe(true);
  });

  it('follows the size of the window', () => {
    setViewport(1920, 1080);
    const { container } = render(<TvCanvas>x</TvCanvas>);
    expect(container.querySelector<HTMLElement>('[data-tv-canvas]')?.style.transform).toBe('scale(1)');
    act(() => {
      setViewport(960, 540);
      window.dispatchEvent(new Event('resize'));
    });
    expect(container.querySelector<HTMLElement>('[data-tv-canvas]')?.style.transform).toBe('scale(0.5)');
  });

  it('same screens and same cells whatever the resolution of the TV', () => {
    noReducedMotion();
    // The browser measures the area scaled by the canvas: 800 canvas px of height, 1800 of width.
    let scale = 1;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-tv-area')
        ? ({ width: 1800 * scale, height: 800 * scale } as DOMRect)
        : ({ width: 0, height: 0 } as DOMRect);
    });
    const summary = (c: HTMLElement) => ({
      label: screen.queryByRole('img', { name: /^Schermata/ })?.getAttribute('aria-label') ?? null,
      cells: [...c.querySelectorAll<HTMLElement>('[data-tv-block]')].map(
        (cell) => `${cell.dataset.tvBlock}:${cell.parentElement?.style.flex ?? ''}`,
      ),
      zoom: c.querySelector<HTMLElement>('[data-tv-area]')?.firstElementChild?.getAttribute('style') ?? '',
    });
    const results = VIEWPORTS.map(([w, h]) => {
      setViewport(w, h);
      scale = tvCanvasFit(w, h).scale;
      const { container, unmount } = render(
        <TvCanvas>
          <MatchView state={midMatchState()} device="tv" />
        </TvCanvas>,
      );
      const result = summary(container);
      unmount();
      return result;
    });
    expect(results[0]?.label).toMatch(/^Schermata 1 di \d+$/);
    expect(results[0]?.cells.length).toBeGreaterThan(2);
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('after a resize of the window (full screen, bars of the browser) screens and cells stay the same', () => {
    noReducedMotion();
    // The browser measures the area on the screen, scaled by the canvas at the moment of the measure.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const scale = tvCanvasFit(window.innerWidth, window.innerHeight).scale;
      return this.hasAttribute('data-tv-area')
        ? ({ width: 1800 * scale, height: 800 * scale } as DOMRect)
        : ({ width: 0, height: 0 } as DOMRect);
    });
    setViewport(1280, 720);
    const { container } = render(
      <TvCanvas>
        <MatchView state={midMatchState()} device="tv" />
      </TvCanvas>,
    );
    const summary = () => ({
      label: screen.queryByRole('img', { name: /^Schermata/ })?.getAttribute('aria-label') ?? null,
      cells: [...container.querySelectorAll<HTMLElement>('[data-tv-block]')].map(
        (cell) => `${cell.dataset.tvBlock}:${cell.parentElement?.style.flex ?? ''}`,
      ),
      zoom: container.querySelector<HTMLElement>('[data-tv-area]')?.firstElementChild?.getAttribute('style') ?? '',
    });
    const before = summary();
    expect(before.label).toMatch(/^Schermata 1 di \d+$/);
    for (const [w, h] of [
      [3840, 2160],
      [960, 540],
      [1366, 768],
    ] as const) {
      act(() => {
        setViewport(w, h);
        window.dispatchEvent(new Event('resize'));
      });
      expect(summary()).toEqual(before);
    }
  });
});
