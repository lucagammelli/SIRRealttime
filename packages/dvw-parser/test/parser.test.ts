import { readFileSync } from 'node:fs';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { decodeDvw, extractScoutLines, parseDvw, parseScoutLine } from '../src/index.js';
import type { ScoutEntry } from '../src/index.js';

const one = (line: string): { e: ScoutEntry; w: string[] } => {
  const w: string[] = [];
  return { e: parseScoutLine(line, 0, w), w };
};

describe('codici speciali', () => {
  it('point', () => {
    expect(one('*p25:23').e).toMatchObject({ kind: 'point', team: 'home', homeScore: 25, awayScore: 23 });
    expect(one('ap01:02').e).toMatchObject({ kind: 'point', team: 'away', homeScore: 1, awayScore: 2 });
  });
  it('rotation', () => {
    expect(one('*z3').e).toMatchObject({ kind: 'rotation', team: 'home', number: 3 });
    expect(one('az6').e).toMatchObject({ kind: 'rotation', team: 'away', number: 6 });
  });
  it('substitution', () => {
    expect(one('*c05:12').e).toMatchObject({ kind: 'substitution', team: 'home', out: 5, in: 12 });
    expect(one('ac04:09').e).toMatchObject({ team: 'away', out: 4, in: 9 });
  });
  it('timeout', () => {
    expect(one('*T').e).toMatchObject({ kind: 'timeout', team: 'home' });
    expect(one('aT').e).toMatchObject({ kind: 'timeout', team: 'away' });
  });
  it('setter', () => {
    expect(one('*P05').e).toMatchObject({ kind: 'setter', team: 'home', number: 5 });
    expect(one('aP12').e).toMatchObject({ kind: 'setter', team: 'away', number: 12 });
  });
  it('setEnd', () => {
    expect(one('**1set').e).toMatchObject({ kind: 'setEnd', setNumber: 1 });
  });
});

describe('azioni', () => {
  it('completa', () => {
    const { e, w } = one('a07AH#X5F45BH2');
    expect(e).toMatchObject({
      kind: 'action',
      team: 'away',
      player: 7,
      skill: 'attack',
      hitType: 'H',
      evaluation: '#',
      combination: 'X5',
      setTarget: 'F',
      startZone: '4',
      endZone: '5',
      endSubZone: 'B',
      skillType: 'H',
      playersCount: '2',
    });
    expect(w).toEqual([]);
  });
  it('chiamata K1', () => {
    expect(one('a03EH+K1C').e).toMatchObject({ skill: 'set', combination: 'K1', setTarget: 'C' });
  });
  it('parziale e con ~', () => {
    const { e } = one('*01SM+~~~~~~');
    expect(e).toMatchObject({ skill: 'serve', hitType: 'M', evaluation: '+' });
    expect(e).not.toHaveProperty('combination');
    expect(one('*08SM-~~~12C').e).toMatchObject({ startZone: '1', endZone: '2', endSubZone: 'C' });
    expect(one('*08SM-~~~12C').e).not.toHaveProperty('setTarget');
    expect(one('a14AH+V5~42A').e).toMatchObject({ combination: 'V5', startZone: '4', endZone: '2', endSubZone: 'A' });
    expect(e).not.toHaveProperty('startZone');
    const p = one('*02R').e;
    expect(p).toMatchObject({ kind: 'action', skill: 'reception' });
    expect(p).not.toHaveProperty('evaluation');
  });
  it('tutte le skill', () => {
    const map: Record<string, string> = {
      S: 'serve',
      R: 'reception',
      A: 'attack',
      B: 'block',
      D: 'dig',
      E: 'set',
      F: 'freeball',
    };
    for (const [c, s] of Object.entries(map)) expect(one(`*01${c}H+`).e).toMatchObject({ skill: s });
  });
  it('campi dopo il codice (layout DV4)', () => {
    const { e } = one('a05SM-~~~16A;s;;;0328;;8275;15.08.45;1;1;6;1;180;;7;14;18;2;17;12;6;8;5;3;9;11;');
    expect(e).toMatchObject({
      kind: 'action',
      team: 'away',
      player: 5,
      skill: 'serve',
      evaluation: '-',
      startZone: '1',
      endZone: '6',
      endSubZone: 'A',
      pointPhase: 's',
      startCoordinate: '0328',
      endCoordinate: '8275',
      time: '15.08.45',
      set: 1,
      homeSetterPosition: 1,
      awaySetterPosition: 6,
      videoFile: 1,
      videoTime: 180,
      homeLineup: [7, 14, 18, 2, 17, 12],
      awayLineup: [6, 8, 5, 3, 9, 11],
    });

    expect(e.rawLine).toContain('15.08.45');
  });
  it('campi vuoti o mancanti', () => {
    const { e } = one('*01SM+');
    expect(e.homeLineup).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(e.time).toBeUndefined();
  });
  it('suffisso > su setter e rotazione', () => {
    expect(one('*P05>LUp').e).toMatchObject({ kind: 'setter', number: 5, suffix: '>LUp' });
    expect(one('*z3>LUp').e).toMatchObject({ kind: 'rotation', number: 3, suffix: '>LUp' });
    expect(one('az3').e).not.toHaveProperty('suffix');
  });
  it('codici verdi', () => {
    const { e, w } = one('*$$&H#');
    expect(e).toMatchObject({ kind: 'greenCode', team: 'home', symbol: '&', detail: 'H#' });
    expect(one('a$$&H#;;;').e.kind).toBe('greenCode');
    expect(w).toEqual([]);
  });
});

