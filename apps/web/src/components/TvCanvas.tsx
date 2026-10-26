import type { ReactNode } from 'react';
import { TV_CANVAS_HEIGHT, TV_CANVAS_WIDTH, tvCanvasFit } from '../lib/tvCanvas.ts';
import { LayoutScaleContext, useViewportHeight, useViewportWidth } from '../lib/useLayout.ts';

/**
 * Canvas of the big screen: the children are laid out on a fixed 1920 × 1080 px box, scaled with `transform` to fill
 * the real screen (centred, bands of the background colour on a screen that is not 16:9). `fixed` elements inside
 * (pauses, avvisi) stay inside the canvas because of the transform. `LayoutScaleContext` carries the scale, so the
 * measures of the layout (read with getBoundingClientRect) go back to canvas px.
 */
export function TvCanvas({ children }: { children: ReactNode }) {
  const { scale, left, top } = tvCanvasFit(useViewportWidth(), useViewportHeight());
  return (
    <div className="fixed inset-0 overflow-hidden bg-bg" data-testid="tela-tv">
      <div
        data-tv-canvas=""
        className="absolute"
        style={{
          width: TV_CANVAS_WIDTH,
          height: TV_CANVAS_HEIGHT,
          left,
          top,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <LayoutScaleContext.Provider value={scale}>{children}</LayoutScaleContext.Provider>
      </div>
    </div>
  );
}
