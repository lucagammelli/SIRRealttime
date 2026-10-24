import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SponsorImage } from '../blocks/BrandBlocks.tsx';
import { DeviceContext, TouchContext } from '../lib/useLayout.ts';
import { stateAfter } from '../test/fixtures.ts';
import { TenantLayoutSchema } from '@arenalive/shared';
import { CourtMap } from './CourtMap.tsx';
import { screensFor } from './LiveMatch.tsx';
import { MatchView } from './MatchView.tsx';
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

describe('«Touch: No»: never a scroll bar', () => {
  const SCROLL = '.overflow-y-auto, .overflow-auto, .overflow-scroll, .sir-scroll-x, [role="region"][tabindex]';

  it('screensFor: the big screen always, phone and tablet only with the «Touch» of the layout off', () => {
    const off = TenantLayoutSchema.parse({ touch: { tv: true, tablet: false, phone: false } });
    const on = TenantLayoutSchema.parse({});
    expect(screensFor('tv', null)).toBe(true);
    expect(screensFor('tablet', off)).toBe(true);
    expect(screensFor('phone', off)).toBe(true);
    expect(screensFor('tablet', on)).toBe(false);
    expect(screensFor('phone', null)).toBe(false);
    expect(screensFor(undefined, off)).toBe(false);
  });

  it('every device without touch: screens of full size cards cut by their cell, never scaled nor scrolling; with touch as before', () => {
    const off = TenantLayoutSchema.parse({ touch: { tv: false, tablet: false, phone: false } });
    for (const device of ['tv', 'tablet', 'phone'] as const) {
      const { container, unmount } = render(<MatchView state={stateAfter()} device={device} layout={off} />);
      expect(container.querySelector(device === 'tv' ? '[data-layout="tv"]' : '[data-layout="screens"]')).toBeTruthy();
      const cells = [...container.querySelectorAll('[data-tv-block]')];
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) expect(cell.getAttribute('data-touch')).toBe('false');
      // Full size from the first paint: no scale that starts small and grows (v2.6.4), the excess is cut.
      expect(container.querySelector('[style*="scale"]')).toBeNull();
      expect(container.querySelector('.sir-card-body')).toBeTruthy();
      expect(container.querySelector(SCROLL)).toBeNull();
      unmount();
    }
    const on = render(<MatchView state={stateAfter()} device="tablet" layout={TenantLayoutSchema.parse({})} />);
    expect(on.container.querySelector('[data-layout="tablet"]')).toBeTruthy();
    expect(on.container.querySelector('[style*="scale"]')).toBeNull();
    expect(on.container.querySelector('.sir-scroll-x')).toBeTruthy();
    on.unmount();
    const tv = render(<MatchView state={stateAfter()} device="tv" layout={TenantLayoutSchema.parse({})} />);
    expect(tv.container.querySelector('[data-tv-block]')?.getAttribute('data-touch')).toBe('true');
    expect(tv.container.querySelector('[style*="scale"]')).toBeNull();
  });
});
