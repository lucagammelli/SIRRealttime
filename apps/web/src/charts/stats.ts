import type { StatsCurve, StatsDayRow } from '@arenalive/shared';
import type { EChartsCoreOption } from './EChart.tsx';

/** Visits per day (bars) and the peak of spectators (line). Colours: the series colours of the theme. */
export function dailyOption(days: StatsDayRow[]): EChartsCoreOption {
  return {
    grid: { left: 40, right: 40, top: 28, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['Visite', 'Picco'] },
    xAxis: { type: 'category', data: days.map((d) => d.day.slice(5).split('-').reverse().join('/')) },
    yAxis: [
      { type: 'value', minInterval: 1, name: 'Visite' },
      { type: 'value', minInterval: 1, name: 'Picco', splitLine: { show: false } },
    ],
    series: [
      { name: 'Visite', type: 'bar', data: days.map((d) => d.visits) },
      { name: 'Picco', type: 'line', yAxisIndex: 1, data: days.map((d) => d.peak) },
    ],
  };
}

const timeFormat = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });

/** Spectators connected minute by minute during a match. */
export function curveOption(curve: StatsCurve): EChartsCoreOption {
  return {
    grid: { left: 40, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: curve.points.map((p) => timeFormat.format(new Date(p.at))) },
    yAxis: { type: 'value', minInterval: 1, name: 'Spettatori' },
    series: [
      { name: 'Spettatori', type: 'line', areaStyle: { opacity: 0.15 }, data: curve.points.map((p) => p.viewers) },
    ],
  };
}
