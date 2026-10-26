/**
 * Fixed canvas of the big screen (TV): the public page is always laid out on 1920 × 1080 CSS px and the canvas is then
 * scaled as a whole, like a picture, to fill the real screen. Pages, groups of blocks and sizes depend only on the
 * canvas and on the configuration, never on the resolution, the zoom or the bars of the TV. Decision of 2026-10-26.
 */
export const TV_CANVAS_WIDTH = 1920;
export const TV_CANVAS_HEIGHT = 1080;

/** CSS variables that replace `1vw` and `1vh` in the sizes of the page: the canvas on the TV, the viewport elsewhere. */
export const SIR_VW_VAR = '--sir-vw';
export const SIR_VH_VAR = '--sir-vh';

/** Where the canvas goes on a real screen: uniform scale and offset of its top-left corner (the rest is the bands). */
export interface TvCanvasFit {
  scale: number;
  left: number;
  top: number;
}

/**
 * Pure: scale and offset of the canvas centred in a screen of `width` × `height` CSS px (letterbox: the biggest
 * uniform scale that fits; on a screen that is not 16:9 the bands are at the sides or above and below).
 */
export function tvCanvasFit(width: number, height: number): TvCanvasFit {
  const w = Number.isFinite(width) && width > 0 ? width : TV_CANVAS_WIDTH;
  const h = Number.isFinite(height) && height > 0 ? height : TV_CANVAS_HEIGHT;
  const scale = Math.min(w / TV_CANVAS_WIDTH, h / TV_CANVAS_HEIGHT);
  return { scale, left: (w - TV_CANVAS_WIDTH * scale) / 2, top: (h - TV_CANVAS_HEIGHT * scale) / 2 };
}

/**
 * Pure: values of `--sir-vw` and `--sir-vh` (1 % of the canvas) in px; `unit` converts the real px of the canvas into
 * the px of the box the page is drawn in (1 on the TV, the preview of the Studio draws a smaller box).
 */
export function tvCanvasUnits(unit = 1): Record<typeof SIR_VW_VAR | typeof SIR_VH_VAR, string> {
  return {
    [SIR_VW_VAR]: `${(TV_CANVAS_WIDTH / 100) * unit}px`,
    [SIR_VH_VAR]: `${(TV_CANVAS_HEIGHT / 100) * unit}px`,
  };
}
