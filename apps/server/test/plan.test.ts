import { describe, expect, it } from 'vitest';
import { fixtureLogos } from '../src/club.js';
import { MATCH_DAY_INTERVAL_MS, nextSyncAt } from '../src/leagues/scheduler.js';

describe('nextSyncAt', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  it('is now when the nightly update is due, otherwise the next night at 04:00 in Rome', () => {
    expect(nextSyncAt(now, { lastSyncAt: null, matchToday: false })).toEqual(now);
    expect(nextSyncAt(now, { lastSyncAt: new Date('2026-10-17T03:00:00Z'), matchToday: false })).toEqual(
      new Date('2026-10-18T02:00:00Z'),
    );
    // Before 04:00 the nightly update of today is still to come.
    const night = new Date('2026-10-17T01:00:00Z');
    expect(nextSyncAt(night, { lastSyncAt: new Date('2026-10-16T02:30:00Z'), matchToday: false })).toEqual(
      new Date('2026-10-17T02:00:00Z'),
    );
  });

  it('is every 10 minutes on a match day', () => {
    const last = new Date('2026-10-17T09:55:00Z');
    expect(nextSyncAt(now, { lastSyncAt: last, matchToday: true })).toEqual(
      new Date(last.getTime() + MATCH_DAY_INTERVAL_MS),
    );
  });
});

describe('fixtureLogos', () => {
  const row = {
    ourSide: 'away' as const,
    homeLogoId: '11111111-1111-4111-8111-111111111111',
    awayLogoId: '22222222-2222-4222-8222-222222222222',
    ourLogoAssetId: null,
    opponentLogoAssetId: null,
  };
  const profileLogo = '/api/public/assets/33333333-3333-4333-8333-333333333333';
  it('puts our logo (profile, then league) on our side and the logo of the league on the opponent', () => {
    expect(fixtureLogos(row, { profileLogo, teamLogos: 'all' })).toEqual({
      home: `/api/public/team-logos/${row.homeLogoId}`,
      away: profileLogo,
    });
    expect(fixtureLogos(row, { profileLogo: null, teamLogos: 'all' }).away).toBe(
      `/api/public/team-logos/${row.awayLogoId}`,
    );
    expect(fixtureLogos(row, { profileLogo, teamLogos: 'ours' })).toEqual({ home: null, away: profileLogo });
    expect(fixtureLogos(row, { profileLogo, teamLogos: 'none' })).toEqual({ home: null, away: null });
  });

  it('prefers the logos chosen for the match, but the logo of the club always wins for our team', () => {
    const custom = {
      ...row,
      ourLogoAssetId: '44444444-4444-4444-8444-444444444444',
      opponentLogoAssetId: '55555555-5555-4555-8555-555555555555',
    };
    expect(fixtureLogos(custom, { profileLogo, teamLogos: 'all' })).toEqual({
      home: '/api/public/assets/55555555-5555-4555-8555-555555555555',
      away: profileLogo,
    });
    expect(fixtureLogos(custom, { profileLogo: null, teamLogos: 'all' })).toEqual({
      home: '/api/public/assets/55555555-5555-4555-8555-555555555555',
      away: '/api/public/assets/44444444-4444-4444-8444-444444444444',
    });
  });
});
