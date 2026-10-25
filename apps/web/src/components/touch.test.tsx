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

describe('«Touch: No»: only the big screen is cut', () => {
  const SCROLL = '.overflow-y-auto, .overflow-auto, .overflow-scroll, .sir-scroll-x, [role="region"][tabindex]';
  const offAll = TenantLayoutSchema.parse({ touch: { tv: false, tablet: false, phone: false } });

  it('screensFor: only the big screen is laid out in screens', () => {
    expect(screensFor('tv')).toBe(true);
    expect(screensFor('tablet')).toBe(false);
    expect(screensFor('phone')).toBe(false);
    expect(screensFor(undefined)).toBe(false);
  });

  it('phone and tablet without touch: the same column or grid, scrolling and contents as with touch, no controls', () => {
    for (const device of ['tablet', 'phone'] as const) {
      const off = render(<MatchView state={stateAfter()} device={device} layout={offAll} />);
      expect(off.container.querySelector(`[data-layout="${device}"]`)).toBeTruthy();
      expect(off.container.querySelector('[data-layout="screens"], [data-layout="tv"], [data-tv-block]')).toBeNull();
      expect(off.container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
      // Scrolls as with touch (table, partials), no card cut by a cell.
      expect(off.container.querySelector('.sir-scroll-x')).toBeTruthy();
      expect(off.container.querySelector('[style*="scale"]')).toBeNull();
      // Words of every card: those of the touch page (without its selectors) must all be there without touch.
      const textsOf = (root: HTMLElement, controls: string): string[] =>
        [...root.querySelectorAll('.sir-card')].map((card) => {
          const copy = card.cloneNode(true) as HTMLElement;
          if (controls) copy.querySelectorAll(controls).forEach((el) => el.remove());
          return copy.textContent ?? '';
        });
      const offTexts = textsOf(off.container, '');
      off.unmount();
      const on = render(<MatchView state={stateAfter()} device={device} layout={TenantLayoutSchema.parse({})} />);
      const onTexts = textsOf(on.container, '[role="radiogroup"], select, summary, label');
      expect(offTexts.length).toBeGreaterThan(0);
      expect(onTexts).toHaveLength(offTexts.length);
      onTexts.forEach((text, i) => {
        const words = text.match(/\p{L}{4,}/gu) ?? [];
        expect(words.length).toBeGreaterThan(0);
        expect(words.filter((w) => !(offTexts[i] ?? '').includes(w))).toEqual([]);
      });
      on.unmount();
    }
  });

  it('big screen without touch: screens of full size cards cut by their cell, never scaled nor scrolling; with touch they scroll in the cell', () => {
    const { container } = render(<MatchView state={stateAfter()} device="tv" layout={offAll} />);
    expect(container.querySelector('[data-layout="tv"]')).toBeTruthy();
    const cells = [...container.querySelectorAll('[data-tv-block]')];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.getAttribute('data-touch')).toBe('false');
    expect(container.querySelector('[style*="scale"]')).toBeNull();
    expect(container.querySelector('.sir-card-body')).toBeTruthy();
    expect(container.querySelector(SCROLL)).toBeNull();
    const tv = render(<MatchView state={stateAfter()} device="tv" layout={TenantLayoutSchema.parse({})} />);
    expect(tv.container.querySelector('[data-tv-block]')?.getAttribute('data-touch')).toBe('true');
    expect(tv.container.querySelector('[style*="scale"]')).toBeNull();
  });
});
