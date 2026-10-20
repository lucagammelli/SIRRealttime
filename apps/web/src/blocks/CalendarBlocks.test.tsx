import { IntermissionSlideSchema, TenantLayoutSchema } from '@arenalive/shared';
import type { ScheduleResponse } from '@arenalive/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchView } from '../components/MatchView.tsx';
import { visibleSlides } from '../lib/intermission.ts';
import { defaultIntermissions } from '@arenalive/shared';
import { midMatchState } from '../test/fixtures.ts';
import type { SlideEnv } from './IntermissionSlides.tsx';
import { renderSlide } from './IntermissionSlides.tsx';
import { SAMPLE_SCHEDULE } from './sampleSchedule.ts';

// The QR itself is tested in qr/: here only what the block asks to encode.
vi.mock('../qr/ShareQr.tsx', () => ({
  ShareQr: ({ url, code }: { url: string; code?: string }) => (
    <div data-testid="qr" data-url={url} data-code={code ?? ''} />
  ),
}));

afterEach(() => cleanup());

const state = midMatchState();
const cardOf = (title: string): HTMLElement => {
  const card = screen.getByRole('heading', { name: title }).closest('section');
  if (!card) throw new Error(`card ${title} missing`);
  return card;
};
const layoutOf = (blocks: object[], device: 'tv' | 'tablet' | 'phone' = 'tablet') =>
  TenantLayoutSchema.parse({ [device]: blocks });

const envOf = (schedule: ScheduleResponse | null): SlideEnv => ({
  state,
  device: 'tv',
  brandInScoreboard: false,
  brand: null,
  schedule,
  paused: false,
  set: 1,
  sponsorLogo: null,
});

const slide = (type: 'nextMatch' | 'standings', options: object = {}) =>
  IntermissionSlideSchema.parse({ id: type, type, options });

