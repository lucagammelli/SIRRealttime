import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDvw } from '@arenalive/dvw-parser';
import { describe, expect, it } from 'vitest';
import {
  computeMatchState,
  MATCH_PERIOD,
  periodSummary,
  pointMilestone,
  roleDuels,
  scorers,
  setPeriod,
  setTarget,
  TEAM_DUEL_KEYS,
  teamDuel,
} from './index.js';
import type { MatchState } from './index.js';

const row = (code: string, set = 1, phase = ''): string => `${code};${phase};;;;;;18.00.00;${set};1;1;1;0`;

function build(lines: string[], extraHome: string[] = [], extraAway: string[] = []): MatchState {
  const text = [
    '[3TEAMS]',
    'AAA;Alfa;0;;;',
    'BBB;Beta;0;;;',
    '[3PLAYERS-H]',
    '0;1;1;1;*;*;*;*;1;Opposto;Ada;;;3;;',
    '0;2;2;2;*;*;*;*;2;Banda;Bea;;;2;;',
    '0;3;3;3;*;*;*;*;3;Banda;Cia;;;2;;',
    '0;4;4;4;*;*;*;*;4;Libero;Dea;L;;1;;',
    '0;9;5;5;*;*;*;*;9;Senzaruolo;Eva;;;;;',
    ...extraHome,
    '[3PLAYERS-V]',
    '1;5;1;1;*;*;*;*;11;Opposto;Ugo;;;3;;',
    '1;6;2;2;*;*;*;*;12;Banda;Teo;;;2;;',
    '1;7;3;3;*;*;*;*;13;Libero;Sam;L;;1;;',
    '1;8;4;4;*;*;*;*;14;Senzaruolo;Rik;;;;;',
    ...extraAway,
    '[3SCOUT]',
    ...lines,
  ].join('\r\n');
  return computeMatchState(parseDvw(text));
}

// Set 1 (chiuso): 25-... non serve: basta il parziale delle righe `point`.
const SET1 = [
  row('*01SM#~~~14C', 1, 's'), // ace #1 casa
  row('*p01:00'),
  row('*02AH#V5~41A', 1, 'r'), // attacco #2
  row('*p02:00'),
  row('a05AH#V5~41A', 1, 'r'), // attacco ospite #5
  row('ap02:01'),
  row('*03AH/V5~41A', 1, 'r'), // #3 murato da #5
  row('a05BH#', 1, 'r'),
  row('ap02:02'),
  row('*04RH+~~~14C', 1, 'r'), // ricezione libero casa
  row('a07DH+~~~14C', 1, 'r'),
  row('a06AH#V5~41A', 1, 'r'), // attacco ospite #6
  row('ap02:03'),
  row('a08SM#~~~14C', 1, 's'), // ace ospite #8 (senza ruolo)
  row('ap02:04'),
  row('**1set', 1),
];
const SET2 = [
  row('*02AH#V5~41A', 2, 'r'),
  row('*p01:00', 2),
  row('*03AH#V5~41A', 2, 'r'),
  row('*p02:00', 2),
  row('*03AH#V5~41A', 2, 'r'),
  row('*p03:00', 2),
];

describe('periodSummary', () => {
  const state = build([...SET1, ...SET2]);

  it('set chiuso: parziale, punti, ace e muri con realizzatori', () => {
    const s = periodSummary(state, setPeriod(1));
    expect(s?.score).toEqual({ kind: 'set', home: 2, away: 4, finished: true });
    expect(s?.teams.home).toMatchObject({ points: 2, attackPoints: 1, aces: 1, blockPoints: 0, attackTotal: 2 });
    expect(s?.teams.home.aceScorers.map((x) => [x.number, x.count])).toEqual([[1, 1]]);
    expect(s?.teams.home.attackKillPct).toBe(0.5);
    expect(s?.teams.home.attackEfficiency).toBe(0);
    expect(s?.teams.away).toMatchObject({ points: 4, blockPoints: 1, aces: 1 });
    expect(s?.teams.away.blockScorers.map((x) => [x.number, x.count])).toEqual([[5, 1]]);
    expect(s?.teams.away.aceScorers[0]?.player?.lastName).toBe('Senzaruolo');
    // giocatori ordinati per punti: #5 (attacco + muro) davanti
    expect(s?.teams.away.players.map((p) => [p.number, p.points])).toEqual([
      [5, 2],
      [6, 1],
      [8, 1],
      [7, 0],
    ]);
  });

  it('set in corso: dati fino all ultima azione, parziale non finito', () => {
    const s = periodSummary(state, setPeriod(2));
    expect(s?.score).toEqual({ kind: 'set', home: 3, away: 0, finished: false });
    expect(s?.teams.home.points).toBe(3);
    expect(s?.teams.home.players.map((p) => [p.number, p.points])).toEqual([
      [3, 2],
      [2, 1],
    ]);
  });

  it('partita intera: set vinti e somme dei set; set inesistente = null', () => {
    const m = periodSummary(state, MATCH_PERIOD);
    expect(m?.score).toEqual({ kind: 'match', home: 0, away: 1, finished: false });
    expect(m?.teams.home.points).toBe(5);
    expect(m?.teams.home.players.find((p) => p.number === 3)).toMatchObject({ points: 2, role: 'outside' });
    expect(periodSummary(state, setPeriod(7))).toBeNull();
  });

  it('scorers: solo chi ha punti, limite e ordine stabile (#2 e #3 pari a 2 punti: meno errori prima)', () => {
    expect(scorers(state, MATCH_PERIOD, 'home', 2).map((p) => p.number)).toEqual([2, 3]);
    expect(scorers(state, MATCH_PERIOD, 'home', 10).map((p) => p.number)).toEqual([2, 3, 1]);
    expect(scorers(state, setPeriod(1), 'away', 0)).toEqual([]);
    expect(scorers(state, setPeriod(1), 'away', Number.NaN)).toEqual([]);
    expect(scorers(state, setPeriod(1), 'home', 5).map((p) => p.number)).toEqual([2, 1]);
  });
});

