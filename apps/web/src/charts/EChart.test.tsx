import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTenantLook } from '../lib/branding.ts';
import { stateAfter } from '../test/fixtures.ts';
import { rotationOption } from './options.ts';
import { rotationSeries } from './rotations.ts';
import { readPalette } from './theme.ts';

const mocks = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), setTheme: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { instance, init: vi.fn(() => instance) };
});

vi.mock('echarts/core', () => ({ use: vi.fn(), init: mocks.init, registerTheme: vi.fn() }));

const { EChart, optionSignature, withSeriesIds } = await import('./EChart.tsx');

beforeEach(() => {
  mocks.init.mockClear();
  for (const fn of Object.values(mocks.instance)) fn.mockClear();
});
afterEach(cleanup);

type Series = { id?: string; data?: number[] };
const seriesOf = (call: number): Series[] => {
  const option = mocks.instance.setOption.mock.calls[call]?.[0] as { series?: Series[] } | undefined;
  return option?.series ?? [];
};

describe('ECharts wrapper', () => {
  it('gives a stable id to the series without one, keeps the ids already there', () => {
    const option = withSeriesIds({ series: [{ type: 'bar' }, { type: 'bar' }, { type: 'line', id: 'lead' }] });
    expect((option as { series: Series[] }).series.map((s) => s.id)).toEqual(['bar-0', 'bar-1', 'lead']);
    expect(withSeriesIds({ grid: {} })).toEqual({ grid: {} });
  });

  it('the signature ignores the functions and follows the values', () => {
    const a = { series: [{ data: [1, 2] }], tooltip: { formatter: () => 'a' } };
    const b = { series: [{ data: [1, 2] }], tooltip: { formatter: () => 'b' } };
    expect(optionSignature(a)).toBe(optionSignature(b));
    expect(optionSignature(a)).not.toBe(optionSignature({ series: [{ data: [1, 3] }] }));
  });

  it('«Rotazioni»: a new message with the same values does not draw again; a new point updates the same series', () => {
    const state = stateAfter();
    const palette = readPalette();
    const optionOf = (s: typeof state) => rotationOption(rotationSeries(s, 'home'), 'home', palette);
    const { rerender } = render(<EChart option={optionOf(state)} label="Rotazioni" />);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.instance.setOption).toHaveBeenCalledTimes(1);
    expect(seriesOf(0).map((s) => s.id)).toEqual(['bar-0', 'bar-1']);

    // Same match, new objects (another message): nothing is applied, the instance stays.
    rerender(<EChart option={optionOf(structuredClone(state))} label="Rotazioni" />);
    rerender(<EChart option={optionOf(structuredClone(state))} label="Rotazioni" />);
    expect(mocks.instance.setOption).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.instance.dispose).not.toHaveBeenCalled();

    // One more point won in P1: the option is applied again, merged into the same series (same ids).
    const next = structuredClone(state);
    const p1 = next.rotations.home.find((r) => r.position === 1);
    if (!p1) throw new Error('no P1');
    p1.pointsWon += 1;
    rerender(<EChart option={optionOf(next)} label="Rotazioni" />);
    expect(mocks.instance.setOption).toHaveBeenCalledTimes(2);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(seriesOf(1).map((s) => s.id)).toEqual(['bar-0', 'bar-1']);
    expect(seriesOf(1)[0]?.data?.[0]).toBe((seriesOf(0)[0]?.data?.[0] ?? 0) + 1);
    expect(mocks.instance.setOption.mock.calls[1]?.[1]).toEqual({ replaceMerge: ['series'], lazyUpdate: true });
  });

  it('graphics read again with the same colours: same instance, theme not applied again, nothing redrawn', () => {
    render(<EChart option={{ series: [{ type: 'bar', data: [1] }] }} label="x" />);
    act(() => {
      setTenantLook(null);
    });
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.instance.setTheme).not.toHaveBeenCalled();
    expect(mocks.instance.setOption).toHaveBeenCalledTimes(1);
  });

  it('disposes of the instance only when the chart leaves the page', () => {
    const { unmount } = render(<EChart option={{ series: [] }} label="x" />);
    expect(mocks.instance.dispose).not.toHaveBeenCalled();
    unmount();
    expect(mocks.instance.dispose).toHaveBeenCalledTimes(1);
  });
});
