import type { IntermissionSlideInput, TenantLayout } from '@arenalive/shared';
import { IntermissionSlideSchema, TenantIntermissionsSchema, TenantLayoutSchema } from '@arenalive/shared';
import type { MatchState, Period, StatLine } from '@arenalive/volley-stats';
import { MATCH_PERIOD, periodSummary, roleDuels, scorers, setPeriod, teamDuel } from '@arenalive/volley-stats';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchView } from '../components/MatchView.tsx';
import { claimOurSide } from '../lib/branding.ts';
import { formatPct } from '../lib/format.ts';
import { duelRoles, visibleSlides } from '../lib/intermission.ts';
import type { SlideEnv, SlideSize } from './IntermissionSlides.tsx';
import { renderSlide } from './IntermissionSlides.tsx';
import { loadSampleMatch } from './sampleMatch.ts';
import { ROLE_LABELS, surname } from './StatSlides.tsx';

vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

let sample: MatchState;
beforeAll(async () => {
  sample = await loadSampleMatch();
});

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

beforeEach(() => stubReducedMotion(false));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const envOf = (state: MatchState, set: number, paused = false): SlideEnv => ({
  state,
  device: 'tv',
  brandInScoreboard: false,
  brand: null,
  schedule: null,
  paused,
  set,
  sponsorLogo: null,
});

const slideOf = (input: Omit<IntermissionSlideInput, 'id'>) => IntermissionSlideSchema.parse({ id: 's', ...input });

function draw(state: MatchState, input: Omit<IntermissionSlideInput, 'id'>, set = 1, size: SlideSize = 'full') {
  return render(<div data-testid="slide">{renderSlide(slideOf(input), envOf(state, set), size)}</div>);
}

const slideText = (): string => screen.getByTestId('slide').textContent ?? '';

/** A copy of `state` where nobody served an ace in `set` (the period lines of teams and players). */
function withoutAces(state: MatchState, set: number): MatchState {
  const copy = structuredClone(state);
  const clear = (line: StatLine | undefined): void => {
    if (line) line.serve.aces = 0;
  };
  for (const side of ['home', 'away'] as const) {
    clear(copy.stats[side].bySet[String(set)]);
    for (const p of Object.values(copy.stats[side].players)) clear(p.bySet[String(set)]);
  }
  return copy;
}

/** A copy of `state` without liberos (no role in the file, no `L`): no duel of the liberos. */
function withoutLiberos(state: MatchState): MatchState {
  const copy = structuredClone(state);
  for (const side of ['home', 'away'] as const)
    copy.players[side] = copy.players[side].map((p) =>
      p.role === 'libero' || p.specialRole === 'L' ? { ...p, role: null, specialRole: null } : p,
    );
  return copy;
}

