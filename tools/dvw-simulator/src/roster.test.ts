import { parseDvw } from '@arenalive/dvw-parser';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { dvwField, generateMatch, renderDvw, ROSTER_MIN_PLAYERS, Rng, rosterPlayers } from './index.js';
import type { RosterPlayer } from './index.js';

const ROSTER: RosterPlayer[] = [
  { number: 6, lastName: 'Giannelli', firstName: 'Simone', role: 'S' },
  { number: 14, lastName: 'Ben Tara', firstName: 'Wassim', role: 'O' },
  { number: 9, lastName: 'Plotnytskyi', firstName: 'Oleh', role: 'H' },
  { number: 11, lastName: 'Semeniuk', firstName: 'Kamil', role: 'H' },
  { number: 22, lastName: 'Russo', firstName: 'Roberto', role: 'M' },
  { number: 17, lastName: 'Solé', firstName: 'Sebastián', role: 'M' },
  { number: 2, lastName: 'Colaci', firstName: 'Massimo', role: 'L' },
  { number: 33, lastName: 'Ishikawa', firstName: 'Yuki', role: 'H' },
  { number: 5, lastName: 'Loser', firstName: 'Agustín', role: 'M' },
  { number: 8, lastName: 'Herrera', firstName: 'Jesús', role: 'O' },
  { number: 1, lastName: 'Zoppellari', firstName: 'Paolo', role: 'S' },
  { number: 13, lastName: 'Candellaro', firstName: 'Davide', role: null },
  { number: 7, lastName: 'Russo', firstName: 'Davide', role: null },
];

const decode = (b: Uint8Array): string => iconv.decode(Buffer.from(b), 'win1252');
const numbers = (players: { number: number }[]): number[] => players.map((p) => p.number);

describe('rosterPlayers', () => {
  it('keeps every player of the roster with number, names and role, without two players on one number', () => {
    const players = rosterPlayers(new Rng(1), ROSTER, 1000);
    expect(players).toHaveLength(ROSTER.length);
    for (const p of ROSTER) {
      const got = players.find((q) => q.number === p.number);
      expect(got, String(p.number)).toMatchObject({ lastName: p.lastName, firstName: p.firstName });
      if (p.role) expect(got?.role).toBe(p.role);
    }
    expect(new Set(numbers(players)).size).toBe(players.length);
    expect(new Set(players.map((p) => p.id)).size).toBe(players.length);
  });

  it('gives the players without role the roles missing (a full team first)', () => {
    const players = rosterPlayers(new Rng(1), ROSTER, 1000);
    // Three outside hitters and three middles in the roster: the two without role complete the full team (4 H, 4 M).
    expect(players.find((p) => p.number === 13)?.role).toBe('H');
    expect(players.find((p) => p.number === 7)?.role).toBe('M');
  });

  it('completes a short roster with generated players on numbers not used, with every role', () => {
    const short: RosterPlayer[] = [
      { number: 1, lastName: 'Primo', firstName: 'Uno', role: 'H' },
      { number: 2, lastName: 'Secondo', firstName: 'Due', role: 'H' },
      { number: 3, lastName: 'Terzo', firstName: 'Tre', role: null },
      { number: 3, lastName: 'Doppio', firstName: 'Numero', role: 'S' },
      { number: 120, lastName: 'Fuori', firstName: 'Numero', role: 'S' },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const players = rosterPlayers(new Rng(seed), short, 1000);
      expect(players.length).toBeGreaterThanOrEqual(ROSTER_MIN_PLAYERS);
      expect(new Set(numbers(players)).size).toBe(players.length);
      expect(numbers(players).every((n) => n >= 0 && n <= 99)).toBe(true);
      expect(players.filter((p) => p.number === 3)).toEqual([
        expect.objectContaining({ lastName: 'Terzo', role: 'S' }),
      ]);
      expect(players.some((p) => p.lastName === 'Doppio' || p.lastName === 'Fuori')).toBe(false);
      const count = (role: string) => players.filter((p) => p.role === role).length;
      expect(count('S')).toBeGreaterThanOrEqual(1);
      expect(count('O')).toBeGreaterThanOrEqual(1);
      expect(count('H')).toBeGreaterThanOrEqual(2);
      expect(count('M')).toBeGreaterThanOrEqual(2);
      expect(count('L')).toBeGreaterThanOrEqual(1);
      // The generated players never take a surname of the roster.
      expect(players.filter((p) => p.lastName === 'Primo')).toHaveLength(1);
    }
  });

  it('an empty roster gives a whole generated team', () => {
    const players = rosterPlayers(new Rng(5), [], 1000);
    expect(players).toHaveLength(ROSTER_MIN_PLAYERS);
    expect(new Set(numbers(players)).size).toBe(players.length);
  });

  it('cleans the names for the file', () => {
    expect(dvwField(' Rossi;\r\nBianchi ')).toBe('Rossi Bianchi');
  });
});

describe('generateMatch with a roster', () => {
  it('our team plays with the numbers of the roster, the opponent with numbers of its own', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMatch({ seed, sets: 4, awayRoster: ROSTER, awayCode: 'PER', homeCode: 'AVV' });
      expect(numbers(m.away.players).sort((a, b) => a - b)).toEqual(numbers(ROSTER).sort((a, b) => a - b));
      expect(new Set(numbers(m.home.players)).size).toBe(m.home.players.length);
      expect(m.away.code).toBe('PER');
      expect(m.home.code).toBe('AVV');
      const allowed = new Set(numbers(ROSTER));
      for (const line of m.lines) {
        if (line.kind === 'action' && line.code.startsWith('a'))
          expect(allowed.has(Number(line.code.slice(1, 3)))).toBe(true);
        for (const n of line.positions.slice(6)) expect(allowed.has(n)).toBe(true);
      }
    }
  });

  it('the setter, libero and players of the file are the ones of the roster', () => {
    const m = generateMatch({ seed: 3, homeRoster: ROSTER });
    const parsed = parseDvw(decode(renderDvw(m, m.lines.length)));
    expect(parsed.warnings).toEqual([]);
    const giannelli = parsed.homePlayers.find((p) => p.number === 6);
    expect(giannelli).toMatchObject({ lastName: 'Giannelli', firstName: 'Simone' });
    // The first setter of the roster sets, its libero receives.
    const setters = m.lines.filter((l) => l.kind === 'setter' && l.code.startsWith('*')).map((l) => l.code);
    expect(new Set(setters)).toEqual(new Set(['*P06']));
    expect(m.lines.some((l) => l.code.startsWith('*02R'))).toBe(true);
  });

  it('is deterministic for the same roster and seed; without a roster it does not change', () => {
    const a = renderDvw(generateMatch({ seed: 9, homeRoster: ROSTER }), 100000);
    const b = renderDvw(generateMatch({ seed: 9, homeRoster: ROSTER }), 100000);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const plain = generateMatch({ seed: 9 });
    expect(plain.home.code).toBe('PAL');
    expect(plain.home.players.length).toBeGreaterThanOrEqual(12);
  });
});
