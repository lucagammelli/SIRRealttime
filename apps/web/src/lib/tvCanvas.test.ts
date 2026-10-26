import { describe, expect, it } from 'vitest';
import { TV_CANVAS_HEIGHT, TV_CANVAS_WIDTH, tvCanvasFit, tvCanvasUnits } from './tvCanvas.ts';

describe('tvCanvasFit', () => {
  it('the canvas is 1920 × 1080', () => {
    expect([TV_CANVAS_WIDTH, TV_CANVAS_HEIGHT]).toEqual([1920, 1080]);
  });

  it('scales a 16:9 screen with no bands', () => {
    expect(tvCanvasFit(1920, 1080)).toEqual({ scale: 1, left: 0, top: 0 });
    expect(tvCanvasFit(1280, 720)).toEqual({ scale: 2 / 3, left: 0, top: 0 });
    expect(tvCanvasFit(3840, 2160)).toEqual({ scale: 2, left: 0, top: 0 });
  });

  it('leaves bands above and below on a taller screen, at the sides on a wider one, canvas centred', () => {
    // 1366 × 768 is a little narrower than 16:9: the height decides, thin bands at the sides.
    const a = tvCanvasFit(1366, 768);
    expect(a.scale).toBeCloseTo(768 / 1080, 6);
    expect(a.top).toBeCloseTo(0, 6);
    expect(a.left).toBeCloseTo((1366 - 1920 * a.scale) / 2, 6);
    expect(a.left).toBeGreaterThan(0);
    // 4:3: bands above and below.
    const b = tvCanvasFit(1600, 1200);
    expect(b.scale).toBeCloseTo(1600 / 1920, 6);
    expect(b.top).toBeCloseTo((1200 - 900) / 2, 6);
    // 21:9: bands at the sides.
    const c = tvCanvasFit(2560, 1080);
    expect(c.scale).toBe(1);
    expect(c.left).toBe(320);
    expect(c.top).toBe(0);
  });

  it('never fails on a screen without a size', () => {
    expect(tvCanvasFit(0, 0)).toEqual({ scale: 1, left: 0, top: 0 });
    expect(tvCanvasFit(Number.NaN, 500).scale).toBeGreaterThan(0);
  });
});

describe('tvCanvasUnits', () => {
  it('1vw and 1vh are 1 % of the canvas, in the units of the box the page is drawn in', () => {
    expect(tvCanvasUnits()).toEqual({ '--sir-vw': '19.2px', '--sir-vh': '10.8px' });
    expect(tvCanvasUnits(0.5)).toEqual({ '--sir-vw': '9.6px', '--sir-vh': '5.4px' });
  });
});