describe('roleDuels', () => {
  const state = build([...SET1, ...SET2]);

  it('opposti e libero abbinati; schiacciatori per graduatoria; senza ruolo e chi non gioca esclusi', () => {
    const duels = roleDuels(state, setPeriod(1));
    expect(duels.map((d) => [d.role, d.rank, d.home.number, d.away.number])).toEqual([
      ['opposite', 1, 1, 5],
      ['outside', 1, 2, 6], // casa: #2 (1 punto) prima di #3 (0); ospite ha un solo schiacciatore
      ['libero', 1, 4, 7],
    ]);
    const opp = duels[0];
    expect(opp?.home).toMatchObject({ points: 1, aces: 1, blocks: 0 });
    expect(opp?.away).toMatchObject({ points: 2, aces: 0, blocks: 1 });
    expect(opp?.away.attack).toMatchObject({ total: 1, kills: 1, killPct: 1 });
    const lib = duels[2];
    expect(lib?.home.reception).toMatchObject({ total: 1, positive: 1, positivePct: 1 });
    expect(lib?.away.digs).toBe(1);
  });

  it('nel set 2 gli ospiti non hanno giocato: nessun duello', () => {
    expect(roleDuels(state, setPeriod(2))).toEqual([]);
  });

  it('ordine stabile con pareggi in graduatoria (stessi punti: maglia più bassa prima)', () => {
    const s = build(
      [
        row('*03AH#V5~41A', 1, 'r'),
        row('*p01:00'),
        row('*02AH#V5~41A', 1, 'r'),
        row('*p02:00'),
        row('a06AH#V5~41A', 1, 'r'),
        row('ap02:01'),
        row('a12AH#V5~41A', 1, 'r'),
        row('ap02:02'),
      ],
      [],
      ['1;12;5;5;*;*;*;*;15;Banda;Leo;;;2;;'],
    );
    const outs = roleDuels(s, MATCH_PERIOD).filter((d) => d.role === 'outside');
    expect(outs.map((d) => [d.rank, d.home.number, d.away.number])).toEqual([
      [1, 2, 6],
      [2, 3, 12],
    ]);
    expect(roleDuels(s, MATCH_PERIOD)).toEqual(roleDuels(s, MATCH_PERIOD));
  });

  it('libero con solo ruolo speciale L e nessun ruolo nel file: duello con il libero avversario', () => {
    const s2 = build(
      [row('*14RH+~~~14C', 1, 'r'), row('a17DH+~~~14C', 1, 'r'), row('*p01:00')],
      ['0;14;9;9;*;*;*;*;19;Libero2;Zed;;L;;;'],
      ['1;17;9;9;*;*;*;*;20;Libero2;Yan;;L;;;'],
    );
    expect(s2.players.home.find((p) => p.number === 14)).toMatchObject({ role: null, specialRole: 'L' });
    const lib = roleDuels(s2, MATCH_PERIOD).filter((d) => d.role === 'libero');
    expect(lib.map((d) => [d.home.number, d.away.number])).toEqual([[14, 17]]);
  });

  it('ruolo assente nel file: nessun duello, nessun errore', () => {
    const s = build([row('*09AH#V5~41A', 1, 'r'), row('*p01:00'), row('a08AH#V5~41A', 1, 'r'), row('ap01:01')]);
    expect(roleDuels(s, MATCH_PERIOD)).toEqual([]);
  });
});