describe('statistics slides with the example match', () => {
  it('partial and scorers of the set: the score, the first scorers of each team, at most the limit', () => {
    draw(sample, { type: 'setScorers', options: { limit: 3 } }, 1);
    const set = sample.sets[0];
    expect(screen.getByLabelText(`Parziale ${set?.homeScore} a ${set?.awayScore}`)).toBeTruthy();
    expect(slideText()).toContain('Parziale e marcatori');
    expect(slideText()).toContain('1° set');
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    for (const [i, side] of (['home', 'away'] as const).entries()) {
      const top = scorers(sample, setPeriod(1), side, 3);
      const items = within(lists[i] as HTMLElement).getAllByRole('listitem');
      expect(items).toHaveLength(top.length);
      expect(items.length).toBeLessThanOrEqual(3);
      const first = top[0];
      if (first) expect(items[0]?.textContent).toContain(surname(first.player, first.number));
    }
  });

  it('partial and scorers of the match: the sets won; one line in the banner', () => {
    draw(sample, { type: 'setScorers', options: { period: 'match' } });
    expect(screen.getByLabelText(`Set vinti ${sample.setsWon.home} a ${sample.setsWon.away}`)).toBeTruthy();
    expect(slideText()).toContain('Partita');
    cleanup();
    draw(sample, { type: 'setScorers' }, 2, 'compact');
    expect(slideText()).toMatch(/^Marcatori · 2° set: /);
    expect(slideText()).toContain(`${sample.live.homeScore}-${sample.live.awayScore}`);
  });

  it('aces and blocks: the count of each team and who scored them', () => {
    const summary = periodSummary(sample, MATCH_PERIOD);
    if (!summary) throw new Error('period');
    draw(sample, { type: 'aces', options: { period: 'match' } });
    expect(slideText()).toContain('Ace');
    expect(slideText()).toContain(String(summary.teams.home.aces));
    const first = summary.teams.home.aceScorers[0] ?? summary.teams.away.aceScorers[0];
    if (first) expect(slideText()).toContain(surname(first.player, first.number));
    cleanup();
    draw(sample, { type: 'blocks', options: { period: 'match' } }, 1, 'compact');
    expect(slideText()).toContain('Muri vincenti · Partita');
    expect(slideText()).toContain(String(summary.teams.away.blockPoints));
  });

  it('a set without aces: «nessun ace» on the slide, and the pause skips it', () => {
    const state = withoutAces(sample, 1);
    draw(state, { type: 'aces' }, 1);
    expect(slideText()).toContain('Nessun ace nel 1° set.');
    cleanup();
    draw(state, { type: 'aces' }, 1, 'compact');
    expect(slideText()).toContain('Nessun ace nel 1° set.');
    const pause = TenantIntermissionsSchema.parse({ setBreak: { slides: [{ id: 'a', type: 'aces' }] } }).setBreak;
    expect(visibleSlides(state, { set: 1, pause }, { sponsorLogo: null })).toEqual([]);
    expect(visibleSlides(sample, { set: 99, pause }, { sponsorLogo: null })).toEqual([]);
  });

  it('attack: percentage and efficiency of each team and the best attackers', () => {
    const summary = periodSummary(sample, setPeriod(1));
    if (!summary) throw new Error('period');
    draw(sample, { type: 'attack' }, 1);
    expect(slideText()).toContain(formatPct(summary.teams.home.attackKillPct));
    expect(slideText()).toContain(formatPct(summary.teams.away.attackEfficiency));
    expect(screen.getAllByRole('list')).toHaveLength(2);
    cleanup();
    draw(sample, { type: 'attack' }, 1, 'compact');
    expect(slideText()).toContain('Attacco · 1° set');
  });

  it('player duel: the two players face to face, number and surname, points, aces, blocks and attack', () => {
    const duel = roleDuels(sample, setPeriod(1)).find((d) => d.role === 'opposite' && d.rank === 1);
    if (!duel) throw new Error('duel');
    draw(sample, { type: 'roleDuel', options: { role: 'opposite' } }, 1);
    expect(slideText()).toContain('Sfida tra opposti');
    for (const line of [duel.home, duel.away]) {
      expect(slideText()).toContain(String(line.number));
      expect(slideText()).toContain(surname(line.player, line.number));
    }
    for (const row of ['Punti', 'Ace', 'Muri', 'Attacco %']) expect(screen.getByText(row)).toBeTruthy();
  });

  it('libero duel: reception and digs instead of points', () => {
    draw(sample, { type: 'roleDuel', options: { role: 'libero', period: 'match' } });
    expect(slideText()).toContain('Sfida tra liberi');
    for (const row of ['Ricezione positiva', 'Ricezione perfetta', 'Difese'])
      expect(screen.getByText(row)).toBeTruthy();
    expect(screen.queryByText('Ace')).toBeNull();
  });

  it('a role without a duel: a message on the slide, nothing in the banner, the pause skips it', () => {
    const state = withoutLiberos(sample);
    expect(duelRoles(state, MATCH_PERIOD)).not.toContain('libero');
    draw(state, { type: 'roleDuel', options: { role: 'libero', period: 'match' } }, 1, 'full');
    expect(slideText()).toContain('Nessuna sfida tra liberi in questo periodo.');
    cleanup();
    draw(state, { type: 'roleDuel', options: { role: 'libero', period: 'match' } }, 1, 'compact');
    expect(slideText()).toBe('');
    const pause = TenantIntermissionsSchema.parse({
      matchEnd: { slides: [{ id: 'd', type: 'roleDuel', options: { role: 'libero', period: 'match' } }] },
    }).matchEnd;
    expect(visibleSlides(state, { set: 2, pause }, { sponsorLogo: null })).toEqual([]);
  });

  it('a duel «a rotazione» is one slide for every role with a duel, each with its role', () => {
    const pause = TenantIntermissionsSchema.parse({}).setBreak;
    const shown = visibleSlides(sample, { set: 1, pause }, { sponsorLogo: null }).filter((s) => s.type === 'roleDuel');
    const roles = duelRoles(sample, setPeriod(1));
    expect(shown.map((s) => s.id)).toEqual(roles.map((r) => `roleDuel:${r}`));
    expect(shown.map((s) => (s.type === 'roleDuel' ? s.options.role : null))).toEqual(roles);
  });

  it('team duel: the rows of teamDuel chosen, mirrored; the set has no side-out rows', () => {
    draw(sample, { type: 'teamDuel', options: { rows: ['points', 'aces', 'sideOut'] } }, 1);
    expect(slideText()).toContain('Squadre a confronto');
    const rows = teamDuel(sample, setPeriod(1));
    expect(screen.getByText(rows.find((r) => r.key === 'points')?.label ?? '')).toBeTruthy();
    expect(screen.getByText('Ace')).toBeTruthy();
    expect(screen.queryByText('% cambio palla (side-out)')).toBeNull();
    expect(screen.queryByText('Errori totali')).toBeNull();
    cleanup();
    draw(sample, { type: 'teamDuel', options: { period: 'match' } });
    expect(screen.getByText('% cambio palla (side-out)')).toBeTruthy();
    cleanup();
    draw(sample, { type: 'teamDuel' }, 1, 'compact');
    expect(slideText().split(' · ')).toHaveLength(6);
  });
});

