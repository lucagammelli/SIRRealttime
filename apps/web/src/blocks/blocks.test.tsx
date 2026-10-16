import type { LayoutBlockInput, TenantLayout } from '@sir/shared';
import { BLOCK_OPTIONS, BLOCK_TYPES, BLOCK_WIDTHS, TenantLayoutSchema } from '@sir/shared';
import { topPlayers } from '@sir/volley-stats';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchView } from '../components/MatchView.tsx';
import { playerName } from '../lib/format.ts';
import { midMatchState } from '../test/fixtures.ts';
import { shortCodeOf } from './BrandBlocks.tsx';
import { BLOCKS, missingTypes, REGISTRY_TYPES } from './registry.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));
// The QR itself is tested in qr/: here only what the block asks to encode.
vi.mock('../qr/ShareQr.tsx', () => ({
  ShareQr: ({ url, code }: { url: string; code?: string }) => (
    <div data-testid="qr" data-url={url} data-code={code ?? ''} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const IMG_A = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const IMG_B = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const LOOK = { name: 'Sir Safety', logoMain: '/api/public/assets/main', logoMark: '/api/public/assets/mark' };

const layoutOf = (blocks: LayoutBlockInput[], device: 'tv' | 'tablet' | 'phone' = 'tablet'): TenantLayout =>
  TenantLayoutSchema.parse({ [device]: blocks });

describe('block registry', () => {
  it('has a definition for every type of the contract, with its widths and options', () => {
    expect(missingTypes()).toEqual([]);
    expect([...REGISTRY_TYPES].sort()).toEqual([...BLOCK_TYPES].sort());
    for (const type of BLOCK_TYPES) {
      const def = BLOCKS[type];
      expect(def.type).toBe(type);
      expect(def.widths).toBe(BLOCK_WIDTHS[type]);
      expect(def.options).toBe(BLOCK_OPTIONS[type]);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it('draws every type of block on the page', () => {
    const blocks = BLOCK_TYPES.map((type) => ({ id: type, type }));
    render(<MatchView state={midMatchState()} device="tablet" layout={layoutOf(blocks)} look={LOOK} />);
    for (const title of [
      'Andamento del set',
      'Confronto squadre',
      'Statistiche giocatori',
      'Mappe di campo',
      'Rotazioni',
      'Ultimo punto',
      'Parziali dei set',
      'Migliori giocatori',
      'Sponsor',
      'Segui la partita sul telefono',
    ])
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    expect(screen.getByText('Benvenuti al palazzetto!')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Sir Safety' }).getAttribute('src')).toBe(LOOK.logoMain);
  });
});

describe('layout of the client on the three devices', () => {
  const layout = TenantLayoutSchema.parse({
    tv: [
      { id: 'tab', type: 'scoreboard' },
      { id: 'msg', type: 'message', width: 8, options: { text: 'Forza Sir!' } },
      { id: 'qr', type: 'qr', width: 4 },
      { id: 'nascosto', type: 'players', visible: false },
    ],
    tablet: [
      { id: 'msg', type: 'message', width: 4, options: { text: 'Forza Sir!' } },
      { id: 'tab', type: 'scoreboard' },
      { id: 'top', type: 'topPlayers', width: 8 },
    ],
    phone: [
      { id: 'tab', type: 'scoreboard' },
      { id: 'last', type: 'lastPoint' },
      { id: 'top', type: 'topPlayers', collapsed: true },
    ],
  });

  it('tv: the scoreboard on top, the other visible blocks side by side in the 12 columns', () => {
    const { container } = render(<MatchView state={midMatchState()} device="tv" layout={layout} />);
    expect(container.querySelector('[data-layout="tv"]')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    const area = container.querySelector('[data-tv-area]') as HTMLElement;
    const row = area.querySelector('.grid-cols-12') as HTMLElement;
    expect(Array.from(row.children).map((c) => c.className.match(/col-span-\d+/)?.[0])).toEqual([
      'col-span-8',
      'col-span-4',
    ]);
    expect(within(area).getByText('Forza Sir!')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Statistiche giocatori' })).toBeNull();
  });

  it('tablet: the order and the widths of the client (desktop), half or full on a tablet in landscape', () => {
    const { container } = render(<MatchView state={midMatchState()} device="tablet" layout={layout} />);
    const cells = Array.from(container.querySelector('[data-layout="tablet"]')?.children ?? []);
    expect(cells.map((c) => c.className.match(/@min-\[1150px\]:col-span-(\d+)/)?.[1])).toEqual(['4', '12', '8']);
    expect(cells.map((c) => c.className.match(/@min-\[856px\]:col-span-(\d+)/)?.[1])).toEqual(['6', '12', '12']);
    expect(cells.every((c) => /(^| )col-span-12( |$)/.test(c.className))).toBe(true);
    expect(within(cells[0] as HTMLElement).getByText('Forza Sir!')).toBeTruthy();
    expect(within(cells[1] as HTMLElement).getByRole('region', { name: 'Tabellone' })).toBeTruthy();
  });

  it('phone: one column, the sections closed as chosen', () => {
    render(<MatchView state={midMatchState()} device="phone" layout={layout} />);
    expect(screen.getByRole('button', { name: 'Ultimo punto' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Migliori giocatori' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Andamento del set' })).toBeNull();
  });
});

describe('new blocks', () => {
  it('sponsor: the images rotate every chosen seconds, and stop with the rotation', () => {
    vi.useFakeTimers();
    const layout = layoutOf([{ id: 's', type: 'sponsor', options: { images: [IMG_A, IMG_B], seconds: 5 } }]);
    const { rerender } = render(<MatchView state={midMatchState()} device="tablet" layout={layout} />);
    const shown = () => screen.getByRole('img', { name: /^Sponsor/ });
    expect(shown().getAttribute('src')).toBe(`/api/public/assets/${IMG_A}`);
    expect(shown().getAttribute('alt')).toBe('Sponsor 1 di 2');
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(shown().getAttribute('src')).toBe(`/api/public/assets/${IMG_A}`);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(shown().getAttribute('src')).toBe(`/api/public/assets/${IMG_B}`);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(shown().getAttribute('src')).toBe(`/api/public/assets/${IMG_A}`);
    rerender(<MatchView state={midMatchState()} device="tablet" layout={layout} rotationPaused />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(shown().getAttribute('src')).toBe(`/api/public/assets/${IMG_A}`);
  });

  it('message: the text of the client is shown as text, never as HTML', () => {
    const text = '<b>ciao</b><img src=x onerror=alert(1)><script>alert(1)</script>';
    const { container } = render(
      <MatchView
        state={midMatchState()}
        device="tablet"
        layout={layoutOf([{ id: 'm', type: 'message', options: { text } }])}
      />,
    );
    expect(screen.getByText(text)).toBeTruthy();
    expect(container.querySelector('b, script, img')).toBeNull();
  });

  it('qr: the address of the page, the short code when opened with it, without query', () => {
    const layout = layoutOf([{ id: 'q', type: 'qr' }]);
    const { unmount } = render(
      <MatchView
        state={midMatchState()}
        device="tablet"
        layout={layout}
        pageUrl="https://sir.example.org/l/K7M2QX9P"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Segui la partita sul telefono' })).toBeTruthy();
    expect(screen.getByTestId('qr').dataset).toMatchObject({
      url: 'https://sir.example.org/l/K7M2QX9P',
      code: 'K7M2QX9P',
    });
    unmount();
    window.history.replaceState(null, '', '/l/ABCD2345?tv=1#x');
    const second = render(<MatchView state={midMatchState()} device="tablet" layout={layout} />);
    expect(screen.getByTestId('qr').dataset).toMatchObject({
      url: `${window.location.origin}/l/ABCD2345`,
      code: 'ABCD2345',
    });
    second.unmount();
    const token = 'abcdefghijklmnopqrstuvwxyz012345';
    window.history.replaceState(null, '', `/live/${token}`);
    render(<MatchView state={midMatchState()} device="tablet" layout={layout} />);
    expect(screen.getByTestId('qr').dataset).toMatchObject({
      url: `${window.location.origin}/live/${token}`,
      code: '',
    });
  });

  it('reads the short code only from a /l/ address', () => {
    expect(shortCodeOf('https://a.it/l/k7m2qx9p')).toBe('K7M2QX9P');
    expect(shortCodeOf('https://a.it/l/K7M2QX9P/')).toBe('K7M2QX9P');
    expect(shortCodeOf('https://a.it/l/K7M2QX0P')).toBeNull();
    expect(shortCodeOf('https://a.it/live/K7M2QX9P')).toBeNull();
    expect(shortCodeOf('non è un url')).toBeNull();
  });

  it('topPlayers: the ranking of volley-stats, filtered by team', () => {
    const state = midMatchState();
    const layout = layoutOf([{ id: 't', type: 'topPlayers', options: { count: 3, team: 'home' } }]);
    render(<MatchView state={state} device="tablet" layout={layout} />);
    const table = screen.getByRole('table', { name: 'Migliori giocatori per punti' });
    const rows = within(table).getAllByRole('row').slice(1);
    const expected = topPlayers(state, { limit: 3, team: 'home' });
    expect(rows).toHaveLength(expected.length);
    expected.forEach((p, i) => {
      const row = rows[i] as HTMLElement;
      expect(within(row).getByRole('rowheader').textContent).toContain(playerName(p.player ?? undefined, p.number));
      expect(row.lastElementChild?.textContent).toBe(String(p.points));
    });
  });

  it('lastPoint and setScores: the last point and the partials of the match', () => {
    const state = midMatchState();
    const layout = layoutOf([
      { id: 'l', type: 'lastPoint' },
      { id: 's', type: 'setScores' },
    ]);
    render(<MatchView state={state} device="tablet" layout={layout} />);
    const last = state.live.lastPoint;
    expect(last).not.toBeNull();
    if (last) expect(screen.getByText(`${last.homeScore}-${last.awayScore}`)).toBeTruthy();
    const partials = screen.getByRole('list', { name: 'Parziali dei set' });
    expect(within(partials).getAllByRole('listitem')).toHaveLength(state.sets.length);
  });

  it('logo: the square logo when chosen, the name without images', () => {
    const layout = layoutOf([{ id: 'l', type: 'logo', options: { variant: 'mark' } }]);
    const { rerender } = render(<MatchView state={midMatchState()} device="tablet" layout={layout} look={LOOK} />);
    expect(screen.getByRole('img', { name: 'Sir Safety' }).getAttribute('src')).toBe(LOOK.logoMark);
    rerender(<MatchView state={midMatchState()} device="tablet" layout={layout} look={{ ...LOOK, logoMark: null }} />);
    expect(screen.getByText('Sir Safety')).toBeTruthy();
  });
});
