import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { stateAfter } from '../test/fixtures.ts';
import { Rotations } from './Rotations.tsx';

afterEach(cleanup);

const grid = (c: HTMLElement): HTMLElement => {
  const el = c.querySelector('.grid');
  if (!(el instanceof HTMLElement)) throw new Error('no grid');
  return el;
};

describe('Rotations', () => {
  it('puts the two charts side by side when the card is wide, by default', () => {
    const { container } = render(<Rotations state={stateAfter()} />);
    expect(grid(container).className).toContain('@md:grid-cols-2');
  });

  it('with the vertical orientation puts one chart above the other', () => {
    const { container } = render(<Rotations state={stateAfter()} orientation="vertical" />);
    expect(container.querySelector('.grid-cols-2, [class*="grid-cols-2"]')).toBeNull();
    const column = container.querySelector('.\\@container > .flex-col');
    expect(column?.className).toContain('flex-1');
  });

  it('with the vertical orientation the charts share the height of the card', () => {
    const { container } = render(<Rotations state={stateAfter()} orientation="vertical" />);
    const charts = container.querySelectorAll('.\\@container .flex-1.min-h-44');
    expect(charts).toHaveLength(2);
  });
});
