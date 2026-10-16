import type { UpcomingFixture } from '@sir/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveMatch } from './LiveMatch.tsx';
import { countdownTo, NextMatch, teamInitials } from './NextMatch.tsx';

const fixture = (over: Partial<UpcomingFixture> = {}): UpcomingFixture => ({
  startsAt: '2026-10-18T16:00:00.000Z',
  home: { name: "Acqua Sant'Anna Cuneo", logoUrl: null },
  away: { name: 'Sir Susa Scai Perugia', logoUrl: '/api/public/team-logos/3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c' },
  ourSide: 'away',
  venue: 'Palasport di Cuneo',
  venueCity: 'Cuneo (CN)',
  roundLabel: '1ª Giornata Andata',
  leagueName: 'Regular Season SuperLega',
  status: 'scheduled',
  result: null,
  inCalendar: true,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('countdown', () => {
  it('splits the time left into days, hours, minutes and seconds', () => {
    const now = Date.parse('2026-10-16T14:59:30.000Z');
    expect(countdownTo('2026-10-18T16:00:00.000Z', now)).toEqual({ days: 2, hours: 1, minutes: 0, seconds: 30 });
    expect(countdownTo('2026-10-18T16:00:00.000Z', Date.parse('2026-10-18T16:00:00.000Z'))).toBeNull();
    expect(countdownTo(null, now)).toBeNull();
  });

  it('uses the initials of the team in place of a missing logo', () => {
    expect(teamInitials("Acqua Sant'Anna Cuneo")).toBe('AS');
    expect(teamInitials('Itas Trentino')).toBe('IT');
  });
});

describe('«Prossima partita»', () => {
  it('shows teams, Italian date and time, venue and the countdown', () => {
    vi.useFakeTimers({ now: new Date('2026-10-16T14:59:30.000Z') });
    render(<NextMatch fixture={fixture()} />);
    expect(screen.getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    expect(screen.getByText("Acqua Sant'Anna Cuneo")).toBeTruthy();
    expect(screen.getByText('Sir Susa Scai Perugia')).toBeTruthy();
    expect(screen.getByText(/Dom 18 ott 2026/)).toBeTruthy();
    expect(screen.getByText(/ore 18:00/)).toBeTruthy();
    expect(screen.getByText('Palasport di Cuneo · Cuneo (CN)')).toBeTruthy();
    expect(screen.getByRole('timer').getAttribute('aria-label')).toBe('Mancano 2 giorni, 1 ore e 0 minuti');
    expect(screen.getByText(/La diretta comparirà qui da sola/)).toBeTruthy();
  });

  it('says when the match is postponed or no longer in the calendar, without countdown', () => {
    render(<NextMatch fixture={fixture({ status: 'postponed', startsAt: null })} />);
    expect(screen.getByText('Data da definire')).toBeTruthy();
    expect(screen.getByText(/Partita rinviata/)).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    cleanup();
    render(<NextMatch fixture={fixture({ inCalendar: false })} />);
    expect(screen.getByText(/non più presente nel calendario ufficiale/)).toBeTruthy();
  });

  it('is what a live link of a match of the calendar shows before the start', () => {
    render(
      <LiveMatch
        snapshot={{ status: 'live', data: { kind: 'scheduled', fixture: fixture() }, error: null, attempts: 0 }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    expect(screen.getByText('In attesa')).toBeTruthy();
    expect(screen.queryByText('In diretta')).toBeNull();
  });
});
