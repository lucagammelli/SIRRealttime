import { describe, expect, it } from 'vitest';
import type { TeamRef } from '@sir/volley-stats';
import { normalizeTeamText, ourTeamSide, OurTeamSchema, teamColorRoles } from './index.js';

const teams = (home: TeamRef, away: TeamRef) => ({ home, away });
const PERUGIA: TeamRef = { name: 'Sir Susa Vim Perugia', code: 'PER' };
const LUGO: TeamRef = { name: 'Volley Club Lugo', code: 'LUG' };

describe('team of the client', () => {
  it('reads an empty document as no team and refuses texts too long or with control characters', () => {
    expect(OurTeamSchema.parse({})).toEqual({ code: null, name: null });
    expect(OurTeamSchema.parse({ code: ' PER ', name: 'Perugia' })).toEqual({ code: 'PER', name: 'Perugia' });
    expect(OurTeamSchema.safeParse({ code: 'X'.repeat(11) }).success).toBe(false);
    expect(OurTeamSchema.safeParse({ name: 'Peru\u0007gia' }).success).toBe(false);
    expect(OurTeamSchema.safeParse({ code: '' }).success).toBe(false);
    expect(OurTeamSchema.safeParse({ other: 1 }).success).toBe(false);
  });

  it('finds our team at home and away, by code or by a text of the name', () => {
    expect(ourTeamSide(teams(PERUGIA, LUGO), { code: 'PER', name: null })).toBe('home');
    expect(ourTeamSide(teams(LUGO, PERUGIA), { code: 'PER', name: null })).toBe('away');
    expect(ourTeamSide(teams(LUGO, PERUGIA), { code: null, name: 'Perugia' })).toBe('away');
    expect(ourTeamSide(teams(PERUGIA, LUGO), { code: null, name: 'perugia' })).toBe('home');
  });

  it('ignores case and accents', () => {
    const forli: TeamRef = { name: 'Volley Forlì', code: 'for' };
    expect(ourTeamSide(teams(LUGO, forli), { code: null, name: 'FORLI' })).toBe('away');
    expect(ourTeamSide(teams(LUGO, forli), { code: 'FÒR', name: null })).toBe('away');
    expect(normalizeTeamText('  Città   di  CASTELLO ')).toBe('citta di castello');
  });

  it('gives no side when nothing (or both) matches, or without a team of the client', () => {
    expect(ourTeamSide(teams(PERUGIA, LUGO), { code: 'TRE', name: 'Trento' })).toBeNull();
    expect(ourTeamSide(teams(PERUGIA, LUGO), { code: null, name: null })).toBeNull();
    expect(ourTeamSide(teams(PERUGIA, LUGO), null)).toBeNull();
    expect(ourTeamSide(teams(PERUGIA, LUGO), { code: null, name: 'Volley' })).toBe('away');
    const both = teams({ name: 'Volley A', code: null }, { name: 'Volley B', code: null });
    expect(ourTeamSide(both, { code: null, name: 'volley' })).toBeNull();
    expect(
      ourTeamSide(teams({ name: null, code: null }, { name: null, code: null }), { code: 'PER', name: 'P' }),
    ).toBeNull();
  });

  it('prefers the code to the name, and falls back to the name when the code is not found', () => {
    const tricky = teams({ name: 'Perugia Giovani', code: 'PGV' }, { name: 'Sir Perugia', code: 'PER' });
    expect(ourTeamSide(tricky, { code: 'PER', name: 'Perugia' })).toBe('away');
    expect(ourTeamSide(teams(PERUGIA, LUGO), { code: 'XXX', name: 'Perugia' })).toBe('home');
  });

  it('maps the sides to the colour roles', () => {
    expect(teamColorRoles('home')).toEqual({ home: 'our', away: 'opponent' });
    expect(teamColorRoles('away')).toEqual({ home: 'opponent', away: 'our' });
    expect(teamColorRoles(null)).toEqual({ home: 'home', away: 'away' });
  });
});
