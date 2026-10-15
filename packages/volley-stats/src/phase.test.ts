import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParsedMatch } from '@sir/dvw-parser';
import { parseDvw } from '@sir/dvw-parser';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { describe, expect, it } from 'vitest';
import { computeMatchState } from './index.js';
import type { MatchPhase, MatchState } from './index.js';

/** Riga scout minima: codice;fase;;;;;;ora;set;posizione palleggiatore casa;ospite. */
const row = (code: string, set = 1, phase = ''): string => `${code};${phase};;;;;;18.00.00;${set};1;1;1;0`;

function text(lines: string[]): string {
  return ['[3MATCH]', '2025-01-18;18.00.00;2024/25;Test;;;;;', '[3TEAMS]', 'AAA;Alfa;0;;;', 'BBB;Beta;0;;;', '[3SCOUT]']
    .concat(lines)
    .join('\r\n');
}
const build = (lines: string[]): MatchState => computeMatchState(parseDvw(text(lines)));
const phaseOf = (lines: string[]): MatchPhase => build(lines).phase;

/** Rally completo: battuta della squadra che segna e punto `hs:as`. */
const rally = (hs: number, as: number, set = 1, team: '*' | 'a' = '*'): string[] => [
  row(`${team}08SM-~~~14C`, set, 's'),
  row(`${team}p${String(hs).padStart(2, '0')}:${String(as).padStart(2, '0')}`, set),
];

/** Set vinto 25-20 dalla casa e chiuso da `**Nset` (che DataVolley scrive col set successivo). */
const wonSet = (set: number): string[] => [...rally(25, 20, set), row(`**${set}set`, set + 1)];

/** Etichetta compatta di una fase, per confrontare le sequenze. */
function label(p: MatchPhase): string {
  switch (p.kind) {
    case 'preMatch':
      return 'preMatch';
    case 'rally':
      return `rally ${p.set}`;
    case 'timeout':
      return `timeout ${p.set} ${p.team} ${p.teamTimeouts}`;
    case 'setBreak':
      return `setBreak ${p.set}`;
    case 'matchEnd':
      return `matchEnd ${p.winner ?? '-'}`;
  }
}

/** Fasi attraversate leggendo le righe scout una alla volta (come l'agente che invia il file mentre cresce). */
function phaseSequence(parsed: ParsedMatch): string[] {
  const out: string[] = [];
  for (let k = 0; k <= parsed.scout.length; k++) {
    const l = label(computeMatchState({ ...parsed, scout: parsed.scout.slice(0, k) }).phase);
    if (out[out.length - 1] !== l) out.push(l);
  }
  return out;
}

