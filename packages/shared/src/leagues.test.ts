import { describe, expect, it } from 'vitest';
import { CreateLeagueRequestSchema, LeagueSyncStateSchema, publicTeamLogoPath, seasonLabel } from './leagues.js';

describe('leagues', () => {
  it('accepts a championship of Lega Pallavolo Serie A with IdCampionato and season', () => {
    expect(CreateLeagueRequestSchema.parse({ provider: 'legavolley', externalId: 974, season: 2025 })).toEqual({
      provider: 'legavolley',
      externalId: 974,
      season: 2025,
    });
  });

  it('refuses other providers, ids that are not positive integers, odd seasons and extra fields', () => {
    for (const bad of [
      { provider: 'fipav', externalId: 974, season: 2025 },
      { provider: 'legavolley', externalId: 0, season: 2025 },
      { provider: 'legavolley', externalId: '974', season: 2025 },
      { provider: 'legavolley', externalId: 1e9, season: 2025 },
      { provider: 'legavolley', externalId: 974, season: 1800 },
      { provider: 'legavolley', externalId: 974, season: 2025, url: 'https://evil.test' },
    ])
      expect(CreateLeagueRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('describes the state of the last update', () => {
    expect(
      LeagueSyncStateSchema.parse({ status: 'never', message: null, at: null, lastSuccessAt: null, running: false }),
    ).toMatchObject({ status: 'never' });
    expect(seasonLabel(2025)).toBe('2025/2026');
    expect(publicTeamLogoPath('x')).toBe('/api/public/team-logos/x');
  });
});
