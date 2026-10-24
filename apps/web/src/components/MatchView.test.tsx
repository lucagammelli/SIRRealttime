import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { LiveMatch } from './LiveMatch.tsx';
import { MatchView } from './MatchView.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** `prefers-reduced-motion: reduce` on or off (jsdom has no matchMedia). */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const MATCH_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const snap = (patch: Partial<LiveSnapshot>): LiveSnapshot => ({
  status: 'live',
  data: null,
  error: null,
  attempts: 0,
  ...patch,
});

describe('MatchView', () => {
  it('renders every section of a match in progress', () => {
    render(<MatchView state={midMatchState()} />);
    for (const title of [
      'Andamento del set',
      'Confronto squadre',
      'Statistiche giocatori',
      'Mappe di campo',
      'Rotazioni',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(4);
  });

  it('sorts the player table and switches team and filters', () => {
    const state = stateAfter();
    render(<MatchView state={state} />);
    const table = screen.getByRole('table', { name: /Statistiche dei giocatori di Pallavolo Città/ });
    const rows = within(table).getAllByRole('row').slice(2);
    expect(rows.length).toBe(Object.keys(state.stats.home.players).length);
    fireEvent.click(within(table).getByTitle('Ordina per: Numero di maglia'));
    const numbers = within(table)
      .getAllByRole('row')
      .slice(2)
      .map((r) => Number(r.querySelector('td')?.textContent));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    const teamSwitch = screen.getAllByRole('radiogroup', { name: 'Squadra' })[0];
    fireEvent.click(within(teamSwitch as HTMLElement).getByRole('radio', { name: 'Volley Club Lugo' }));
    expect(screen.getByRole('table', { name: /Volley Club Lugo/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '# Punto' }));
    expect(screen.getByRole('radio', { name: '# Punto' }).getAttribute('aria-checked')).toBe('true');
  });

  it('big screen: scoreboard always on top, the other blocks rotate in groups every 12 s', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = render(<MatchView state={midMatchState()} device="tv" />);
    expect(container.querySelector('[data-layout="tv"]')?.className).toContain('h-full');
    expect(container.querySelector('[data-tv-area]')?.className).toContain('overflow-hidden');
    const heading = (name: string) => screen.queryByRole('heading', { name });
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    // Without a measured height every row is a group: trend + comparison, players, court + rotations.
    expect(heading('Andamento del set')).toBeTruthy();
    expect(heading('Confronto squadre')).toBeTruthy();
    expect(heading('Statistiche giocatori')).toBeNull();
    expect(screen.getByRole('img', { name: 'Schermata 1 di 3' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(heading('Statistiche giocatori')).toBeTruthy();
    expect(heading('Andamento del set')).toBeNull();
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(heading('Mappe di campo')).toBeTruthy();
    expect(heading('Rotazioni')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(heading('Andamento del set')).toBeTruthy();
  });

  it('big screen: the screens come from the layout, a content taller than its cell does not make them again', () => {
    stubReducedMotion(false);
    // Area under the scoreboard 800 px = 50 rem; the comparison has 500 px more content than its cell of 300 px.
    const proto = HTMLElement.prototype;
    const rect = vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.hasAttribute('data-tv-area') ? 800 : 0 } as DOMRect;
    });
    const size = (name: 'clientHeight' | 'scrollHeight', value: number) =>
      vi.spyOn(proto, name, 'get').mockImplementation(function (this: HTMLElement) {
        return this.dataset.tvBlock === 'comparison' ? value : 0;
      });
    const client = size('clientHeight', 300);
    const scroll = size('scrollHeight', 800);
    try {
      const { container } = render(<MatchView state={midMatchState()} device="tv" />);
      // 18 + 1 + 36 rem fit 50 rem scaled down: trend, comparison and players in the first screen, court and rotations in
      // the second.
      expect(screen.getByRole('heading', { name: 'Confronto squadre' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Statistiche giocatori' })).toBeTruthy();
      expect(screen.getByRole('img', { name: 'Schermata 1 di 2' })).toBeTruthy();
      // Rows grow in proportion to the height of their types, not in equal shares.
      const row = container.querySelector('[data-tv-block="comparison"]')?.parentElement;
      expect(row?.style.flex).toBe('18 1 0%');
    } finally {
      rect.mockRestore();
      client.mockRestore();
      scroll.mockRestore();
    }
  });

  it('big screen: two rows a little taller than the area stay in one screen, scaled down (zoom)', () => {
    stubReducedMotion(false);
    // Area 800 px = 50 rem (1 rem = 16 px in jsdom); trend and comparison need 18 rem and the players of a team 36:
    // 18 + 1 + 36 = 55 rem are more than 50 but less than 50 / 0.85 = 58.8: one screen at zoom 50 / 55.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { height: this.hasAttribute('data-tv-area') ? 800 : 0 } as DOMRect;
    });
    try {
      const { container } = render(<MatchView state={midMatchState()} device="tv" />);
      expect(screen.getByRole('heading', { name: 'Confronto squadre' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Statistiche giocatori' })).toBeTruthy();
      const shown = container.querySelector<HTMLElement>('[data-tv-area]')?.firstElementChild as HTMLElement;
      expect(Number(shown.style.zoom)).toBeCloseTo(50 / 55, 2);
    } finally {
      rect.mockRestore();
    }
  });

  it('big screen: same screens and same cells at the start of the match (empty blocks) and with the data', () => {
    stubReducedMotion(false);
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { height: this.hasAttribute('data-tv-area') ? 800 : 0 } as DOMRect;
    });
    // Empty blocks are short, blocks with the data overflow their cell: neither counts.
    let full = false;
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.tvBlock && full ? 2000 : 0;
    });
    const screens = (c: HTMLElement) => ({
      label: screen.queryByRole('img', { name: /^Schermata/ })?.getAttribute('aria-label') ?? null,
      cells: [...c.querySelectorAll<HTMLElement>('[data-tv-block]')].map(
        (cell) => `${cell.dataset.tvBlock}:${cell.parentElement?.style.flex ?? ''}`,
      ),
      zoom: c.querySelector<HTMLElement>('[data-tv-area]')?.firstElementChild?.getAttribute('style') ?? '',
    });
    try {
      const { container, rerender } = render(<MatchView state={stateAfter(0)} device="tv" />);
      const empty = screens(container);
      expect(empty.label).toBe('Schermata 1 di 2');
      full = true;
      rerender(<MatchView state={midMatchState()} device="tv" />);
      expect(screens(container)).toEqual(empty);
      // Every card fills its cell, also while empty.
      for (const cell of container.querySelectorAll('[data-tv-block]'))
        expect(cell.firstElementChild?.className).toContain('h-full');
    } finally {
      rect.mockRestore();
      scroll.mockRestore();
    }
  });

  it('big screen with reduced motion: the most important group stays, no rotation', () => {
    vi.useFakeTimers();
    stubReducedMotion(true);
    render(<MatchView state={midMatchState()} device="tv" />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('heading', { name: 'Andamento del set' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Statistiche giocatori' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Schermata/ })).toBeNull();
  });

  it('phone: sticky compact scoreboard and collapsible sections', () => {
    render(<MatchView state={midMatchState()} device="phone" />);
    expect(screen.getByRole('region', { name: 'Tabellone' }).className).toContain('sticky');
    expect(screen.getByLabelText('Dettagli del set')).toBeTruthy();
    const toggle = (name: string) => screen.getByRole('button', { name });
    // The trend starts open, the others closed.
    expect(toggle('Andamento del set').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/avanti \(sopra\)/)).toBeTruthy();
    const players = toggle('Statistiche giocatori');
    expect(players.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table', { name: /Statistiche dei giocatori/ })).toBeNull();
    const body = document.getElementById(players.getAttribute('aria-controls') ?? '');
    expect(body?.hidden).toBe(true);
    fireEvent.click(players);
    expect(players.getAttribute('aria-expanded')).toBe('true');
    expect(body?.hidden).toBe(false);
    // The wide table scrolls inside its card.
    const scroller = screen.getByRole('region', { name: /scorrevole in orizzontale/ });
    expect(scroller.className).toContain('sir-scroll-x');
    expect(within(scroller).getByRole('table')).toBeTruthy();
    fireEvent.click(toggle('Andamento del set'));
    expect(screen.queryByRole('img', { name: /Vantaggio punto per punto/ })).toBeNull();
  });

  it('phone: the page keeps the height of the sticky scoreboard free when it scrolls to an element', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 120 } as DOMRect);
    const { rerender, unmount } = render(<MatchView state={midMatchState()} device="phone" />);
    const offset = () => document.documentElement.style.getPropertyValue('--sir-sticky-offset');
    expect(offset()).toBe('132px');
    rerender(<MatchView state={midMatchState()} device="tablet" />);
    expect(offset()).toBe('');
    rerender(<MatchView state={midMatchState()} device="phone" />);
    expect(offset()).toBe('132px');
    unmount();
    expect(offset()).toBe('');
    rect.mockRestore();
  });

  it('tablet: two columns with the scoreboard on top', () => {
    const { container } = render(<MatchView state={midMatchState()} device="tablet" />);
    const grid = container.querySelector('[data-layout="tablet"]');
    expect(grid?.className).toContain('grid-cols-12');
    const cells = Array.from(grid?.children ?? []);
    expect(cells[0]?.className).toContain('@min-[1150px]:col-span-12');
    expect(within(cells[0] as HTMLElement).getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    expect(cells[1]?.className).toContain('@min-[1150px]:col-span-6');
    expect(screen.queryByRole('button', { name: 'Statistiche giocatori' })).toBeNull();
  });
});

describe('LiveMatch states', () => {
  it('shows the messages of every connection state', () => {
    const { rerender } = render(<LiveMatch snapshot={snap({ status: 'invalid' })} />);
    expect(screen.getByText('Link non valido o scaduto')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ status: 'reconnecting', attempts: 2 })} />);
    expect(screen.getByText('Server non raggiungibile')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ status: 'connecting' })} />);
    expect(screen.getByText('Connessione in corso…')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ data: { kind: 'noMatch' } })} />);
    expect(screen.getByText('Nessuna partita in corso')).toBeTruthy();
    expect(screen.getByText('In diretta')).toBeTruthy();
    rerender(
      <LiveMatch
        snapshot={snap({
          status: 'reconnecting',
          data: { kind: 'state', matchId: MATCH_ID, version: 1, state: midMatchState() },
        })}
      />,
    );
    expect(screen.getByText('Riconnessione…')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
  });

  it('says «Risultato finale» instead of «In diretta» once the match is over', () => {
    const final = { kind: 'state', matchId: MATCH_ID, version: 9, state: stateAfter() } as const;
    const { rerender } = render(<LiveMatch snapshot={snap({ data: final })} />);
    expect(screen.getByText('Partita conclusa')).toBeTruthy();
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    expect(screen.queryByText('In diretta')).toBeNull();
    rerender(<LiveMatch snapshot={snap({ status: 'reconnecting', data: final })} />);
    expect(screen.getByText('Riconnessione…')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ data: { ...final, state: midMatchState() } })} />);
    expect(screen.getByText('In diretta')).toBeTruthy();
  });
});
