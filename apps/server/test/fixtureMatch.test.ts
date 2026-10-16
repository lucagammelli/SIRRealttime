import { parseDvw } from '@sir/dvw-parser';
import { describe, expect, it } from 'vitest';
import type { CalendarCandidate, DvwFacts } from '../src/leagues/match.js';
import {
  AUTO_LINK_MIN_SCORE,
  candidateScore,
  cityTokens,
  dvwFacts,
  linkFixture,
  nameTokens,
  parseDvwDate,
  parseDvwTime,
  teamNameScore,
} from '../src/leagues/match.js';
import { parseCalendar } from '../src/leagues/legavolley.js';
import { fixture } from './leagueFixtures.js';

/** Team of the club in the SuperLega 2026/27 (IdCampionato 999) and its city, from the saved pages of the league. */
const PERUGIA = 6865;
const PERUGIA_CITY = 'Perugia (PG)';

/** The matches of Perugia in the real calendar 2026/27 (andata and ritorno), as `client_fixtures` holds them. */
function perugiaCalendar(): CalendarCandidate[] {
  const pages = ['calendario-999-2026-andata.html', 'calendario-999-2026-ritorno.html'].map((p) =>
    parseCalendar(fixture(p)),
  );
  return pages
    .flatMap((p) => p.fixtures)
    .filter((f) => f.home.externalId === PERUGIA || f.away.externalId === PERUGIA)
    .map((f) => ({
      id: f.externalId,
      startsAt: f.startsAt ? new Date(f.startsAt) : null,
      ourSide: f.home.externalId === PERUGIA ? 'home' : 'away',
      homeName: f.home.name,
      awayName: f.away.name,
      homeCity: f.home.externalId === PERUGIA ? PERUGIA_CITY : null,
      awayCity: f.away.externalId === PERUGIA ? PERUGIA_CITY : null,
    }));
}

/**
 * Header of a `.dvw` as DataVolley 4 writes it: `[3MATCH]` and `[3TEAMS]` lines of the two real files of Perugia
 * (only date, season, competition, codes and names; the rest of the lines is cut away).
 */
const header = (date: string, home: [string, string], away: [string, string], time = '') =>
  [
    '[3DATAVOLLEYSCOUT]',
    'FILEFORMAT: 2.0',
    '[3MATCH]',
    `${date};${time};2026/2027;Amichevoli;;;;;1252;1;Z;0;`,
    '[3TEAMS]',
    `${home[0]};${home[1]};3;;;`,
    `${away[0]};${away[1]};0;;;`,
    '[3SCOUT]',
  ].join('\r\n');

const facts = (date: string, home: string, away: string, time = ''): DvwFacts =>
  dvwFacts(parseDvw(header(date, ['H', home], ['A', away], time)));

describe('names', () => {
  it('drops case, accents, punctuation, the suffix after «_» and the generic words', () => {
    expect(nameTokens('Sir Susa Scai Perugia_Amichevoli')).toEqual(['sir', 'susa', 'scai', 'perugia']);
    expect(nameTokens("Acqua Sant'Anna Cuneo")).toEqual(['acqua', 'sant', 'anna', 'cuneo']);
    expect(nameTokens('Pallavolo Città di Castello')).toEqual(['citta', 'castello']);
    expect(cityTokens('Prata di Pordenone (PN)')).toEqual(['prata', 'pordenone']);
  });

  it('recognizes the same club with other sponsors by its city', () => {
    expect(teamNameScore('Sir Susa Scai Perugia_Amichevoli', 'Sir Susa Scai Perugia', PERUGIA_CITY)).toBe(1);
    const sponsor = teamNameScore('Sir Safety Perugia', 'Sir Susa Scai Perugia', PERUGIA_CITY);
    expect(sponsor).toBeGreaterThanOrEqual(AUTO_LINK_MIN_SCORE);
    // Without the city known, the last word of the official name plays its part.
    expect(teamNameScore('Trentino Volley', 'Itas Trentino', null)).toBeGreaterThanOrEqual(AUTO_LINK_MIN_SCORE);
    expect(teamNameScore('SUNTORY SUNBIRDS OSAKA', 'Itas Trentino', null)).toBe(0);
    expect(teamNameScore('Sir Susa Scai Perugia', 'Itas Trentino', null)).toBe(0);
    expect(teamNameScore(null, 'Itas Trentino', null)).toBe(0);
  });

  it('reads the dates and times of DataVolley', () => {
    expect(parseDvwDate('08/10/2026')).toEqual({ year: 2026, month: 10, day: 8 });
    expect(parseDvwDate('2025-01-18')).toEqual({ year: 2025, month: 1, day: 18 });
    expect(parseDvwDate('31/02/2026')).toBeNull();
    expect(parseDvwDate('')).toBeNull();
    expect(parseDvwTime('18.00.00')).toEqual({ hour: 18, minute: 0 });
    expect(parseDvwTime('25.00')).toBeNull();
  });
});

