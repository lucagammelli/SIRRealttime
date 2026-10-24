import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef, useState } from 'react';
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
 * Same option with an `id` on every series that has none (`<type>-<position>`). With `replaceMerge: ['series']` a
 * series without id is never matched to the one already drawn: ECharts creates it again and its bars or lines grow
 * again from zero at every update. With a stable id the series is merged and only the values that changed move.
 */
export function withSeriesIds(option: EChartsCoreOption): EChartsCoreOption {
  const { series } = option as { series?: unknown };
  if (!Array.isArray(series)) return option;
  return {
    ...option,
    series: series.map((s: unknown, i) => {
      if (typeof s !== 'object' || s === null || 'id' in s) return s;
      const type = 'type' in s && typeof s.type === 'string' ? s.type : 'series';
      return { ...s, id: `${type}-${i}` };
    }),
  };
}

/**
 * Content of an option: two options with the same signature draw the same chart, so the second one is not applied (no
 * update, no animation). The functions (tooltip and label formatters) do not enter the signature: a formatter that
 * changes while every value stays the same is not applied, the chart keeps the previous one. The formatters of the
 * portal read only values that are also in the option, so they change with it.
 */
export function optionSignature(option: unknown): string {
  return JSON.stringify(option) ?? '';
}

/**
 * Thin React wrapper of ECharts. One instance for the whole life of the component: the theme (`charts/theme.ts`,
 * rebuilt from the CSS tokens when light/dark or the graphics of the client change) is applied to it with `setTheme`
 * only when its content changes, so a new reading of the same graphics (reconnection, back in the foreground) does not
 * draw the chart again from zero. The option is applied only when its content changes and merged with the previous one
 * (series kept by id): the chart animates only the values that changed (≤ 600 ms, none with prefers-reduced-motion).
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
  const observer = useRef<ResizeObserver | null>(null);
  const appliedTheme = useRef('');
  // New graphics of the client (colours as CSS variables), light/dark, or the colours of the scope around (preview of
  // the Studio): the theme is read again.
  const { key, root } = usePaletteKey();
  const reduced = useReducedMotion();
  // A new object with the same content (a new message of the match that changes nothing here) keeps the old one.
  const signature = optionSignature(option);
  const [held, setHeld] = useState({ signature, option });
  if (held.signature !== signature) setHeld({ signature, option });
  const current = held.signature === signature ? held.option : option;

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
      chart.current?.dispose();
      chart.current = null;
    },
    [],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const theme = buildEchartsTheme(root ? readPalette(root) : readPalette());
    const themeSignature = optionSignature(theme);
    const existing = chart.current;
    if (existing) {
      if (themeSignature !== appliedTheme.current) existing.setTheme(theme);
    } else {
      const instance = echarts.init(el, theme, { renderer: 'canvas' });
      chart.current = instance;
      observer.current = typeof ResizeObserver === 'function' ? new ResizeObserver(() => instance.resize()) : null;
      observer.current?.observe(el);
    }
    appliedTheme.current = themeSignature;
  }, [key, root]);

  useEffect(() => {
    chart.current?.setOption(
      {
        animation: !reduced,
        animationDuration: ANIMATION_MS,
        animationDurationUpdate: ANIMATION_MS,
        animationEasingUpdate: 'cubicOut',
        ...withSeriesIds(current),
      },
      { replaceMerge: ['series'], lazyUpdate: true },
    );
  }, [current, reduced]);

  return <div ref={ref} role="img" aria-label={label} className={`w-full min-w-0 ${className}`} />;
}
