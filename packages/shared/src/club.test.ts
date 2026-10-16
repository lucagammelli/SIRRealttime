import { describe, expect, it } from 'vitest';
import { clubFixtureState, suggestedOurTeamName, UpdateClubRequestSchema } from './club.js';
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
