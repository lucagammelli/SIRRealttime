import { describe, expect, it } from 'vitest';
import {
  DASH,
  formatCount,
  formatMinutes,
  formatPct,
  playerName,
  romeDateTime,
  romeToIso,
  teamName,
  teamShort,
  toPercent,
} from './format.ts';

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
      'Rossi',
    );
  });
});

describe('teamShort', () => {
  const ref = (name: string | null, code: string | null) => ({ home: { name, code }, away: { name: 'x', code: null } });

  it('uses a code made only of letters, uppercase, at most 4', () => {
    expect(teamShort(ref('Sir Susa Scai Perugia', 'per'), 'home')).toBe('PER');
    expect(teamShort(ref(null, 'Sunny'), 'home')).toBe('SUNN');
  });

  it('never shows a numeric DataVolley ID: the short name comes from the name', () => {
    expect(teamShort(ref('Sir Susa Scai Perugia', '9593'), 'home')).toBe('SIR');
    expect(teamShort(ref('Itas Trentino', '8334'), 'home')).toBe('ITA');
    expect(teamName(ref(null, '9593'), 'home')).toBe('Casa');
  });

  it('ignores a mixed code and derives from the name', () => {
    expect(teamShort(ref('Itas Trentino', 'T1A'), 'home')).toBe('ITA');
  });

  it('without code derives from the name; without name either, Cas', () => {
    expect(teamShort(ref('Itas Trentino', null), 'home')).toBe('ITA');
    expect(teamShort(ref(null, null), 'home')).toBe('CAS');
  });
});

describe('date and time in Italian time for the inputs', () => {
  it('reads and writes them across the summer time change', () => {
    expect(romeDateTime('2026-10-18T16:00:00.000Z')).toEqual({ date: '2026-10-18', time: '18:00' });
    expect(romeDateTime('2026-11-02T19:30:00.000Z')).toEqual({ date: '2026-11-02', time: '20:30' });
    expect(romeDateTime(null)).toEqual({ date: '', time: '' });
    expect(romeToIso('2026-10-18', '18:00')).toBe('2026-10-18T16:00:00.000Z');
    expect(romeToIso('2026-11-02', '20:30')).toBe('2026-11-02T19:30:00.000Z');
    expect(romeToIso('2026-10-25', '12:00')).toBe('2026-10-25T11:00:00.000Z');
    expect(romeToIso('', '18:00')).toBeNull();
    expect(romeToIso('2026-10-18', '')).toBeNull();
  });
});
