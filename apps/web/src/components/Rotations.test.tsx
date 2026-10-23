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
    expect(grid(container).className).not.toContain('grid-cols-2');
  });
});
