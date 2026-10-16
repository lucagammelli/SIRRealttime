import { describe, expect, it } from 'vitest';
import {
  clubFixtureState,
  EMPTY_SCHEDULE,
  ScheduleResponseSchema,
  standingsRowsToShow,
  suggestedOurTeamName,
  UpdateClubRequestSchema,
} from './club.js';
import { ServerMessageSchema } from './messages.js';

const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

describe('club', () => {
  it('derives the state of a match of the club from the calendar and its .dvw', () => {
    const base = { removed: false, fixtureStatus: 'scheduled' as const, match: null, pending: false };
    expect(clubFixtureState(base)).toBe('scheduled');
    expect(clubFixtureState({ ...base, pending: true })).toBe('pending');
    expect(clubFixtureState({ ...base, fixtureStatus: 'postponed' })).toBe('postponed');
    expect(clubFixtureState({ ...base, fixtureStatus: 'played' })).toBe('finished');
    expect(clubFixtureState({ ...base, removed: true })).toBe('removed');
    expect(clubFixtureState({ ...base, match: { live: true, status: 'inProgress' } })).toBe('live');
    expect(clubFixtureState({ ...base, removed: true, match: { live: false, status: 'finished' } })).toBe('finished');
  });

  it('suggests «nostra squadra» from the city, otherwise from the last word of the name', () => {
    expect(suggestedOurTeamName({ name: 'Sir Susa Scai Perugia', city: 'Perugia (PG)' })).toBe('Perugia');
    expect(suggestedOurTeamName({ name: 'Tinet Prata di Pordenone', city: null })).toBe('Pordenone');
    expect(suggestedOurTeamName({ name: ' ', city: null })).toBeNull();
  });

  it('accepts each championship once', () => {
    expect(UpdateClubRequestSchema.safeParse({ leagues: [{ leagueId: ID, teamId: null }] }).success).toBe(true);
    const twice = {
      leagues: [
        { leagueId: ID, teamId: null },
        { leagueId: ID, teamId: ID },
      ],
    };
    expect(UpdateClubRequestSchema.safeParse(twice).success).toBe(false);
  });

  it('carries «Prossima partita» in the live protocol', () => {
    const message = {
      type: 'scheduled',
      fixture: {
        startsAt: '2026-10-18T16:00:00.000Z',
        home: { name: "Acqua Sant'Anna Cuneo", logoUrl: null },
        away: { name: 'Sir Susa Scai Perugia', logoUrl: `/api/public/team-logos/${ID}` },
        ourSide: 'away',
        venue: 'Palasport di Cuneo',
        venueCity: 'Cuneo (CN)',
        roundLabel: '1ª Giornata Andata',
        leagueName: 'Regular Season SuperLega',
        status: 'scheduled',
        result: null,
        inCalendar: true,
      },
    };
    expect(ServerMessageSchema.parse(message)).toEqual(message);
    expect(ServerMessageSchema.safeParse({ type: 'scheduled', fixture: {} }).success).toBe(false);
  });
});

describe('rows of the standings of a block', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    position: i + 1,
    teamName: `Squadra ${i + 1}`,
    points: 30 - i,
    played: 10,
    won: 10 - i,
    lost: i,
    setsWon: 30 - i,
    setsLost: i,
    logoUrl: null,
    ours: false,
  }));
  const withOurs = (position: number) => rows.map((r) => ({ ...r, ours: r.position === position }));
  const positions = (list: readonly { position: number }[]) => list.map((r) => r.position);

  it('shows the first N rows or all of them', () => {
    expect(positions(standingsRowsToShow(rows, 'top', 4))).toEqual([1, 2, 3, 4]);
    expect(standingsRowsToShow(rows, 'all', 4)).toHaveLength(12);
  });

  it('shows the club and two rows on each side, sliding at the ends', () => {
    expect(positions(standingsRowsToShow(withOurs(6), 'around', 3))).toEqual([4, 5, 6, 7, 8]);
    expect(positions(standingsRowsToShow(withOurs(1), 'around', 3))).toEqual([1, 2, 3, 4, 5]);
    expect(positions(standingsRowsToShow(withOurs(12), 'around', 3))).toEqual([8, 9, 10, 11, 12]);
    expect(positions(standingsRowsToShow(withOurs(11), 'around', 3))).toEqual([8, 9, 10, 11, 12]);
  });

  it('falls back to the first rows without the team of the club, and keeps a short table whole', () => {
    expect(positions(standingsRowsToShow(rows, 'around', 3))).toEqual([1, 2, 3]);
    expect(positions(standingsRowsToShow(withOurs(2).slice(0, 4), 'around', 3))).toEqual([1, 2, 3, 4]);
  });

  it('reads an empty schedule and refuses wrong data', () => {
    expect(ScheduleResponseSchema.parse(EMPTY_SCHEDULE)).toEqual({ fixtures: [], standings: null });
    expect(ScheduleResponseSchema.safeParse({ fixtures: [{}], standings: null }).success).toBe(false);
  });
});
