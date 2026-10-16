import { describe, expect, it } from 'vitest';
import {
  calendarUrl,
  LeagueFormatError,
  logoUrl,
  parseCalendar,
  parseOfficialDate,
  parseStandings,
  parseTeam,
  rejectedUrlReason,
  standingsUrl,
  teamUrl,
} from '../src/leagues/legavolley.js';
import { romeDateKey, romeDayAt, romeToUtc } from '../src/leagues/romeTime.js';
import { fixture } from './leagueFixtures.js';

describe('Rome time', () => {
  it('converts official times to UTC with summer time, also on the days of the change', () => {
    expect(romeToUtc(2025, 10, 25, 18, 0)?.toISOString()).toBe('2025-10-25T16:00:00.000Z');
    expect(romeToUtc(2025, 10, 26, 16, 0)?.toISOString()).toBe('2025-10-26T15:00:00.000Z');
    expect(romeToUtc(2026, 3, 28, 20, 30)?.toISOString()).toBe('2026-03-28T19:30:00.000Z');
    expect(romeToUtc(2026, 3, 29, 18, 0)?.toISOString()).toBe('2026-03-29T16:00:00.000Z');
    // 02:30 does not exist on 29 March 2026 (moved to 03:30) and happens twice on 25 October 2026 (the second).
    expect(romeToUtc(2026, 3, 29, 2, 30)?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(romeToUtc(2026, 10, 25, 2, 30)?.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  it('rejects dates that do not exist', () => {
    expect(romeToUtc(2026, 2, 30, 18, 0)).toBeNull();
    expect(romeToUtc(2026, 13, 1, 18, 0)).toBeNull();
    expect(romeToUtc(2026, 1, 1, 24, 0)).toBeNull();
  });

  it('gives the Rome day and its hours in UTC', () => {
    expect(romeDateKey(new Date('2026-10-16T22:30:00Z'))).toBe('2026-10-17');
    const day = romeDayAt(new Date('2026-10-25T12:00:00Z'), 4);
    expect(day.at.toISOString()).toBe('2026-10-25T03:00:00.000Z');
    expect(day.nextDay.toISOString()).toBe('2026-10-26T03:00:00.000Z');
  });

  it('reads the cell «Data e Ora ufficiale»', () => {
    expect(parseOfficialDate('Mercoledí 26/11/2025\nOre 20:30')).toBe('2025-11-26T19:30:00.000Z');
    expect(parseOfficialDate('Giovedí 30/4/2026\nOre 20:30')).toBe('2026-04-30T18:30:00.000Z');
    expect(parseOfficialDate('')).toBeNull();
    expect(parseOfficialDate('Sabato 17/10/2026')).toBeNull();
  });
});

describe('URLs of the connector', () => {
  it('builds only fixed paths of www.legavolley.it with numeric ids', () => {
    expect(calendarUrl(2025, 974).toString()).toBe('https://www.legavolley.it/calendario/?Anno=2025&IdCampionato=974');
    expect(calendarUrl(2025, 974, 2).toString()).toBe(
      'https://www.legavolley.it/calendario/?Anno=2025&IdCampionato=974&IdFase=2&IdSquadra=0',
    );
    expect(standingsUrl(2026, 999).toString()).toBe('https://www.legavolley.it/classifica/?Anno=2026&IdCampionato=999');
    expect(teamUrl(6865).toString()).toBe('https://www.legavolley.it/team/6865');
    expect(logoUrl(6865).toString()).toBe(
      'https://www.legavolley.it/GetLogo.aspx?Field=LogoWeb&maxWidth=220&Proc=LogoSquadra&Web=1&Key=6865&Char=False',
    );
    expect(() => teamUrl(-1)).toThrow(RangeError);
    expect(() => calendarUrl(2025, 1.5)).toThrow(RangeError);
  });

  it('refuses other hosts, plain http, other paths and the paths of robots.txt', () => {
    for (const ok of [calendarUrl(2025, 974), teamUrl(1), logoUrl(1), standingsUrl(2025, 974)])
      expect(rejectedUrlReason(ok)).toBeNull();
    expect(rejectedUrlReason(new URL('http://www.legavolley.it/team/1'))).toBe('solo https');
    expect(rejectedUrlReason(new URL('https://legavolley.it/team/1'))).toBe('host non ammesso');
    expect(rejectedUrlReason(new URL('https://www.legavolley.it.evil.test/team/1'))).toBe('host non ammesso');
    expect(rejectedUrlReason(new URL('https://www.legavolley.it:8443/team/1'))).toBe('host non ammesso');
    expect(rejectedUrlReason(new URL('https://u:p@www.legavolley.it/team/1'))).toBe('credenziali nell’indirizzo');
    expect(rejectedUrlReason(new URL('https://www.legavolley.it/match/39283'))).toBe('percorso non ammesso');
    for (const path of [
      '/statistiche/?TipoStat=1.1',
      '/rendimento/',
      '/pillole/x',
      '/confronti/',
      '/matchdaily',
      '/wp-admin/',
    ])
      expect(rejectedUrlReason(new URL(path, 'https://www.legavolley.it'))).toBe('percorso vietato da robots.txt');
    expect(rejectedUrlReason(new URL('https://www.legavolley.it/STATISTICHE/'))).toBe('percorso vietato da robots.txt');
  });
});

describe('calendar page', () => {
  it('reads the regular season 2025/26 with results (andata)', () => {
    const c = parseCalendar(fixture('calendario-974-2025-andata.html'));
    expect(c).toMatchObject({ season: 2025, championshipId: 974, name: 'Regular Season SuperLega Credem Banca' });
    expect(c.phases).toEqual([
      { id: 1, name: 'Andata' },
      { id: 2, name: 'Ritorno' },
    ]);
    expect(c.phaseId).toBe(1);
    expect(c.teams).toHaveLength(12);
    expect(c.teams).toContainEqual({ externalId: 6710, name: 'Sir Susa Scai Perugia' });
    expect(c.fixtures).toHaveLength(66);
    expect(new Set(c.fixtures.map((f) => f.roundLabel)).size).toBe(11);
    expect(c.fixtures.every((f) => f.status === 'played' && f.providerMatchId !== null)).toBe(true);
    expect(c.fixtures.find((f) => f.number === 8)).toEqual({
      externalId: 'n8',
      number: 8,
      phaseId: 1,
      phase: 'Andata',
      round: 2,
      roundLabel: '2ª Giornata Andata',
      startsAt: '2025-10-26T19:30:00.000Z',
      home: { externalId: 6710, name: 'Sir Susa Scai Perugia' },
      away: { externalId: 6746, name: 'Cucine Lube Civitanova' },
      venue: 'Pala Barton Energy',
      venueCity: 'Perugia (PG)',
      venueAddress: 'Località Pian di Massiano, Perugia (PG)',
      status: 'played',
      homeSets: 3,
      awaySets: 2,
      providerMatchId: expect.any(Number) as number,
      note: expect.any(String) as string,
    });
  });

  it('converts the times around the end of summer time (25-26 October 2025)', () => {
    const c = parseCalendar(fixture('calendario-974-2025-andata.html'));
    const at = (n: number) => c.fixtures.find((f) => f.number === n)?.startsAt;
    expect(at(11)).toBe('2025-10-25T16:00:00.000Z'); // Sabato 25/10 ore 18:00, ora legale
    expect(at(7)).toBe('2025-10-26T15:00:00.000Z'); // Domenica 26/10 ore 16:00, ora solare
    expect(at(1)).toBe('2025-10-20T18:30:00.000Z');
  });

  it('reads the ritorno and the matches of Perugia', () => {
    const c = parseCalendar(fixture('calendario-974-2025-ritorno.html'));
    expect(c.phaseId).toBe(2);
    expect(c.fixtures).toHaveLength(66);
    const perugia = c.fixtures.filter((f) => f.home.externalId === 6710 || f.away.externalId === 6710);
    expect(perugia).toHaveLength(11);
    expect(perugia[0]).toMatchObject({
      number: 67,
      roundLabel: '1ª Giornata Ritorno',
      startsAt: '2025-11-26T19:30:00.000Z',
      home: { name: 'Sir Susa Scai Perugia' },
      away: { name: 'Vero Volley Monza' },
      homeSets: 3,
      awaySets: 1,
      providerMatchId: 39283,
    });
  });

  it('reads the season 2026/27 not played yet, with dates still to be set', () => {
    const c = parseCalendar(fixture('calendario-999-2026-andata.html'));
    expect(c).toMatchObject({ season: 2026, championshipId: 999, phaseId: 1 });
    expect(c.teams).toHaveLength(12);
    expect(c.fixtures).toHaveLength(66);
    expect(c.fixtures.every((f) => f.status === 'scheduled' && f.homeSets === null)).toBe(true);
    expect(c.fixtures[0]).toMatchObject({
      externalId: 'n1',
      startsAt: '2026-10-17T16:00:00.000Z',
      home: { externalId: 6864, name: 'Rana Verona' },
      away: { externalId: 6860, name: 'Cucine Lube Civitanova' },
      providerMatchId: null,
    });
    expect(c.fixtures.find((f) => f.number === 66)?.startsAt).toBeNull();
    const ritorno = parseCalendar(fixture('calendario-999-2026-ritorno.html'));
    expect(ritorno.fixtures.map((f) => f.number)).toEqual(Array.from({ length: 66 }, (_, k) => 67 + k));
  });

  it('reads a play off page (rounds «Gara N», row header without its closing bracket)', () => {
    const c = parseCalendar(fixture('calendario-991-2025-finale.html'));
    expect(c.phases.map((p) => p.name)).toEqual(['Quarti', 'Semifinali', 'Finale']);
    expect(c.fixtures.map((f) => [f.roundLabel, f.round, f.homeSets, f.awaySets])).toEqual([
      ['Gara 1 Finale', 1, 3, 0],
      ['Gara 2 Finale', 2, expect.any(Number), expect.any(Number)],
      ['Gara 3 Finale', 3, 3, 1],
    ]);
  });

  it('fails with a clear error when the filters or the columns are missing', () => {
    const page = fixture('calendario-974-2025-andata.html');
    expect(() => parseCalendar(page.replace('id="Anno"', 'id="Stagione"'))).toThrow(LeagueFormatError);
    expect(() => parseCalendar(page.replace('id="Anno"', 'id="Stagione"'))).toThrow(/stagione/);
    expect(() => parseCalendar(page.replaceAll('<th>Ospite</th>', '<th>Trasferta</th>'))).toThrow(/colonne attese/);
    expect(() => parseCalendar(page.replaceAll('Data e Ora ufficiale', 'Quando'))).toThrow(/formato sconosciuto/);
    expect(() => parseCalendar(page.replaceAll('/team/', '/squadra/'))).toThrow(/squadre riconoscibili/);
    expect(() => parseCalendar('<html><body>Manutenzione</body></html>')).toThrow(LeagueFormatError);
    // IdCampionato of another season: the site selects no championship.
    expect(() => parseCalendar(page.replace('<option selected value=974>', '<option value=974>'))).toThrow(
      /non ha questo campionato nella stagione 2025\/2026/,
    );
  });
});

describe('standings page', () => {
  it('reads the standings 2025/26', () => {
    const s = parseStandings(fixture('classifica-974-2025.html'));
    expect(s).toMatchObject({ season: 2025, championshipId: 974 });
    expect(s.rows).toHaveLength(12);
    expect(s.rows[0]).toEqual({
      position: 1,
      teamName: 'Sir Susa Scai Perugia',
      points: 58,
      played: 22,
      won: 20,
      lost: 2,
      byResult: [9, 8, 3, 1, 1, 0],
      setsWon: 63,
      setsLost: 20,
      pointsFor: 1960,
      pointsAgainst: 1686,
      setRatio: 3.15,
      pointRatio: 1.16,
    });
    expect(s.rows.map((r) => r.position)).toEqual(Array.from({ length: 12 }, (_, k) => k + 1));
  });

  it('reads the standings 2026/27 before the first match (empty values, quotients «-»)', () => {
    const s = parseStandings(fixture('classifica-999-2026.html'));
    expect(s.rows).toHaveLength(12);
    expect(s.rows[0]).toMatchObject({ teamName: "Acqua Sant'Anna Cuneo", points: 0, played: 0, setRatio: null });
  });

  it('fails with a clear error when the table changes', () => {
    const page = fixture('classifica-974-2025.html');
    expect(() => parseStandings(page.replace('<th>Fatti</th>', '<th>Realizzati</th>'))).toThrow(/tabella attesa/);
    expect(() => parseStandings(page.replace('>1.960<', '>molti<'))).toThrow(/non numerici/);
  });
});

describe('team page', () => {
  it('reads name and venue', () => {
    expect(parseTeam(fixture('squadra-6865.html'))).toEqual({
      name: 'Sir Susa Scai Perugia',
      venue: 'Pala Barton Energy',
      venueAddress: 'Località Pian di Massiano',
      city: 'Perugia (PG)',
    });
    expect(() => parseTeam('<html></html>')).toThrow(/senza il nome/);
  });
});
