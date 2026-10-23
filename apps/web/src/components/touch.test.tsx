import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SponsorImage } from '../blocks/BrandBlocks.tsx';
import { DeviceContext, TouchContext } from '../lib/useLayout.ts';
import { stateAfter } from '../test/fixtures.ts';
import { CourtMap } from './CourtMap.tsx';
import { MomentumChart } from './MomentumChart.tsx';
import { PlayerTable } from './PlayerTable.tsx';
import { Rotations } from './Rotations.tsx';
import { TeamComparison } from './TeamComparison.tsx';

afterEach(cleanup);

const INTERACTIVE = 'button, select, a, input, summary';

describe('option «Touch: No»', () => {
  it.each([
    ['CourtMap', <CourtMap key="c" state={stateAfter()} />],
    ['PlayerTable', <PlayerTable key="p" state={stateAfter()} />],
    ['MomentumChart', <MomentumChart key="m" state={stateAfter()} />],
    ['Rotations', <Rotations key="r" state={stateAfter()} />],
    ['TeamComparison', <TeamComparison key="t" state={stateAfter()} />],
  ])('%s has nothing to tap or click, on the phone too', (_name, node) => {
    for (const device of ['tablet', 'phone'] as const) {
      const { container, unmount } = render(
        <DeviceContext.Provider value={device}>
          <TouchContext.Provider value={false}>{node}</TouchContext.Provider>
        </DeviceContext.Provider>,
      );
      expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
      unmount();
    }
  });

  it('with touch the same components have their selectors', () => {
    const { container } = render(<PlayerTable state={stateAfter()} />);
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('a sponsor image is not a link', () => {
    const item = { src: '/x.png', website: 'https://example.com', name: 'X' };
    const on = render(<SponsorImage item={item} alt="x" className="" />);
    expect(on.container.querySelector('a')).toBeTruthy();
    on.unmount();
    const off = render(
      <TouchContext.Provider value={false}>
        <SponsorImage item={item} alt="x" className="" />
      </TouchContext.Provider>,
    );
    expect(off.container.querySelector('a')).toBeNull();
  });
});
