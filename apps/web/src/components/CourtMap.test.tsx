import { CourtOptionsSchema } from '@arenalive/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimOurSide } from '../lib/branding.ts';
import { stateAfter } from '../test/fixtures.ts';
import { courtSteps } from '../lib/courtCycle.ts';
import { TouchContext } from '../lib/useLayout.ts';
import { CourtMap } from './CourtMap.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const svg = (c: HTMLElement): SVGSVGElement => {
  const el = c.querySelector('svg');
  if (!el) throw new Error('no svg');
  return el;
};

describe('court map options', () => {
  it('tricolour: three bands of two columns, the white one on the net, readable lines', () => {
    const options = CourtOptionsSchema.parse({ fieldMode: 'tricolor' });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    const root = svg(container);
    const bands = [...root.querySelectorAll('rect[data-court-band]')];
    expect(bands.map((b) => b.getAttribute('fill'))).toEqual(['#009246', '#ffffff', '#ce2b37']);
    expect(bands.map((b) => b.getAttribute('x'))).toEqual(['10', '70', '130']);
    expect(bands.every((b) => b.getAttribute('width') === '60')).toBe(true);
    expect(root.querySelectorAll('rect.fill-court').length).toBe(0);
    expect(root.querySelector('line[stroke="#1f2937"]')).toBeTruthy();
  });

  it('single colour: both halves the same', () => {
    const options = CourtOptionsSchema.parse({ fieldMode: 'single', fieldColor: '#112233' });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    expect(svg(container).querySelectorAll('rect[fill="#112233"]').length).toBe(2);
  });

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

  it('as the scoreboard: home on the left also when the map shows away, the halves keep the colours of their team', () => {
    const options = CourtOptionsSchema.parse({ side: 'away', fieldOurs: '#112233', fieldOpponent: '#445566' });
    const state = stateAfter();
    const { container } = render(<CourtMap state={state} options={options} />);
    const root = svg(container);
    expect(root.getAttribute('data-court-side')).toBe('away');
    expect(root.querySelector('[data-court-left]')?.getAttribute('data-court-left')).toBe('home');
    expect(root.querySelector('[data-court-right]')?.getAttribute('data-court-right')).toBe('away');
    // home (ours when none is known) keeps its colour on the left
    expect(root.querySelector('rect[x="10"][y="10"]')?.getAttribute('fill')).toBe('#112233');
    // the away arrows start in the right half and end in the left one
    const arrows = [...root.querySelectorAll('path[marker-end]')];
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      const [x1, , , , x2] = (a.getAttribute('d') ?? '').replace(/[MQ]/g, '').trim().split(/\s+/).map(Number);
      expect(x1).toBeGreaterThan(100);
      expect(x2).toBeLessThan(100);
    }
    expect(container.textContent).toContain(`${state.teams.away.name} → ${state.teams.home.name}`);
  });

  it('as the scoreboard the home arrows go from left to right', () => {
    const { container } = render(<CourtMap state={stateAfter()} />);
    const arrows = [...svg(container).querySelectorAll('path[marker-end]')];
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      const [x1, , , , x2] = (a.getAttribute('d') ?? '').replace(/[MQ]/g, '').trim().split(/\s+/).map(Number);
      expect(x1).toBeLessThan(100);
      expect(x2).toBeGreaterThan(100);
    }
  });

  it('«Squadra mostrata sempre a sinistra»: the away team on the left, attacking to the right', () => {
    const options = CourtOptionsSchema.parse({ side: 'away', orientation: 'shown', fieldOurs: '#112233' });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    const root = svg(container);
    expect(root.querySelector('[data-court-left]')?.getAttribute('data-court-left')).toBe('away');
    expect(root.querySelector('rect[x="100"][y="10"]')?.getAttribute('fill')).toBe('#112233');
    for (const a of root.querySelectorAll('path[marker-end]')) {
      const [x1, , , , x2] = (a.getAttribute('d') ?? '').replace(/[MQ]/g, '').trim().split(/\s+/).map(Number);
      expect(x1).toBeLessThan(100);
      expect(x2).toBeGreaterThan(100);
    }
  });

  it('no action: the message stands on a band above the field', () => {
    const { container } = render(<CourtMap state={stateAfter(0)} />);
    const empty = svg(container).querySelector('[data-court-empty]');
    expect(empty?.querySelector('rect.fill-surface')).toBeTruthy();
    expect(empty?.textContent).toBe('Nessuna azione con zone per questo filtro');
    // drawn last, above net and cells
    expect(svg(container).lastElementChild).toBe(empty);
  });

  it('on the big screen fits the field to the height of the card instead of scrolling', () => {
    const { container } = render(<CourtMap state={stateAfter()} fit />);
    expect(container.querySelector('.sir-card-body')?.className).toContain('flex-col');
    expect(container.querySelector('svg[viewBox="0 0 200 110"]')?.getAttribute('class')).toContain('flex-1');
  });
});

