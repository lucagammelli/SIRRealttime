import { CourtOptionsSchema } from '@arenalive/shared';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { claimOurSide } from '../lib/branding.ts';
import { stateAfter } from '../test/fixtures.ts';
import { CourtMap } from './CourtMap.tsx';

afterEach(cleanup);

const svg = (c: HTMLElement): SVGSVGElement => {
  const el = c.querySelector('svg');
  if (!el) throw new Error('no svg');
  return el;
};

describe('court map options', () => {
  it('without options draws the field and lines of the theme', () => {
    const { container } = render(<CourtMap state={stateAfter()} />);
    const root = svg(container);
    expect(root.querySelectorAll('rect.fill-court').length).toBe(2);
    expect(root.querySelectorAll('[stroke]:not(path[stroke="none"])').length).toBe(0);
    expect(root.querySelectorAll('rect[fill^="#"]').length).toBe(0);
    expect(root.querySelector('line.stroke-court-line[stroke-width="1.8"]')).toBeTruthy();
    expect(root.querySelector('path.stroke-court-line[stroke-width="1"]')).toBeTruthy();
  });

  it('colours the two halves, the lines and scales their thickness', () => {
    const options = CourtOptionsSchema.parse({
      fieldOurs: '#112233',
      fieldOpponent: '#445566',
      linesOurs: '#ff0000',
      linesOpponent: '#00ff00',
      lineWidth: 2,
    });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    const root = svg(container);
    // the map starts on the home team, which is ours when none is known: left half = ours
    expect(root.querySelectorAll('rect[fill="#112233"]').length).toBe(1);
    expect(root.querySelectorAll('rect[fill="#445566"]').length).toBe(1);
    expect(root.querySelectorAll('path[stroke="#ff0000"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('path[stroke="#00ff00"]').length).toBeGreaterThan(0);
    expect(root.querySelector('line[stroke="#ff0000"][stroke-width="3.6"]')).toBeTruthy();
    expect(root.querySelector('path[stroke="#ff0000"][stroke-width="2"]')).toBeTruthy();
  });

  it('draws the arrows of the team in the chosen colour and thickness', () => {
    const options = CourtOptionsSchema.parse({ arrowsOurs: '#123456', arrowWidth: 2 });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    const arrows = [...svg(container).querySelectorAll('path[stroke="#123456"][fill="none"]')];
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows[0]?.getAttribute('stroke-width')).toBe('3');
  });

  it('swaps ours and opponent when our team is claimed after the render', () => {
    const options = CourtOptionsSchema.parse({ fieldOurs: '#112233', fieldOpponent: '#445566' });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    const leftFill = () => svg(container).querySelector('rect[x="10"]')?.getAttribute('fill');
    const before = leftFill();
    expect(before).toBe('#112233');
    let release = (): void => {};
    act(() => {
      release = claimOurSide('away');
    });
    expect(leftFill()).toBe('#445566');
    act(release);
  });
});
