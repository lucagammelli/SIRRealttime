import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/theme.ts';
import { ANIMATION_MS, buildEchartsTheme, readPalette } from './theme.ts';
import { usePaletteKey } from './usePalette.ts';

// Only the pieces used by the portal (smaller bundle than the full `echarts` import).
echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GraphicComponent,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type { EChartsCoreOption };

/**
 * Thin React wrapper of ECharts. The theme (`charts/theme.ts`) is rebuilt from the CSS tokens when light/dark or the
 * graphics of the client change;
 * the option is merged at every update so the chart animates from the previous point (≤ 600 ms, none with
 * prefers-reduced-motion).
 */
export function EChart({
  option,
  label,
  className = 'h-64',
}: {
  option: EChartsCoreOption;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  // New graphics of the client (colours as CSS variables), light/dark, or the colours of the scope around (preview of
  // the Studio): the theme is built again.
  const { key, root } = usePaletteKey();
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const name = `sir-${key}`;
    echarts.registerTheme(name, buildEchartsTheme(root ? readPalette(root) : readPalette()));
    const instance = echarts.init(el, name, { renderer: 'canvas' });
    chart.current = instance;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => instance.resize()) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [key, root]);

  useEffect(() => {
    chart.current?.setOption(
      {
        animation: !reduced,
        animationDuration: ANIMATION_MS,
        animationDurationUpdate: ANIMATION_MS,
        animationEasingUpdate: 'cubicOut',
        ...option,
      },
      { replaceMerge: ['series'], lazyUpdate: true },
    );
  }, [option, reduced, key]);

  return <div ref={ref} role="img" aria-label={label} className={`w-full min-w-0 ${className}`} />;
}
