import { describe, expect, it } from 'vitest';
import {
  CreateLeagueRequestSchema,
  LEAGUE_GENDERS,
  LeagueSyncStateSchema,
  normalizeLeagueText,
  pickSeriesChampionship,
  publicTeamLogoPath,
  seasonLabel,
  SelectClubLeagueRequestSchema,
  seriesById,
  seriesOfGender,
} from './leagues.js';

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

const need = (id: string) => {
  const found = seriesById(id);
  if (!found) throw new Error(`series ${id} missing`);
  return found;
};

describe('catalog of the series', () => {
  const menu = [
    { externalId: 1004, name: 'Supercoppa A1' },
    { externalId: 999, name: 'Regular Season SuperLega' },
    { externalId: 1002, name: 'Coppa Italia A2' },
    { externalId: 1001, name: 'Regular Season A2 Credem Banca' },
    { externalId: 1010, name: 'Play Off Promozione A3' },
    { externalId: 1003, name: 'Regular Season A3 Girone Blu' },
  ];
  const pick = (id: string) => pickSeriesChampionship(need(id), menu)?.externalId;

  it('has the male series only, the female gender is in the model but not available', () => {
    expect(seriesOfGender('M').map((s) => s.id)).toEqual(['superlega', 'a2', 'a3']);
    expect(seriesOfGender('F')).toEqual([]);
    expect(LEAGUE_GENDERS.map((g) => [g.id, g.available])).toEqual([
      ['M', true],
      ['F', false],
    ]);
  });

  it('accepts a series of the catalog and refuses anything else', () => {
    expect(SelectClubLeagueRequestSchema.parse({ gender: 'M', series: 'a2' })).toEqual({ gender: 'M', series: 'a2' });
    for (const bad of [
      { gender: 'F', series: 'a2' },
      { gender: 'M', series: 'a1' },
      { gender: 'M' },
      { gender: 'M', series: 'a2', extra: 1 },
    ])
      expect(SelectClubLeagueRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('finds the championship of a series by name, ignoring case and accents, never a cup or a play off', () => {
    expect(pick('superlega')).toBe(999);
    expect(pick('a2')).toBe(1001);
    expect(pick('a3')).toBe(1003);
    expect(
      pickSeriesChampionship(need('superlega'), [
        { externalId: 5, name: 'REGULAR SEASON SÙPERLEGA'.replace('Ù', 'U') },
      ]),
    ).toMatchObject({ externalId: 5 });
    expect(
      pickSeriesChampionship(
        need('a2'),
        menu.filter((m) => m.externalId !== 1001),
      ),
    ).toBeNull();
    expect(normalizeLeagueText('  Serie  À2 – Girone Blù ')).toBe('serie a2 girone blu');
  });

  it('prefers the regular season and falls back to the first match', () => {
    const a2 = need('a2');
    expect(
      pickSeriesChampionship(a2, [
        { externalId: 1, name: 'Torneo A2 speciale' },
        { externalId: 2, name: 'Regular Season A2' },
      ])?.externalId,
    ).toBe(2);
    expect(pickSeriesChampionship(a2, [{ externalId: 1, name: 'Torneo A2 speciale' }])?.externalId).toBe(1);
  });
});
