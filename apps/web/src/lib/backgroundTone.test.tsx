import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemLogo } from '../components/SystemLogo.tsx';
import { backgroundBehind, blendLayers, cssColorToRgba, parseRgbColor, useBackgroundBehind } from './backgroundTone.ts';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
});

describe('colours read from the browser', () => {
  it('rgb() and rgba() in the forms of the browsers; transparent; anything unreadable is null', () => {
    expect(parseRgbColor('rgb(255, 255, 255)')).toEqual([255, 255, 255, 1]);
    expect(parseRgbColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseRgbColor('rgb(10 20 30 / 40%)')).toEqual([10, 20, 30, 0.4]);
    expect(parseRgbColor('oklch(0.5 0.1 200)')).toBeNull();
    expect(cssColorToRgba('transparent')).toEqual([0, 0, 0, 0]);
    expect(cssColorToRgba('')).toEqual([0, 0, 0, 0]);
    // No canvas in jsdom: a colour of another form cannot be told.
    expect(cssColorToRgba('oklch(0.5 0.1 200)')).toBeNull();
  });

  it('blends the semi-transparent layers down to the first opaque one', () => {
    expect(blendLayers([[255, 255, 255, 1]])).toBe('#ffffff');
    expect(
      blendLayers([
        [0, 0, 0, 0],
        [16, 32, 48, 1],
      ]),
    ).toBe('#102030');
    expect(
      blendLayers([
        [255, 255, 255, 0.5],
        [0, 0, 0, 1],
      ]),
    ).toBe('#808080');
    expect(blendLayers([[255, 255, 255, 0.5]])).toBeNull();
    expect(blendLayers([])).toBeNull();
  });
});

describe('backgroundBehind', () => {
  it('the first background of the element or its ancestors; null when there is none', () => {
    render(
      <div data-testid="esterno" style={{ backgroundColor: '#0f172a' }}>
        <div style={{ backgroundColor: 'rgba(0, 0, 0, 0)' }}>
          <span data-testid="logo" />
        </div>
      </div>,
    );
    expect(backgroundBehind(screen.getByTestId('logo'))).toBe('#0f172a');
    expect(backgroundBehind(null)).toBeNull();
    document.body.style.backgroundColor = '';
    expect(backgroundBehind(screen.getByTestId('esterno').parentElement)).toBeNull();
  });
});

function Probe() {
  const ref = useRef<HTMLSpanElement>(null);
  const background = useBackgroundBehind(ref);
  return (
    <span ref={ref} data-testid="sonda">
      {background ?? 'ignoto'}
    </span>
  );
}

describe('useBackgroundBehind', () => {
  it('reads the background at mount and again when <html> or <body> change (palette, theme, template)', async () => {
    document.body.style.backgroundColor = '#ffffff';
    render(<Probe />);
    expect(screen.getByTestId('sonda').textContent).toBe('#ffffff');
    act(() => {
      document.body.style.backgroundColor = '#111111';
    });
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toBe('#111111'));
    act(() => {
      document.body.style.backgroundColor = '';
      document.documentElement.style.backgroundColor = '#eef2f7';
    });
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toBe('#eef2f7'));
    act(() => {
      document.documentElement.style.backgroundColor = '';
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toBe('ignoto'));
    document.documentElement.removeAttribute('data-theme');
  });
});

describe('SystemLogo and the background', () => {
  const logo = (n: number) => ({
    url: `/api/public/system-logos/00000000-0000-4000-8000-00000000000${n}`,
    mime: 'image/png' as const,
    width: 10,
    height: 10,
  });

  it('a side that goes from no logo to a logo reads the background behind it', () => {
    document.body.style.backgroundColor = '#0f172a';
    const { rerender } = render(<SystemLogo pair={{ positive: null, negative: null }} side="sinistra" />);
    expect(document.querySelector('[data-system-logo]')).toBeNull();
    rerender(<SystemLogo pair={{ positive: logo(1), negative: logo(2) }} side="sinistra" />);
    const img = document.querySelector('[data-system-logo="sinistra"]');
    expect(img?.getAttribute('data-system-logo-variant')).toBe('negative');
    expect(img?.getAttribute('src')).toBe(logo(2).url);
  });
});