describe('link of a .dvw to the calendar', () => {
  const calendar = perugiaCalendar();

  it('has the real matches of Perugia (22, some without date yet)', () => {
    expect(calendar).toHaveLength(22);
  });

  it('links the match of the same day with the club and the opponent, whatever the sponsors', () => {
    // 1ª giornata: Cuneo – Perugia, 18/10/2026 18:00 in Italy; the scout of Perugia writes its own name first.
    const outcome = linkFixture(facts('18/10/2026', 'Sir Safety Perugia_Amichevoli', 'Cuneo Volley'), calendar);
    expect(outcome).toMatchObject({ kind: 'linked', clientFixtureId: 'n5' });
    const home = linkFixture(facts('25/10/2026', 'Sir Susa Scai Perugia', 'Prata di Pordenone'), calendar);
    expect(home).toMatchObject({ kind: 'linked', clientFixtureId: 'n7' });
  });

  it('asks to confirm a friendly match out of the calendar (the two real files of Perugia)', () => {
    // Real headers: Perugia – Suntory (08/10/2026) and Perugia – Itas Trentino (14/10/2026), no time.
    const suntory = dvwFacts(
      parseDvw(header('08/10/2026', ['PER', 'Sir Susa Scai Perugia_Amichevoli'], ['SUN', 'SUNTORY SUNBIRDS OSAKA'])),
    );
    expect(linkFixture(suntory, calendar)).toEqual({ kind: 'pending', candidates: [] });
    const trento = dvwFacts(
      parseDvw(header('14/10/2026', ['PER', 'Sir Susa Scai Perugia_Amichevoli'], ['8334', 'Itas Trentino'])),
    );
    expect(linkFixture(trento, calendar)).toEqual({ kind: 'pending', candidates: [] });
  });

  it('accepts the day after or before only without a time or near midnight', () => {
    // Monza – Perugia is on 31/10/2026 at 18:00.
    expect(linkFixture(facts('30/10/2026', 'Perugia', 'Vero Volley Monza'), calendar)).toMatchObject({
      kind: 'linked',
      clientFixtureId: 'n15',
    });
    expect(linkFixture(facts('30/10/2026', 'Perugia', 'Vero Volley Monza', '18.00.00'), calendar)).toEqual({
      kind: 'pending',
      candidates: [],
    });
    // A match at 23:30 written the day after.
    const first = calendar[0];
    if (!first) throw new Error('calendar empty');
    const late: CalendarCandidate = { ...first, id: 'late', startsAt: new Date('2026-12-01T22:30:00Z') };
    expect(linkFixture(facts('02/12/2026', 'Perugia', 'Cuneo', '00.10.00'), [late])).toMatchObject({
      kind: 'linked',
      clientFixtureId: 'late',
    });
  });

  it('asks to confirm two matches of the same day against the same opponent', () => {
    const base = calendar.find((c) => c.id === 'n5');
    if (!base) throw new Error('n5 missing');
    const twice = [base, { ...base, id: 'n5-bis' }];
    const outcome = linkFixture(facts('18/10/2026', 'Perugia', 'Cuneo'), twice);
    expect(outcome.kind).toBe('pending');
    expect(outcome.candidates.map((c) => c.clientFixtureId).sort()).toEqual(['n5', 'n5-bis']);
  });

  it('chooses by the opponent between two matches of the same day', () => {
    const base = calendar.find((c) => c.id === 'n5');
    if (!base) throw new Error('n5 missing');
    const other = { ...base, id: 'coppa', homeName: 'Allianz Milano' };
    expect(linkFixture(facts('18/10/2026', 'Perugia', 'Acqua S.Anna Cuneo'), [base, other])).toMatchObject({
      kind: 'linked',
      clientFixtureId: 'n5',
    });
  });

  it('never links without a date, and proposes the matches by name (only the ones with a date set)', () => {
    const outcome = linkFixture(facts('', 'Sir Susa Scai Perugia', 'Itas Trentino'), calendar);
    // Itas Trentino – Perugia (n25) has its date; the return match (n97) not yet.
    expect(outcome).toEqual({ kind: 'pending', candidates: [{ clientFixtureId: 'n25', score: 1 }] });
  });

  it('uses the side of «nostra squadra» when it is known', () => {
    const base = calendar.find((c) => c.id === 'n5');
    if (!base) throw new Error('n5 missing');
    const f = facts('18/10/2026', 'Cuneo', 'Perugia');
    expect(candidateScore({ ...f, ourSide: 'away' }, base)).toBeGreaterThan(
      candidateScore({ ...f, ourSide: 'home' }, base),
    );
  });
});
