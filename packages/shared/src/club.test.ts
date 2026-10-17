import { describe, expect, it } from 'vitest';
import {
  chooseTeamLogo,
  clubFixtureState,
  EMPTY_SCHEDULE,
  FixtureSettingsRequestSchema,
  isFixtureBroadcast,
  ManualFixtureRequestSchema,
  matchTeamLogos,
  resolveClubProfile,
  ScheduleResponseSchema,
  shownTeamLogo,
  standingsRowsToShow,
  suggestedOurTeamName,
  teamLogoShown,
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

describe('logos of the teams', () => {
  const base = { matchLogo: null, profileLogo: '/p.png', leagueLogo: '/lega.png' };
  it('chooses the logo of the match, then the profile (our team only), then the league, then none', () => {
    expect(chooseTeamLogo({ ...base, ours: true, matchLogo: '/m.png' })).toBe('/m.png');
    expect(chooseTeamLogo({ ...base, ours: true })).toBe('/p.png');
    expect(chooseTeamLogo({ ...base, ours: false })).toBe('/lega.png');
    expect(chooseTeamLogo({ ...base, ours: true, profileLogo: null })).toBe('/lega.png');
    expect(chooseTeamLogo({ ours: false, matchLogo: null, profileLogo: null, leagueLogo: null })).toBeNull();
  });

  it('shows them as «Loghi delle squadre» says', () => {
    expect([teamLogoShown('all', true), teamLogoShown('all', false)]).toEqual([true, true]);
    expect([teamLogoShown('ours', true), teamLogoShown('ours', false)]).toEqual([true, false]);
    expect([teamLogoShown('none', true), teamLogoShown('none', false)]).toEqual([false, false]);
    expect(shownTeamLogo('ours', { ...base, ours: false, matchLogo: '/m.png' })).toBeNull();
    expect(shownTeamLogo('ours', { ...base, ours: true })).toBe('/p.png');
  });

  it('puts the logos on the sides of the .dvw: «nostra squadra» first, then the side in the calendar', () => {
    const info = {
      our: '/our.png',
      opponent: '/opp.png',
      calendarSide: 'home' as const,
      ourTeam: { code: null, name: 'Perugia' },
    };
    const teams = { home: { name: 'Itas Trentino', code: 'TN' }, away: { name: 'Sir Perugia', code: 'PG' } };
    expect(matchTeamLogos(info, teams)).toEqual({ home: '/opp.png', away: '/our.png' });
    const unknown = { home: { name: 'A', code: null }, away: { name: 'B', code: null } };
    expect(matchTeamLogos(info, unknown)).toEqual({ home: '/our.png', away: '/opp.png' });
    expect(matchTeamLogos({ ...info, calendarSide: null }, unknown)).toEqual({ home: null, away: null });
  });
});

describe('profile and broadcast of the matches', () => {
  it('reads an empty or invalid profile as the defaults («casa e trasferta», every logo)', () => {
    const defaults = { series: null, coverage: 'homeAndAway', teamLogos: 'all' };
    expect(resolveClubProfile({})).toEqual(defaults);
    expect(resolveClubProfile({ coverage: 'boh' })).toEqual(defaults);
    expect(resolveClubProfile({ coverage: 'homeOnly' }).coverage).toBe('homeOnly');
  });

  it('broadcasts as the coverage says, unless the match says otherwise; never a hidden one', () => {
    const at = (
      ourSide: 'home' | 'away',
      broadcast: 'auto' | 'on' | 'off',
      coverage: 'homeAndAway' | 'homeOnly',
      hidden = false,
    ) => isFixtureBroadcast({ ourSide, broadcast, coverage, hidden });
    expect(at('away', 'auto', 'homeAndAway')).toBe(true);
    expect(at('away', 'auto', 'homeOnly')).toBe(false);
    expect(at('home', 'auto', 'homeOnly')).toBe(true);
    expect(at('away', 'on', 'homeOnly')).toBe(true);
    expect(at('home', 'off', 'homeAndAway')).toBe(false);
    expect(at('home', 'on', 'homeAndAway', true)).toBe(false);
  });

  it('checks the matches added by hand and the settings of a match', () => {
    const ok = {
      kind: 'friendly',
      startsAt: '2026-10-12T16:00:00.000Z',
      opponent: ' Suntory ',
      opponentLogo: null,
      ourSide: 'home',
      venue: null,
      venueCity: null,
    };
    expect(ManualFixtureRequestSchema.parse(ok).opponent).toBe('Suntory');
    expect(ManualFixtureRequestSchema.safeParse({ ...ok, kind: 'campionato' }).success).toBe(false);
    expect(ManualFixtureRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(FixtureSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(FixtureSettingsRequestSchema.safeParse({ opponentLogo: null }).success).toBe(true);
  });
});