describe('righe malformate', () => {
  it('unknown + warning, mai eccezioni', () => {
    for (const l of ['zzz', '*', '*01X+', '*pxx', '**set', '']) {
      const { e, w } = one(l);
      expect(e.kind).toBe('unknown');
      expect(w).toHaveLength(1);
    }
  });
});

describe('parseDvw', () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/partita.dvw', import.meta.url)));
  const fixture = decodeDvw(bytes);

  it('fixture completa', () => {
    const m = parseDvw(bytes);
    expect(parseDvw(fixture)).toEqual(m);
    expect(m.match).toMatchObject({ date: '10/01/2026', time: '18.00.00', season: '2025/2026', league: 'Serie B' });
    expect(m.home).toMatchObject({ code: 'PCI', name: 'Pallavolo Città', setsWon: 1, coach: 'Rossi Mario' });
    expect(m.away?.code).toBe('OSP');
    expect(m.homePlayers[0]).toMatchObject({
      teamIndex: 0,
      number: 7,
      index: 1,
      startPositions: [1, undefined, undefined, undefined, undefined],
      id: '1001',
      lastName: 'Verdi',
      firstName: 'Anna',
      nickname: 'Annie',
      specialRole: 'L',
      roleCode: '1',
      role: 'libero',
    });
    expect(m.homePlayers[2]?.startPositions).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(m.homePlayers[1]).toMatchObject({ specialRole: 'C', role: 'setter' });
    expect(m.awayPlayers[0]).toMatchObject({ teamIndex: 1, number: 3, role: 'outside' });
    expect(m.sets[0]).toMatchObject({
      number: 1,
      finished: true,
      partials: ['8-6', '16-12', '21-18'],
      finalScore: '25-23',
      homeScore: 25,
      awayScore: 23,
      minutes: 32,
    });
    expect(m.scout.length).toBeGreaterThan(15);
    expect(m.scout.map((s) => s.index)).toEqual(m.scout.map((_, i) => i));
    expect(m.scout.at(-1)).toMatchObject({ kind: 'setEnd', setNumber: 1 });
    expect(m.rawSections['SCOUT']).toContain('**1set');
    expect(m.rawSections['MORE']).toContain('Palazzetto');
    expect(m.warnings).toEqual([]);
  });

  it('CRLF e LF equivalenti; extractScoutLines', () => {
    const lf = fixture.replace(/\r\n/g, '\n');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(parseDvw(crlf).scout).toEqual(parseDvw(lf).scout);
    expect(extractScoutLines(crlf)).toEqual(extractScoutLines(lf));
    expect(extractScoutLines(lf)[0]).toMatch(/^\*P07>LUp;/);
  });

  it('Windows-1252', () => {
    const enc = iconv.encode('[3TEAMS]\nPCI;Pallavolo Città;0;Rossi\nOSP;Perché;0;X\n', 'win1252');
    const m = parseDvw(new Uint8Array(enc));
    expect(m.home?.name).toBe('Pallavolo Città');
    expect(m.away?.name).toBe('Perché');
  });

  it('roleCode come constructor/__proto__ non dà un ruolo', () => {
    const text = '[3PLAYERS-H]\n0;1;1;*;*;*;*;*;9;A;B;;;constructor;\n0;2;2;*;*;*;*;*;9;A;B;;;__proto__;\n';
    const p = parseDvw(text).homePlayers;
    expect(p.map((x) => x.role)).toEqual([undefined, undefined]);
    expect(p[0]?.roleCode).toBe('constructor');
  });

  it('UTF-8 con BOM troncato o non valido: mai eccezioni', () => {
    const head = Buffer.from('[3TEAMS]\nPCI;Citt', 'utf8');
    const truncated = new Uint8Array([0xef, 0xbb, 0xbf, ...head, 0xc3]);
    expect(() => parseDvw(truncated)).not.toThrow();
    expect(parseDvw(truncated).home?.name).toContain('Citt');
    const invalid = new Uint8Array([0xef, 0xbb, 0xbf, ...head, 0xff, 0xfe, 0x3b]);
    expect(() => parseDvw(invalid)).not.toThrow();
  });

  it('UTF-8 con BOM e senza', () => {
    const txt = '[3TEAMS]\nPCI;Pallavolo Città;0;Rossi\n';
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(txt, 'utf8')]);
    expect(parseDvw(bom).home?.name).toBe('Pallavolo Città');
    expect(decodeDvw(new Uint8Array(Buffer.from(txt, 'utf8')))).toBe(txt);
  });

  it('sezioni mancanti', () => {
    const m = parseDvw('[3MORE]\nx\n');
    expect(m.scout).toEqual([]);
    expect(m.home).toBeUndefined();
    expect(m.warnings.length).toBe(3);
    expect(() => parseDvw('')).not.toThrow();
  });

  it('riga malformata nello scout genera warning', () => {
    const m = parseDvw('[3SCOUT]\n*01SH+\nboh\n');
    expect(m.scout.map((s) => s.kind)).toEqual(['action', 'unknown']);
    expect(m.warnings.some((w) => w.includes('boh'))).toBe(true);
  });
});