describe('block «Prossima partita»', () => {
  const draw = (options: object = {}, schedule: ScheduleResponse | null = SAMPLE_SCHEDULE) =>
    render(
      <MatchView
        state={state}
        device="tablet"
        layout={layoutOf([{ id: 'n', type: 'nextMatch', options }])}
        schedule={schedule}
      />,
    );

  it('shows the opponent, home or away, day and time in Italy, the venue and the QR of its own link', () => {
    draw();
    const card = cardOf('Prossima partita');
    expect(within(card).getByText('Volley Torino')).toBeTruthy();
    expect(within(card).getByText('6ª Giornata Andata')).toBeTruthy();
    // 17:00 UTC of 8 November is 18:00 in Italy (CET).
    expect(card.textContent).toContain('Dom 8 nov 2026 · ore 18:00');
    expect(card.textContent).toContain('In casa · PalaEsempio · Città d’Esempio');
    const qr = within(card).getByTestId('qr');
    expect(qr.getAttribute('data-url')).toBe('https://esempio.it/l/K7M2QX9P');
    expect(qr.getAttribute('data-code')).toBe('K7M2QX9P');
  });

  it('without the QR option shows no QR', () => {
    draw({ qr: false });
    expect(screen.queryByTestId('qr')).toBeNull();
  });

  it('skips the match being played and shows the following one, away from home', () => {
    const [a, b] = SAMPLE_SCHEDULE.fixtures;
    if (!a || !b) throw new Error('sample');
    draw({}, { ...SAMPLE_SCHEDULE, fixtures: [{ ...a, live: true }, b] });
    const card = cardOf('Prossima partita');
    expect(card.textContent).toContain('In trasferta');
    expect(screen.getByTestId('qr').getAttribute('data-url')).toBe(b.shortUrl);
  });

  it('is left out without data: no card, no empty cell', () => {
    for (const empty of [null, { fixtures: [], standings: null }]) {
      cleanup();
      draw({}, empty);
      expect(screen.queryByRole('heading', { name: 'Prossima partita' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Prossima partita' })).toBeNull();
    }
  });
});

describe('block «Classifica»', () => {
  const draw = (options: object = {}) =>
    render(
      <MatchView
        state={state}
        device="tablet"
        layout={layoutOf([{ id: 'c', type: 'standings', options }])}
        schedule={SAMPLE_SCHEDULE}
      />,
    );
  const names = (): string[] => screen.getAllByRole('rowheader').map((th) => th.textContent ?? '');

  it('around the club: it and two rows on each side, the club highlighted', () => {
    draw({ scope: 'around' });
    expect(names()).toEqual(['Volley Perla', 'Aquila Volley', 'Nostra Squadra Volley', 'Delta Padova', 'Lupi Verona']);
    const ours = screen.getByRole('row', { name: /Nostra Squadra Volley/ });
    expect(ours.getAttribute('aria-current')).toBe('true');
    expect(ours.className).toContain('bg-our-soft');
    expect(screen.getAllByRole('row').filter((r) => r.getAttribute('aria-current'))).toHaveLength(1);
  });

  it('first rows or all the rows, with the columns and the date of the update', () => {
    draw({ scope: 'top', count: 4 });
    expect(names()).toHaveLength(4);
    expect(names()[0]).toBe('Volley Torino');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['#', 'Squadra', 'Pt', 'G', 'V', 'P', 'SV', 'SP']);
    expect(screen.getByText('Aggiornata al 26/10/2026')).toBeTruthy();
    cleanup();
    draw({ scope: 'all' });
    expect(names()).toHaveLength(12);
  });

  it('every row has its logo or its initials, and the columns keep a fixed width', () => {
    draw({ scope: 'all' });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const cell = row.querySelectorAll('td')[0]?.nextElementSibling as HTMLElement;
      expect(cell.querySelector('img') ?? cell.textContent).toBeTruthy();
      expect((cell.textContent ?? '').length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('table').className).toContain('table-fixed');
    expect(screen.getByRole('table').querySelectorAll('col')).toHaveLength(9);
  });

  it('is left out without standings', () => {
    render(
      <MatchView
        state={state}
        device="tablet"
        layout={layoutOf([{ id: 'c', type: 'standings' }])}
        schedule={{ fixtures: SAMPLE_SCHEDULE.fixtures, standings: null }}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Classifica' })).toBeNull();
  });
});

describe('slides «Prossima partita» and «Classifica»', () => {
  it('full screen: the same data, big', () => {
    render(<div data-testid="s">{renderSlide(slide('nextMatch'), envOf(SAMPLE_SCHEDULE), 'full')}</div>);
    expect(screen.getByTestId('s').textContent).toContain('Volley Torino');
    expect(screen.getByTestId('qr').getAttribute('data-url')).toBe('https://esempio.it/l/K7M2QX9P');
    cleanup();
    render(
      <div data-testid="s">{renderSlide(slide('standings', { scope: 'all' }), envOf(SAMPLE_SCHEDULE), 'full')}</div>,
    );
    expect(screen.getAllByRole('rowheader')).toHaveLength(12);
  });

  it('banner: one line for the match and for the club in the standings', () => {
    render(<div data-testid="s">{renderSlide(slide('nextMatch'), envOf(SAMPLE_SCHEDULE), 'compact')}</div>);
    expect(screen.getByTestId('s').textContent).toContain('Prossima partita: Volley Torino');
    cleanup();
    render(<div data-testid="s">{renderSlide(slide('standings'), envOf(SAMPLE_SCHEDULE), 'compact')}</div>);
    expect(screen.getByTestId('s').textContent).toContain('5° Nostra Squadra Volley');
  });

  it('banner: the club in the colour of «nostra squadra», the opponent in its own (never plain white text)', () => {
    render(<div data-testid="s">{renderSlide(slide('nextMatch'), envOf(SAMPLE_SCHEDULE), 'compact')}</div>);
    expect(screen.getByText('Volley Torino').className).toContain('text-opponent-ink');
    cleanup();
    render(<div data-testid="s">{renderSlide(slide('standings'), envOf(SAMPLE_SCHEDULE), 'compact')}</div>);
    expect(screen.getByText(/5° Nostra Squadra Volley/).className).toContain('text-our-ink');
  });

  it('banner on the phone: no QR, the opponent is the link of the match, the venue on its own line', () => {
    const env = { ...envOf(SAMPLE_SCHEDULE), device: 'phone' as const };
    render(<div data-testid="s">{renderSlide(slide('nextMatch'), env, 'compact')}</div>);
    expect(screen.queryByTestId('qr')).toBeNull();
    expect(screen.getByRole('link', { name: 'Volley Torino' }).getAttribute('href')).toBe(
      'https://esempio.it/l/K7M2QX9P',
    );
    expect(screen.getByText('PalaEsempio · Città d’Esempio').className).toContain('block');
  });

  it('are skipped by the pause without data, and kept with data', () => {
    const { setBreak } = defaultIntermissions();
    const types = (schedule: ScheduleResponse | null) =>
      visibleSlides(state, { set: 1, pause: setBreak }, { sponsorLogo: null, schedule }).map((s) => s.type);
    expect(types(null)).not.toContain('standings');
    expect(types({ fixtures: [], standings: null })).not.toContain('nextMatch');
    expect(types(SAMPLE_SCHEDULE)).toEqual(expect.arrayContaining(['standings', 'nextMatch']));
    expect(renderSlide(slide('nextMatch'), envOf(null), 'full')).toBeNull();
    expect(renderSlide(slide('standings'), envOf(null), 'full')).toBeNull();
  });
});
