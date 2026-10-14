import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { useReducedMotion, useResolvedTheme } from '../lib/theme.ts';
import { ANIMATION_MS, buildEchartsTheme, readPalette } from './theme.ts';

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
 * Thin React wrapper of ECharts. The theme (`charts/theme.ts`) is rebuilt from the CSS tokens when light/dark changes;
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
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const name = `sir-${theme}`;
    echarts.registerTheme(name, buildEchartsTheme(readPalette()));
    const instance = echarts.init(el, name, { renderer: 'canvas' });
    chart.current = instance;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => instance.resize()) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [theme]);

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
  }, [option, reduced, theme]);

  return <div ref={ref} role="img" aria-label={label} className={`w-full min-w-0 ${className}`} />;
}