describe('teamDuel', () => {
  const state = build([...SET1, ...SET2]);
  it('righe come il confronto squadre del portale, cambio palla solo per la partita', () => {
    const set1 = teamDuel(state, setPeriod(1));
    expect(set1.map((r) => r.key)).not.toContain('sideOut');
    expect(set1.find((r) => r.key === 'points')).toMatchObject({ home: 2, away: 4 });
    expect(set1.find((r) => r.key === 'blocks')).toMatchObject({ home: 0, away: 1 });
    expect(set1.find((r) => r.key === 'errors')?.better).toBe('low');
    const all = teamDuel(state, MATCH_PERIOD);
    expect(all.at(-1)?.key).toBe('breakPoint');
    expect(all.find((r) => r.key === 'points')).toMatchObject({ home: 5, away: 4 });
    expect(teamDuel(state, setPeriod(9)).find((r) => r.key === 'points')).toMatchObject({ home: null, away: null });
  });
});

describe('pointMilestone', () => {
  const pts = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => row(`*p${String(i + 1).padStart(2, '0')}:00`));

  it('soglie multiple di N sul totale del set in corso', () => {
    expect(pointMilestone(build(pts(3)), 4)).toBeNull();
    expect(pointMilestone(build(pts(4)), 4)).toMatchObject({
      key: 'set-1-4',
      threshold: 4,
      homeScore: 4,
      target: 25,
      toTarget: 21,
    });
    expect(pointMilestone(build(pts(7)), 4)?.key).toBe('set-1-4');
    expect(pointMilestone(build(pts(8)), 4)?.key).toBe('set-1-8');
  });

  it('somma casa + ospite e set successivo', () => {
    const s = build([
      row('*p01:00'),
      row('ap01:01'),
      row('**1set'),
      ...Array.from({ length: 8 }, (_, i) => row(`*p0${i + 1}:00`, 2)),
    ]);
    expect(pointMilestone(s, 8)).toMatchObject({ key: 'set-2-8', set: 2 });
  });

  it('traguardo del set e punti che mancano alla squadra in vantaggio: 25, 15 al tie-break', () => {
    expect(pointMilestone(build(pts(20)), 4)).toMatchObject({ target: 25, toTarget: 5 });
    const base = build(pts(8));
    const tieBreak = {
      status: 'inProgress' as const,
      live: { ...base.live, set: 5 },
      sets: [{ ...base.sets[0], number: 5, homeScore: 5, awayScore: 8, finished: false } as MatchState['sets'][number]],
    };
    expect(pointMilestone(tieBreak, 4)).toMatchObject({ set: 5, threshold: 12, target: 15, toTarget: 7 });
    expect(setTarget(4)).toBe(25);
    expect(setTarget(5)).toBe(15);
  });

  it('chiavi del confronto squadre: TEAM_DUEL_KEYS, nel loro ordine', () => {
    const s = build(pts(8));
    expect(teamDuel(s, MATCH_PERIOD).map((r) => r.key)).toEqual([...TEAM_DUEL_KEYS]);
    expect(teamDuel(s, setPeriod(1)).map((r) => r.key)).toEqual(TEAM_DUEL_KEYS.slice(0, -2));
  });

  it('set chiuso, partita non iniziata o every non valido: null', () => {
    const closed = build([...pts(8), row('**1set')]);
    expect(pointMilestone(closed, 4)).toBeNull();
    expect(pointMilestone(build([]), 4)).toBeNull();
    for (const bad of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pointMilestone(build(pts(8)), bad)).toBeNull();
    }
  });
});

describe('campione samples/partita-sintetica.dvw', () => {
  const file = fileURLToPath(new URL('../../../samples/partita-sintetica.dvw', import.meta.url));
  const state = computeMatchState(parseDvw(readFileSync(file)));

  it('coerente con le statistiche dello stato', () => {
    const m = periodSummary(state, MATCH_PERIOD);
    expect(m?.teams.home.points).toBe(state.stats.home.total.points);
    for (const side of ['home', 'away'] as const) {
      const t = m?.teams[side];
      expect(t?.players.reduce((a, p) => a + p.points, 0)).toBe(t?.points);
      expect(t?.aceScorers.reduce((a, p) => a + p.count, 0)).toBe(t?.aces);
      expect(t?.blockScorers.reduce((a, p) => a + p.count, 0)).toBe(t?.blockPoints);
    }
    const s1 = periodSummary(state, setPeriod(1));
    expect(s1?.score).toMatchObject({ home: state.sets[0]?.homeScore, away: state.sets[0]?.awayScore });
    expect(pointMilestone(state, 8)).toBeNull(); // partita finita
    for (const d of roleDuels(state, MATCH_PERIOD)) expect(d.home.role).toBe(d.away.role);
  });
});
