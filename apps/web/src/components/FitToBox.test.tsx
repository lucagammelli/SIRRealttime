import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FIT_MIN_SCALE, FitCellContext, FitToBox, fitRows, rowsAround, MoreRows, useFitRows } from './FitToBox.tsx';
import { StandingsOptionsSchema } from '@arenalive/shared';
import { StandingsView } from '../blocks/CalendarBlocks.tsx';
import { SAMPLE_SCHEDULE } from '../blocks/sampleSchedule.ts';
import { TouchContext } from '../lib/useLayout.ts';
import { Card } from './ui.tsx';

describe('fitRows', () => {
  it('all the rows without a limit or under it; with a limit the first ones (at least one) and the rest left out', () => {
    expect(fitRows(5, null)).toEqual({ shown: 5, hidden: 0 });
    expect(fitRows(5, 8)).toEqual({ shown: 5, hidden: 0 });
    expect(fitRows(10, 6)).toEqual({ shown: 6, hidden: 4 });
    expect(fitRows(3, 0)).toEqual({ shown: 1, hidden: 2 });
  });
});

describe('rowsAround', () => {
  it('without an anchor the first rows; with one the rows around it, moved inside the list at its ends', () => {
    expect(rowsAround(10, 4, -1)).toEqual({ start: 0, end: 4, above: 0, below: 6 });
    expect(rowsAround(10, 4, 5)).toEqual({ start: 4, end: 8, above: 4, below: 2 });
    expect(rowsAround(10, 4, 0)).toEqual({ start: 0, end: 4, above: 0, below: 6 });
    expect(rowsAround(10, 4, 9)).toEqual({ start: 6, end: 10, above: 6, below: 0 });
    expect(rowsAround(3, 5, 1)).toEqual({ start: 0, end: 3, above: 0, below: 0 });
  });
});

describe('MoreRows', () => {
  it('«+N» visible, the full sense for the screen readers; nothing with 0', () => {
    const { container } = render(
      <>
        <MoreRows hidden={4} />
        <MoreRows hidden={1} of="teams" />
        <MoreRows hidden={0} />
      </>,
    );
    expect(container.querySelectorAll('[data-fit-more]')).toHaveLength(2);
    expect(screen.getByText('+4')).toBeTruthy();
    expect(screen.getByText('Altri 4 giocatori non mostrati')).toBeTruthy();
    expect(screen.getByText('Un’altra squadra non mostrata')).toBeTruthy();
  });
});

/**
 * Layout of jsdom: the box is 1000 × 500 px; the content is laid out in its `style` size (`size / scale`) and is
 * 100 px + 100 px per list row tall, whatever its width (so a scale makes room for more rows).
 */
const props = ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const;
const saved = props.map((p) => [p, Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)] as const);
function fakeLayout(): void {
  const isBox = (el: HTMLElement): boolean => el.hasAttribute('data-fit-box');
  const isContent = (el: HTMLElement): boolean => el.classList.contains('sir-fit');
  const define = (p: (typeof props)[number], get: (el: HTMLElement) => number): void => {
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this);
      },
    });
  };
  define('clientWidth', (el) => (isBox(el) ? 1000 : isContent(el) ? Number.parseFloat(el.style.width) || 1000 : 0));
  define('clientHeight', (el) => (isBox(el) ? 500 : isContent(el) ? Number.parseFloat(el.style.height) || 500 : 0));
  // `data-wide`: content always 3000 px wide (only the width is missing).
  define('scrollWidth', (el) =>
    isContent(el) ? (el.querySelector('[data-wide]') ? 3000 : Number.parseFloat(el.style.width) || 1000) : 0,
  );
  define('scrollHeight', (el) => (isContent(el) ? 100 + 100 * el.querySelectorAll('li, tbody tr').length : 0));
}

afterEach(() => {
  cleanup();
  for (const [p, d] of saved) {
    if (d) Object.defineProperty(HTMLElement.prototype, p, d);
    else Reflect.deleteProperty(HTMLElement.prototype, p);
  }
});

function List({ count }: { count: number }) {
  const fit = useFitRows(count);
  return (
    <ol data-fit-list={count}>
      {Array.from({ length: fit.shown }, (_, i) => (
        <li key={i}>Giocatore {i + 1}</li>
      ))}
      {fit.hidden > 0 && (
        <li>
          <MoreRows hidden={fit.hidden} />
        </li>
      )}
    </ol>
  );
}

const scaleOf = (container: HTMLElement): number =>
  Number(container.querySelector<HTMLElement>('.sir-fit')?.dataset.scale);

