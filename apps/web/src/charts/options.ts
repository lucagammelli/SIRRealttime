import type { Side } from '@sir/volley-stats';
import type { EChartsCoreOption } from 'echarts/core';
import { formatPct } from '../lib/format.ts';
import type { MomentumDatum } from './momentum.ts';
import { leadBound } from './momentum.ts';
import type { RotationDatum } from './rotations.ts';
import type { ChartPalette } from './theme.ts';
import { richSafe, sideColor } from './theme.ts';

/** Rich text styles shared by the tooltips (drawn in the canvas). */
function tooltipRich(p: ChartPalette): Record<string, Record<string, unknown>> {
  return {
    t: { fontWeight: 700, color: p.text, fontSize: 13, lineHeight: 20 },
    m: { color: p.muted, fontSize: 12, lineHeight: 18 },
    h: { color: p.home, fontWeight: 700, fontSize: 13, lineHeight: 20 },
    a: { color: p.away, fontWeight: 700, fontSize: 13, lineHeight: 20 },
    v: { color: p.text, fontSize: 12, lineHeight: 18 },
  };
}

interface TooltipParam {
  dataIndex: number;
}
const firstIndex = (params: unknown): number | null => {
  const list = Array.isArray(params) ? params : [params];
  const first = list[0] as TooltipParam | undefined;
  return typeof first?.dataIndex === 'number' ? first.dataIndex : null;
};

/**
 * Lead of the home team point by point (above 0: home ahead, below: away ahead), as a step area in the team colours,
 * with the break points marked by a dot of the team that scored.
 */
export function momentumOption(data: MomentumDatum[], p: ChartPalette, short: Record<Side, string>): EChartsCoreOption {
  const bound = leadBound(data);
  const withStart = [{ rally: 0, lead: 0, homeScore: 0, awayScore: 0 }, ...data];
  const last = data.length;
  const grid = { left: 34, right: 14, top: 14, bottom: 30 };
  const label = (text: string, color: string) => ({
    type: 'text',
    silent: true,
    style: { text, fill: color, fontWeight: 600, fontSize: 12, fontFamily: p.fontSans },
  });
  return {
    grid,
    // Direct labels pinned to the plot area (no legend): home lead above the zero line, away lead below.
    graphic: [
      { ...label(`▲ ${richSafe(short.home)} avanti`, p.home), left: grid.left + 8, top: grid.top + 2 },
      { ...label(`▼ ${richSafe(short.away)} avanti`, p.away), left: grid.left + 8, bottom: grid.bottom + 4 },
    ],
    xAxis: {
      type: 'value',
      min: 0,
      // Rounded to 5 so that the last tick never collides with the label of the maximum.
      max: Math.max(10, Math.ceil(last / 5) * 5),
      minInterval: 1,
      axisLabel: { color: p.muted },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: -bound,
      max: bound,
      minInterval: 1,
      axisLabel: { formatter: (v: number) => String(Math.abs(v)) },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      // Also in the theme: repeated here so that no tooltip ever becomes HTML (CSP, no injected markup).
      renderMode: 'richText',
      textStyle: { rich: tooltipRich(p) },
      formatter: (params: unknown) => {
        const i = firstIndex(params);
        const d = i === null ? undefined : withStart[i];
        if (!d) return '';
        if (d.rally === 0) return '{m|Inizio del set}';
        const full = data[d.rally - 1];
        const who = full ? richSafe(short[full.scorer]) : '';
        const kind = full?.breakPoint ? 'break point' : 'cambio palla';
        const lead = d.lead === 0 ? 'parità' : `${richSafe(short[d.lead > 0 ? 'home' : 'away'])} +${Math.abs(d.lead)}`;
        return `{t|Punto ${d.rally}}\n{h|${d.homeScore}}{m| - }{a|${d.awayScore}}\n{v|Segna ${who}: ${kind}}\n{m|${lead}}`;
      },
    },
    series: [
      {
        type: 'line',
        name: 'lead-home',
        step: 'end',
        symbol: 'none',
        data: withStart.map((d) => [d.rally, Math.max(0, d.lead)]),
        lineStyle: { color: p.home, width: 2 },
        areaStyle: { color: p.home, opacity: 0.22 },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: p.axis, width: 1, type: 'solid' },
          data: [{ yAxis: 0 }],
        },
        z: 2,
      },
      {
        type: 'line',
        name: 'lead-away',
        step: 'end',
        symbol: 'none',
        data: withStart.map((d) => [d.rally, Math.min(0, d.lead)]),
        lineStyle: { color: p.away, width: 2 },
        areaStyle: { color: p.away, opacity: 0.22 },
        tooltip: { show: false },
        z: 2,
      },
      {
        type: 'scatter',
        name: 'break-point',
        symbolSize: 9,
        data: data
          .filter((d) => d.breakPoint)
          .map((d) => ({
            value: [d.rally, d.lead],
            itemStyle: { color: sideColor(p, d.scorer), borderColor: p.surface, borderWidth: 1.5 },
          })),
        tooltip: { show: false },
        z: 3,
      },
    ],
  };
}

/** Points won (team colour) and lost (neutral) for each setter position. */
export function rotationOption(data: RotationDatum[], side: Side, p: ChartPalette): EChartsCoreOption {
  const color = sideColor(p, side);
  return {
    grid: { left: 30, right: 8, top: 22, bottom: 26 },
    xAxis: { type: 'category', data: data.map((d) => d.label) },
    yAxis: { type: 'value', minInterval: 1 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      // Also in the theme: repeated here so that no tooltip ever becomes HTML (CSP, no injected markup).
      renderMode: 'richText',
      textStyle: { rich: tooltipRich(p) },
      formatter: (params: unknown) => {
        const i = firstIndex(params);
        const d = i === null ? undefined : data[i];
        if (!d) return '';
        return [
          `{t|Palleggiatore in P${d.position}}`,
          `{v|Punti vinti: ${d.won} · persi: ${d.lost}}`,
          `{v|Cambio palla: ${formatPct(d.sideOutPct)}}`,
          `{v|Break point: ${formatPct(d.breakPointPct)}}`,
        ].join('\n');
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Vinti',
        data: data.map((d) => d.won),
        itemStyle: { color, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: p.text, fontSize: 11 },
        barGap: '15%',
        barMaxWidth: 26,
      },
      {
        type: 'bar',
        name: 'Persi',
        data: data.map((d) => d.lost),
        itemStyle: { color: p.axis, opacity: 0.45, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: p.muted, fontSize: 11 },
        barMaxWidth: 26,
      },
    ],
  };
}