describe('fase della partita: righe costruite', () => {
  it('prima del primo punto: preMatch (anche con formazioni e un time-out)', () => {
    expect(phaseOf([])).toEqual({ kind: 'preMatch' });
    expect(phaseOf([row('*P06'), row('*z1'), row('*T')])).toEqual({ kind: 'preMatch' });
    expect(computeMatchState(parseDvw('')).phase).toEqual({ kind: 'preMatch' });
  });

  it('in gioco dopo la prima azione o il primo punto', () => {
    expect(phaseOf([row('*08SM-~~~14C', 1, 's')])).toEqual({ kind: 'rally', set: 1 });
    expect(phaseOf(rally(1, 0))).toEqual({ kind: 'rally', set: 1 });
  });

  it('time-out: chi lo chiama, quanti nel set e punteggio; cambi e rotazioni dopo non lo chiudono', () => {
    const lines = [...rally(1, 0), ...rally(2, 0), row('aT'), row('ac03:09'), row('az2'), row('aP05')];
    expect(phaseOf(lines)).toEqual({
      kind: 'timeout',
      set: 1,
      team: 'away',
      teamTimeouts: 1,
      homeScore: 2,
      awayScore: 0,
    });
    // ripresa: la prima azione dopo il time-out lo chiude
    expect(phaseOf([...lines, row('*08SM-~~~14C', 1, 's')])).toEqual({ kind: 'rally', set: 1 });
    // secondo time-out della stessa squadra
    expect(phaseOf([...lines, ...rally(3, 0), row('aT')])).toMatchObject({ kind: 'timeout', teamTimeouts: 2 });
    // tutti e due di fila: conta l'ultimo
    expect(phaseOf([...rally(1, 0), row('aT'), row('*T')])).toMatchObject({ team: 'home', teamTimeouts: 1 });
  });

  it('i time-out si contano per set', () => {
    const lines = [...rally(1, 0), row('*T'), ...rally(25, 0), row('**1set', 2), ...rally(1, 0, 2), row('*T', 2)];
    expect(phaseOf(lines)).toEqual({
      kind: 'timeout',
      set: 2,
      team: 'home',
      teamTimeouts: 1,
      homeScore: 1,
      awayScore: 0,
    });
  });

  it('fine set: pausa fino alla prima azione del set successivo', () => {
    const closed = wonSet(1);
    const expected: MatchPhase = {
      kind: 'setBreak',
      set: 1,
      nextSet: 2,
      winner: 'home',
      homeScore: 25,
      awayScore: 20,
    };
    expect(phaseOf(closed)).toEqual(expected);
    // DataVolley scrive subito formazioni e palleggiatori del set nuovo: la pausa continua
    const lineups = [...closed, row('*P06>LUp', 2), row('*z1>LUp', 2), row('aP05>LUp', 2), row('az2>LUp', 2)];
    expect(phaseOf(lineups)).toEqual(expected);
    // un codice verde o una riga illeggibile non la chiudono
    expect(phaseOf([...lineups, 'garbage', row('*$$&H#', 2)])).toEqual(expected);
    // la prima battuta del set 2 sì
    expect(phaseOf([...lineups, row('a05SM-~~~41C', 2, 's')])).toEqual({ kind: 'rally', set: 2 });
    // un time-out a 0-0 del set 2 diventa la pausa del time-out
    expect(phaseOf([...lineups, row('*T', 2)])).toMatchObject({ kind: 'timeout', set: 2, homeScore: 0, awayScore: 0 });
  });

  it('fine set vinta dagli ospiti; `**0set` non è una fine set', () => {
    const lines = [...rally(20, 25, 1, 'a'), row('**1set', 2)];
    expect(phaseOf(lines)).toMatchObject({ kind: 'setBreak', set: 1, winner: 'away', homeScore: 20, awayScore: 25 });
    expect(phaseOf([...rally(3, 2), row('**0set')])).toEqual({ kind: 'rally', set: 1 });
  });

  it('fine partita al terzo set vinto, con vincitore e set vinti', () => {
    const lines = [...wonSet(1), ...wonSet(2), ...rally(25, 20, 3)];
    // 25-20 nel terzo set senza `**3set`: il set non è ancora chiuso
    expect(phaseOf(lines)).toEqual({ kind: 'rally', set: 3 });
    expect(phaseOf([...lines, row('**3set', 4)])).toEqual({
      kind: 'matchEnd',
      winner: 'home',
      setsWon: { home: 3, away: 0 },
      lastSet: 3,
    });
  });

  it('file troncato a metà della riga di fine set: la riga è illeggibile, la fase resta in gioco', () => {
    const full = text(wonSet(1));
    const cut = full.slice(0, full.lastIndexOf('**1set') + 4);
    expect(computeMatchState(parseDvw(cut)).phase).toEqual({ kind: 'rally', set: 1 });
    expect(computeMatchState(parseDvw(full)).phase.kind).toBe('setBreak');
  });

  it('deterministica e JSON-serializzabile', () => {
    const lines = [...wonSet(1), row('*T', 2)];
    expect(build(lines).phase).toEqual(build(lines).phase);
    const state = build(lines);
    expect(JSON.parse(JSON.stringify(state.phase))).toEqual(state.phase);
  });
});

describe('fase della partita: file interi', () => {
  it('campione samples/partita-sintetica.dvw riga per riga', () => {
    const file = fileURLToPath(new URL('../../../samples/partita-sintetica.dvw', import.meta.url));
    expect(phaseSequence(parseDvw(readFileSync(file)))).toEqual([
      'preMatch',
      'rally 1',
      'setBreak 1',
      'rally 2',
      'timeout 2 home 1',
      'rally 2',
      'timeout 2 home 2',
      'rally 2',
      'timeout 2 away 1',
      'rally 2',
      'timeout 2 away 2',
      'rally 2',
      'setBreak 2',
      'rally 3',
      'timeout 3 home 1',
      'rally 3',
      'matchEnd away',
    ]);
  });

  it('partite del simulatore: una pausa per ogni set chiuso, poi la fine partita', () => {
    for (const sets of [3, 4, 5] as const) {
      const match = generateMatch({ seed: 7, sets });
      const sequence = phaseSequence(parseDvw(renderDvw(match, match.lines.length)));
      expect(sequence[0]).toBe('preMatch');
      expect(sequence[sequence.length - 1]).toMatch(/^matchEnd (home|away)$/);
      expect(sequence.filter((l) => l.startsWith('setBreak'))).toEqual(
        Array.from({ length: sets - 1 }, (_, i) => `setBreak ${i + 1}`),
      );
    }
  });
});