describe('statistics in television style', () => {
  it('home on the left and away on the right in the colours of the two sides, which follow our team', () => {
    draw(sample, { type: 'roleDuel', options: { role: 'opposite' } }, 1);
    const chips = document.querySelectorAll('.bg-home, .bg-away');
    expect(chips.length).toBeGreaterThan(0);
    const home = document.querySelector('.sir-enter-left');
    const away = document.querySelector('.sir-enter-right');
    expect(home?.querySelector('.bg-home')).toBeTruthy();
    expect(away?.querySelector('.bg-away')).toBeTruthy();
    // our team plays away: the away side takes the colours of our team
    const release = claimOurSide('away');
    expect(document.documentElement.style.getPropertyValue('--sir-away')).toBe('var(--sir-our)');
    expect(document.documentElement.style.getPropertyValue('--sir-home')).toBe('var(--sir-opponent)');
    release();
    expect(document.documentElement.style.getPropertyValue('--sir-away')).toBe('');
  });

  it('short entrance animation, none with reduced motion', () => {
    draw(sample, { type: 'teamDuel' }, 1);
    expect(document.querySelectorAll('.sir-grow').length).toBeGreaterThan(0);
    cleanup();
    stubReducedMotion(true);
    draw(sample, { type: 'teamDuel' }, 1);
    expect(document.querySelectorAll('.sir-grow, .sir-enter-left, .sir-enter-right')).toHaveLength(0);
  });
});

describe('statistics as blocks of the page', () => {
  const layoutOf = (blocks: unknown[]): TenantLayout => TenantLayoutSchema.parse({ tablet: blocks });

  it('every statistics block in a card, on the set in progress', () => {
    const blocks = [
      { id: 'a', type: 'setScorers' },
      { id: 'b', type: 'aces', options: { period: 'match' } },
      { id: 'c', type: 'blocks', options: { period: 'match' } },
      { id: 'd', type: 'attack' },
      { id: 'e', type: 'roleDuel', options: { role: 'opposite' } },
      { id: 'f', type: 'teamDuel' },
    ];
    render(<MatchView state={sample} device="tablet" layout={layoutOf(blocks)} />);
    for (const title of [
      `Parziale e marcatori · ${sample.live.set}° set`,
      'Ace · Partita',
      'Muri vincenti · Partita',
      `Attacco · ${sample.live.set}° set`,
      `Sfida tra opposti · ${sample.live.set}° set`,
      `Squadre a confronto · ${sample.live.set}° set`,
    ])
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByLabelText(`Parziale ${sample.live.homeScore} a ${sample.live.awayScore}`)).toBeTruthy();
  });

  it('a duel block «a rotazione» changes role every 8 s, stopped with the rotation', () => {
    vi.useFakeTimers();
    const roles = duelRoles(sample, setPeriod(sample.live.set));
    const [first, second] = roles;
    if (!first || !second) throw new Error('roles');
    const layout = layoutOf([{ id: 'd', type: 'roleDuel' }]);
    const view = render(<MatchView state={sample} device="tablet" layout={layout} />);
    const title = (role: typeof first, period: Period = setPeriod(sample.live.set)) =>
      `Sfida tra ${ROLE_LABELS[role].many} · ${period.kind === 'set' ? `${period.set}° set` : 'Partita'}`;
    expect(screen.getByRole('heading', { name: title(first) })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole('heading', { name: title(second) })).toBeTruthy();
    view.rerender(<MatchView state={sample} device="tablet" layout={layout} rotationPaused />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole('heading', { name: title(second) })).toBeTruthy();
  });

  it('a set not started yet: a message instead of the numbers', () => {
    const period = setPeriod(9);
    expect(periodSummary(sample, period)).toBeNull();
    draw(sample, { type: 'setScorers' }, 9, 'full');
    expect(slideText()).toContain('Il 9° set non è ancora iniziato.');
  });
});