describe('court map without touch (TV): team and skill chosen in the Studio, in turn', () => {
  const view = (c: HTMLElement) => {
    const root = svg(c);
    return `${root.getAttribute('data-court-side')}-${root.getAttribute('data-court-skill')}`;
  };
  const tv = (input: Record<string, unknown>) => {
    const options = CourtOptionsSchema.parse(input);
    return render(
      <TouchContext.Provider value={false}>
        <CourtMap state={stateAfter()} options={options} />
      </TouchContext.Provider>,
    );
  };

  it('the views in turn: for each skill every team', () => {
    expect(courtSteps('cycle', 'cycle', null)).toEqual([
      { side: 'home', skill: 'attack' },
      { side: 'away', skill: 'attack' },
      { side: 'home', skill: 'serve' },
      { side: 'away', skill: 'serve' },
    ]);
    expect(courtSteps('ours', 'serve', 'away')).toEqual([{ side: 'away', skill: 'serve' }]);
    expect(courtSteps('ours', 'attack', null)).toEqual([{ side: 'home', skill: 'attack' }]);
    expect(courtSteps('away', 'cycle', 'home')).toEqual([
      { side: 'away', skill: 'attack' },
      { side: 'away', skill: 'serve' },
    ]);
  });

  it('by default home and away go in turn every 10 seconds, the subtitle says whose map it is', () => {
    vi.useFakeTimers();
    const { container } = tv({});
    const state = stateAfter();
    expect(view(container)).toBe('home-attack');
    expect(container.textContent).toContain(`${state.teams.home.name} → ${state.teams.away.name} · a turno`);
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(view(container)).toBe('home-attack');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view(container)).toBe('away-attack');
    expect(container.textContent).toContain(`${state.teams.away.name} → ${state.teams.home.name}`);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view(container)).toBe('home-attack');
  });

  it('both in turn: home attack, away attack, home serve, away serve, with the seconds chosen', () => {
    vi.useFakeTimers();
    const { container } = tv({ side: 'cycle', skill: 'cycle', cycleSeconds: 5 });
    const seen = [view(container)];
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      seen.push(view(container));
    }
    expect(seen).toEqual(['home-attack', 'away-attack', 'home-serve', 'away-serve', 'home-attack']);
  });

  it('«Solo la nostra squadra»: our team, also when it plays away; one view, nothing in turn', () => {
    vi.useFakeTimers();
    const release = claimOurSide('away');
    const { container } = tv({ side: 'ours', skill: 'serve' });
    expect(view(container)).toBe('away-serve');
    expect(container.textContent).not.toContain('a turno');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(view(container)).toBe('away-serve');
    release();
  });

  it('with touch the filters stay and start from the view chosen; nothing goes in turn', () => {
    vi.useFakeTimers();
    const options = CourtOptionsSchema.parse({ side: 'away', skill: 'serve' });
    const { container } = render(<CourtMap state={stateAfter()} options={options} />);
    expect(view(container)).toBe('away-serve');
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(view(container)).toBe('away-serve');
    fireEvent.click(screen.getByRole('radio', { name: 'Attacco' }));
    expect(view(container)).toBe('away-attack');
  });
});
