import type { Side } from '@sir/volley-stats';

/**
 * The only ECharts theme of the portal. Colours are the tokens of styles/tokens.css read at runtime
 * (a canvas cannot use CSS variables), so light and dark follow the same palette as the rest of the page.
 */
export interface ChartPalette {
  text: string;
  muted: string;
  axis: string;
  grid: string;
  border: string;
  surface: string;
  surface2: string;
  home: string;
  homeSoft: string;
  away: string;
  awaySoft: string;
  evaluation: Record<string, string>;
  fontSans: string;
  fontDisplay: string;
}

/** Fallback values (light theme), used when the document has no stylesheet (tests). */
export const DEFAULT_PALETTE: ChartPalette = {
  text: '#0f172a',
  muted: '#475569',
  axis: '#64748b',
  grid: '#e3e8ef',
  border: '#d5dce6',
  surface: '#ffffff',
  surface2: '#f5f7fb',
  home: '#1d4ed8',
  homeSoft: '#dbe5ff',
  away: '#a21caf',
  awaySoft: '#f7dcf9',
  evaluation: {
    '#': '#15803d',
    '+': '#65a30d',
    '!': '#ca8a04',
    '-': '#ea580c',
    '/': '#c2410c',
    '=': '#dc2626',
    '~': '#94a3b8',
  },
  fontSans: 'system-ui, sans-serif',
  fontDisplay: 'system-ui, sans-serif',
};

const EVAL_TOKENS: Record<string, string> = {
  '#': '--sir-eval-perfect',
  '+': '--sir-eval-positive',
  '!': '--sir-eval-ok',
  '-': '--sir-eval-negative',
  '/': '--sir-eval-poor',
  '=': '--sir-eval-error',
  '~': '--sir-eval-none',
};

/** Reads the palette from the CSS variables of `<html>`. */
export function readPalette(
  root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
): ChartPalette {
  if (!root) return DEFAULT_PALETTE;
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  const evaluation: Record<string, string> = {};
  for (const [symbol, token] of Object.entries(EVAL_TOKENS)) {
    evaluation[symbol] = v(token, DEFAULT_PALETTE.evaluation[symbol] ?? DEFAULT_PALETTE.muted);
  }
  return {
    text: v('--sir-text', DEFAULT_PALETTE.text),
    muted: v('--sir-text-muted', DEFAULT_PALETTE.muted),
    axis: v('--sir-axis', DEFAULT_PALETTE.axis),
    grid: v('--sir-grid', DEFAULT_PALETTE.grid),
    border: v('--sir-border', DEFAULT_PALETTE.border),
    surface: v('--sir-surface', DEFAULT_PALETTE.surface),
    surface2: v('--sir-surface-2', DEFAULT_PALETTE.surface2),
    home: v('--sir-home', DEFAULT_PALETTE.home),
    homeSoft: v('--sir-home-soft', DEFAULT_PALETTE.homeSoft),
    away: v('--sir-away', DEFAULT_PALETTE.away),
    awaySoft: v('--sir-away-soft', DEFAULT_PALETTE.awaySoft),
    evaluation,
    fontSans: v('--sir-font-sans', DEFAULT_PALETTE.fontSans),
    fontDisplay: v('--sir-font-display', DEFAULT_PALETTE.fontDisplay),
  };
}

export const sideColor = (p: ChartPalette, side: Side): string => (side === 'home' ? p.home : p.away);

/** Duration of chart transitions (≤ 600 ms), 0 with reduced motion. */
export const ANIMATION_MS = 450;

/**
 * ECharts theme object registered by `EChart`. Light grids, direct labels, no legends by default;
 * tooltips are drawn inside the canvas (`renderMode: 'richText'`): no HTML and no inline styles (strict CSP).
 */
export function buildEchartsTheme(p: ChartPalette): Record<string, unknown> {
  const axis = {
    axisLine: { show: true, lineStyle: { color: p.border } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontFamily: p.fontSans },
    splitLine: { show: true, lineStyle: { color: p.grid, width: 1 } },
    nameTextStyle: { color: p.muted },
  };
  return {
    color: [p.home, p.away, p.evaluation['#'], p.evaluation['='], p.axis],
    backgroundColor: 'transparent',
    textStyle: { color: p.text, fontFamily: p.fontSans },
    title: { textStyle: { color: p.text }, subtextStyle: { color: p.muted } },
    legend: { textStyle: { color: p.muted } },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    tooltip: {
      renderMode: 'richText',
      backgroundColor: p.surface,
      borderColor: p.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: p.text, fontFamily: p.fontSans, fontSize: 13 },
      axisPointer: { lineStyle: { color: p.axis, type: 'dashed' }, crossStyle: { color: p.axis } },
    },
    line: { symbolSize: 6, smooth: false },
    bar: { itemStyle: { borderRadius: 3 } },
  };
}

/**
 * Removes from a value put in a label the characters with a meaning in ECharts rich text (`{`, `}`, `|`) and,
 * as defence in depth should a tooltip ever be rendered as HTML, `<`, `>` and `&`.
 */
export function richSafe(text: string): string {
  return text.replace(/[{}|<>&]/g, '');
}