describe('FitToBox', () => {
  it('without measures (no layout) the content is not scaled and the lists are whole', () => {
    const { container } = render(
      <FitToBox>
        <List count={20} />
      </FitToBox>,
    );
    expect(Number.isNaN(scaleOf(container))).toBe(true);
    expect(container.querySelectorAll('li')).toHaveLength(20);
  });

  it('content that fits: scale 1, nothing left out', () => {
    fakeLayout();
    const { container } = render(
      <FitToBox>
        <List count={3} />
      </FitToBox>,
    );
    expect(scaleOf(container)).toBe(1);
    expect(container.querySelector('[data-fit-more]')).toBeNull();
  });

  it('content taller than the box: scaled down, the largest scale that fits, all the rows', () => {
    fakeLayout();
    const { container } = render(
      <FitToBox>
        <List count={5} />
      </FitToBox>,
    );
    const scale = scaleOf(container);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(FIT_MIN_SCALE);
    expect(scale).toBeCloseTo(500 / 600, 2);
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.querySelector<HTMLElement>('.sir-fit')?.style.transform).toMatch(/^scale\(0\.83/);
  });

  it('not even at the smallest scale: the last rows become «+N»', () => {
    fakeLayout();
    const { container } = render(
      <FitToBox>
        <List count={10} />
      </FitToBox>,
    );
    // At 0.5 the content has 1000 px: 8 rows and the «+2» row (1000 px).
    expect(scaleOf(container)).toBeGreaterThanOrEqual(FIT_MIN_SCALE);
    expect(container.querySelector('[data-fit-more]')?.getAttribute('data-fit-more')).toBe('2');
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.queryByText('Giocatore 9')).toBeNull();
  });

  it('content without lists: scaled down to the minimum scale, no lower', () => {
    fakeLayout();
    const { container } = render(
      <FitToBox>
        <ul>
          {Array.from({ length: 20 }, (_, i) => (
            <li key={i}>Riga {i + 1}</li>
          ))}
        </ul>
      </FitToBox>,
    );
    expect(scaleOf(container)).toBe(FIT_MIN_SCALE);
    expect(container.querySelectorAll('li')).toHaveLength(20);
  });

  it('only the width missing: scaled down, never a row less', () => {
    fakeLayout();
    const { container } = render(
      <FitToBox>
        <div data-wide="">
          <List count={3} />
        </div>
      </FitToBox>,
    );
    expect(scaleOf(container)).toBe(FIT_MIN_SCALE);
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('[data-fit-more]')).toBeNull();
  });

  it('«Classifica» too long: our team always visible, the rows farthest from it go, «+N» above and below', () => {
    fakeLayout();
    const standings = SAMPLE_SCHEDULE.standings;
    if (!standings) throw new Error('classifica mancante');
    const { container } = render(
      <FitToBox>
        <StandingsView standings={standings} options={StandingsOptionsSchema.parse({ scope: 'all' })} size="card" />
      </FitToBox>,
    );
    const shown = [...container.querySelectorAll('tbody tr:not(:has([data-fit-more]))')];
    const ours = standings.rows.find((r) => r.ours);
    expect(ours).toBeTruthy();
    expect(shown.some((tr) => tr.getAttribute('aria-current') === 'true')).toBe(true);
    const more = [...container.querySelectorAll('[data-fit-more]')].map((el) =>
      Number(el.getAttribute('data-fit-more')),
    );
    expect(more.length).toBeGreaterThan(0);
    expect(shown.length + more.reduce((a, b) => a + b, 0)).toBe(standings.rows.length);
    expect(screen.getAllByText(/squadr[ae] non mostrat[ae]/).length).toBe(more.length);
  });
});

describe('Card in a cell of a screen', () => {
  const draw = (touch: boolean, cell: boolean) =>
    render(
      <TouchContext.Provider value={touch}>
        <FitCellContext.Provider value={cell}>
          <Card title="Attacco" bodyClassName="flex flex-col">
            <List count={5} />
          </Card>
        </FitCellContext.Provider>
      </TouchContext.Provider>,
    );

  it('without touch the body fits its content (no scrolling), the classes of the body go to the content', () => {
    const { container } = draw(false, true);
    const body = container.querySelector('.sir-card-body');
    expect(body?.hasAttribute('data-fit')).toBe(true);
    expect(body?.className).not.toContain('flex-col');
    expect(container.querySelector('.sir-fit')?.className).toContain('flex flex-col');
    expect(container.querySelector('.overflow-y-auto, .overflow-auto, .overflow-scroll, .sir-scroll-x')).toBeNull();
  });

  it('with touch, or outside a cell, as before: no box', () => {
    for (const [touch, cell] of [
      [true, true],
      [false, false],
    ] as const) {
      const { container } = draw(touch, cell);
      expect(container.querySelector('[data-fit-box]')).toBeNull();
      expect(container.querySelector('.sir-card-body')?.className).toContain('flex flex-col');
      cleanup();
    }
  });
});