describe('rows value/bar and long names: never one over the other', () => {
  /** The example match with the long names of a real file. */
  const longNames = (): MatchState => {
    const copy = structuredClone(sample);
    copy.teams.home = { ...copy.teams.home, name: 'SIR SUSA SCAI PERUGIA_AMICHEVOLI' };
    copy.teams.away = { ...copy.teams.away, name: 'SUNTORY SUNBIRDS OSAKA' };
    return copy;
  };

  it('«Squadre a confronto» as a block: both teams, a value of each team in every row', () => {
    const state = longNames();
    const layout = TenantLayoutSchema.parse({ tablet: [{ id: 'f', type: 'teamDuel', options: { period: 'match' } }] });
    render(<MatchView state={state} device="tablet" layout={layout} />);
    const card = screen.getByRole('heading', { name: 'Squadre a confronto · Partita' }).closest('section');
    if (!card) throw new Error('card');
    expect(within(card).getByTitle('SIR SUSA SCAI PERUGIA_AMICHEVOLI')).toBeTruthy();
    expect(within(card).getByTitle('SUNTORY SUNBIRDS OSAKA')).toBeTruthy();
    const rows = teamDuel(state, MATCH_PERIOD);
    const shown = card.querySelectorAll('[data-mirror-row]');
    expect(shown).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      const line = shown[i] as HTMLElement;
      const text = (v: number | null): string => (row.kind === 'ratio' ? formatPct(v) : String(v ?? '–'));
      expect(line.querySelector('[data-value="home"]')?.textContent).toBe(text(row.home));
      expect(line.querySelector('[data-value="away"]')?.textContent).toBe(text(row.away));
    });
  });

  it('every row is one grid bar | value | label | value | bar: values in their own columns, at least «100,0%»', () => {
    draw(sample, { type: 'attack', options: { period: 'match' } });
    const rows = [...document.querySelectorAll<HTMLElement>('[data-mirror-row]')];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.className).toContain('grid-cols-[minmax(1.5rem,1fr)_auto_auto_auto_minmax(1.5rem,1fr)]');
      const cells = [...row.children];
      expect(cells).toHaveLength(5);
      expect(cells[0]?.querySelector('.sir-bar')).toBeTruthy();
      expect(cells[4]?.querySelector('.sir-bar')).toBeTruthy();
      for (const cell of [cells[1], cells[3]]) {
        // A value is a sibling of the bars, never inside them, and never narrower than its text.
        expect(cell?.querySelector('.sir-bar')).toBeNull();
        expect(cell?.className).toContain('min-w-[6ch]');
        expect(cell?.className).toContain('whitespace-nowrap');
        expect(cell?.className).toContain('tabular-nums');
      }
      expect(cells[1]?.className).toContain('text-right');
      expect(cells[3]?.className).toContain('text-left');
    }
  });

  it('long names wrap between their parts, at most on two lines, with the whole name in the title', () => {
    draw(longNames(), { type: 'teamDuel', options: { period: 'match' } });
    const home = screen.getByTitle('SIR SUSA SCAI PERUGIA_AMICHEVOLI');
    expect(home.className).toContain('line-clamp-2');
    expect(home.querySelectorAll('wbr')).toHaveLength(1);
    expect(home.textContent).toBe('SIR SUSA SCAI PERUGIA_AMICHEVOLI');
  });

  it('lists of the players side by side only in a wide card, the full slide scrolls instead of cutting', () => {
    draw(sample, { type: 'attack', options: { period: 'match' } });
    const lists = screen.getAllByRole('list');
    const grid = lists[0]?.parentElement;
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).toContain('@md:grid-cols-2');
    expect(grid?.parentElement?.className).toContain('@container');
    const frame = grid?.parentElement?.parentElement;
    expect(frame?.className).toContain('min-h-full');
    expect(frame?.className).not.toMatch(/(^| )h-full( |$)/);
  });
});
