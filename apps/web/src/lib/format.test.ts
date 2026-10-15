import { describe, expect, it } from 'vitest';
import { DASH, formatCount, formatMinutes, formatPct, playerName, teamName, teamShort, toPercent } from './format.ts';

describe('formatPct', () => {
  it('shows ratios as percentages with one decimal', () => {
    expect(formatPct(0.483)).toBe('48,3%');
    expect(formatPct(1)).toBe('100,0%');
    expect(formatPct(0)).toBe('0,0%');
    expect(formatPct(-0.125)).toBe('-12,5%');
  });

  it('shows null and invalid values as a dash', () => {
    expect(formatPct(null)).toBe(DASH);
    expect(formatPct(undefined)).toBe(DASH);
    expect(formatPct(Number.NaN)).toBe(DASH);
    expect(DASH).toBe('–');
  });
});

describe('other formats', () => {
  it('formats counts and percent values for charts', () => {
    expect(formatCount(12)).toBe('12');
    expect(formatCount(null)).toBe('–');
    expect(toPercent(0.4567)).toBe(45.7);
    expect(toPercent(null)).toBeNull();
  });

  it('formats durations', () => {
    expect(formatMinutes(23)).toBe('23 min');
    expect(formatMinutes(65)).toBe('1 h 05 min');
    expect(formatMinutes(null)).toBe('–');
  });

  it('falls back on Casa/Ospiti and jersey numbers', () => {
    const teams = { home: { name: null, code: null }, away: { name: 'Volley Club Lugo', code: null } };
    expect(teamName(teams, 'home')).toBe('Casa');
    expect(teamName(teams, 'away')).toBe('Volley Club Lugo');
    expect(teamShort(teams, 'away')).toBe('VOL');
    expect(playerName(undefined, 7)).toBe('#7');
    expect(playerName({ number: 7, firstName: 'Luca', lastName: 'Rossi', role: null, specialRole: null }, 7)).toBe(
      'Rossi L.',
    );
  });
});
