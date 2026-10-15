import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDvw } from '@sir/dvw-parser';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { describe, expect, it } from 'vitest';
import { computeMatchState } from './index.js';
import type { MatchState, Side } from './index.js';

/** Riga scout minima: codice;fase;;;;;;ora;set;posizione palleggiatore casa;ospite. */
function row(
  code: string,
  opts: { set?: number; time?: string; phase?: string; hs?: number; as?: number } = {},
): string {
  const { set = 1, time = '18.00.00', phase = '', hs = 1, as = 1 } = opts;
  return `${code};${phase};;;;;;${time};${set};${hs};${as};1;0`;
}

function build(lines: string[]): MatchState {
  const text = [
    '[3MATCH]',
    '2025-01-18;18.00.00;2024/25;Test;;;;;',
    '[3TEAMS]',
    'AAA;Alfa;0;;;',
    'BBB;Beta;0;;;',
    '[3PLAYERS-H]',
    '0;8;1;1;*;*;*;*;1001;Rossi;Mario;;;2;;',
    '[3SCOUT]',
    ...lines,
  ].join('\r\n');
  return computeMatchState(parseDvw(text));
}

const pointsOf = (s: MatchState, side: Side): number =>
  Object.values(s.stats[side].players).reduce((acc, p) => acc + p.total.points, 0);

describe('partite del simulatore', () => {
  for (const sets of [3, 4, 5] as const) {
    for (const seed of [1, 2, 3, 4, 5]) {
      it(`seed ${seed}, ${sets} set`, () => {
        const match = generateMatch({ seed, sets });
        const state = computeMatchState(parseDvw(renderDvw(match, match.lines.length)));
        expect(state.sets.map((s) => [s.number, s.homeScore, s.awayScore])).toEqual(
          match.sets.map((s) => [s.number, s.home, s.away]),
        );
        const won = { home: 0, away: 0 };
        for (const s of match.sets) won[s.home > s.away ? 'home' : 'away']++;
        expect(state.setsWon).toEqual(won);
        expect(state.status).toBe('finished');
        for (const set of state.momentum.sets) {
          const total = match.sets[set.set - 1];
          expect(set.points.length).toBe((total?.home ?? -1) + (total?.away ?? -1));
          expect(
            set.points.filter((p) => p.type === 'breakPoint').length +
              set.points.filter((p) => p.type === 'sideOut').length,
          ).toBe(set.points.length);
        }
        for (const side of ['home', 'away'] as const) {
          const teamPoints = match.sets.reduce((a, s) => a + s[side], 0);
          expect(pointsOf(state, side)).toBeLessThanOrEqual(teamPoints);
          const m = state.momentum[side];
          expect(m.breakPoints + m.sideOuts).toBe(teamPoints);
          const rot = state.rotations[side];
          expect(rot.reduce((a, r) => a + r.pointsWon, 0)).toBe(teamPoints);
        }
      });
    }
  }

  it("stati parziali coerenti con l'ultima riga point visibile", () => {
    const match = generateMatch({ seed: 2, sets: 4 });
    const n = match.lines.length;
    for (const k of [0, 1, 5, 40, 123, Math.floor(n / 3), Math.floor(n / 2) + 1, n - 7, n - 1, n]) {
      const parsed = parseDvw(renderDvw(match, k));
      const state = computeMatchState(parsed);
      const lastPoint = [...parsed.scout].reverse().find((e) => e.kind === 'point');
      if (!lastPoint || lastPoint.kind !== 'point') {
        expect(state.live.homeScore).toBe(0);
        expect(state.live.awayScore).toBe(0);
        expect(state.live.lastPoint).toBeNull();
        continue;
      }
      expect(state.live.homeScore).toBe(lastPoint.homeScore);
      expect(state.live.awayScore).toBe(lastPoint.awayScore);
      expect(state.live.set).toBeGreaterThanOrEqual(lastPoint.set ?? 1);
      expect(state.live.lastPoint?.team).toBe(lastPoint.team);
      expect(state.live.run?.team).toBe(lastPoint.team);
      expect(state.live.lastPoint?.homeScore).toBe(lastPoint.homeScore);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  it('è JSON-serializzabile', () => {
    const match = generateMatch({ seed: 3, sets: 5 });
    for (const k of [10, 300, match.lines.length]) {
      const state = computeMatchState(parseDvw(renderDvw(match, k)));
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  it('campione samples/partita-sintetica.dvw: 0-3', () => {
    const file = fileURLToPath(new URL('../../../samples/partita-sintetica.dvw', import.meta.url));
    const state = computeMatchState(parseDvw(readFileSync(file)));
    expect(state.setsWon).toEqual({ home: 0, away: 3 });
    expect(state.status).toBe('finished');
    expect(state.sets).toHaveLength(3);
    expect(state.teams.home.code).toBe('PAL');
  });
});

describe('input vuoto o rovinato', () => {
  it('file vuoto → notStarted', () => {
    const state = computeMatchState(parseDvw(''));
    expect(state.status).toBe('notStarted');
    expect(state.sets).toEqual([]);
    expect(state.live.lastPoint).toBeNull();
    expect(state.live.servingTeam).toBeNull();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('righe unknown e campi mancanti non lanciano', () => {
    const state = build(['garbage', '*zz', 'aXXSH#', row('*08SM#~~~14C'), '*p', row('*p01:00')]);
    expect(state.live.homeScore).toBe(1);
    expect(state.stats.home.total.serve.aces).toBe(1);
  });
});

describe('casi costruiti a mano', () => {
  it('ace, errore in battuta, efficienza', () => {
    const state = build([
      row('*08SM#~~~14C', { phase: 's' }),
      row('a05RH=', { phase: 'r' }),
      row('*p01:00'),
      row('*08SM=~~~14C', { phase: 's' }),
      row('ap01:01'),
      row('a05SM-~~~41C', { phase: 's' }),
      row('*03RH+', { phase: 'r' }),
    ]);
    const serve = state.stats.home.players['8']?.total.serve;
    expect(serve).toEqual({ total: 2, aces: 1, errors: 1, efficiency: 0 });
    expect(state.stats.home.total.errors).toBe(1);
    expect(state.stats.away.total.reception.errors).toBe(1);
    expect(state.stats.away.total.reception.total).toBe(1);
    expect(state.stats.home.total.reception.positivePct).toBe(1);
    expect(state.live.lastPoint).toMatchObject({ team: 'away', kind: 'opponentError', label: 'errore battuta #8' });
    expect(state.live.servingTeam).toBe('away');
    expect(state.zones.home.serve).toEqual([{ from: '1', to: '4', total: 2, byEvaluation: { '#': 1, '=': 1 } }]);
  });

  it('ace come ultimo punto: etichetta "battuta #8"', () => {
    const state = build([row('*08SM#~~~14C', { phase: 's' }), row('a05RH=', { phase: 'r' }), row('*p01:00')]);
    expect(state.live.lastPoint).toMatchObject({ kind: 'serve', player: 8, label: 'battuta #8', playerTeam: 'home' });
  });

  it('attacco murato, efficienza e % punti', () => {
    const state = build([
      row('*08SM-~~~14C', { phase: 's' }),
      row('a05RH+', { phase: 'r' }),
      row('a07AH#V5~41A', { phase: 'r' }),
      row('ap00:01'),
      row('a05SM-~~~41C', { phase: 's' }),
      row('*03RH+', { phase: 'r' }),
      row('*09AH/V5~41A', { phase: 'r' }),
      row('a04BH#', { phase: 'r' }),
      row('ap00:02'),
      row('a05SM-~~~41C', { phase: 's' }),
      row('*03RH+', { phase: 'r' }),
      row('*09AH=V5~41A', { phase: 'r' }),
      row('ap00:03'),
    ]);
    const att = state.stats.home.players['9']?.total.attack;
    expect(att).toEqual({ total: 2, kills: 0, errors: 1, blocked: 1, killPct: 0, efficiency: -1 });
    expect(state.stats.away.players['4']?.total.block).toEqual({ kills: 1, touches: 1 });
    expect(state.stats.away.players['7']?.total.attack.efficiency).toBe(1);
    expect(state.stats.away.players['5']?.total.attack.efficiency).toBeNull();
    expect(state.stats.home.total.attack.total).toBe(2);
    expect(state.zones.home.attack).toHaveLength(1);
    expect(state.zones.home.players['9']?.attack[0]).toMatchObject({ total: 2, byEvaluation: { '/': 1, '=': 1 } });
    expect(state.live.homeScore).toBe(0);
    expect(state.live.awayScore).toBe(3);
  });

  it('azioni senza zona: fuori dalla mappa ma nelle statistiche', () => {
    const state = build([row('*08AH#', { phase: 's' }), row('*p01:00')]);
    expect(state.stats.home.total.attack.kills).toBe(1);
    expect(state.zones.home.attack).toEqual([]);
  });

  it('break point, side-out, % side-out e serie', () => {
    // casa batte: punto casa (BP), punto casa (BP), punto ospite (SO ospite), ospite batte: punto ospite (BP), punto casa (SO)
    const state = build([
      row('*08SM-~~~14C', { phase: 's' }),
      row('*p01:00'),
      row('*08SM-~~~14C', { phase: 's' }),
      row('*p02:00'),
      row('*08SM-~~~14C', { phase: 's' }),
      row('ap02:01'),
      row('a05SM-~~~41C', { phase: 's' }),
      row('ap02:02'),
      row('a05SM-~~~41C', { phase: 's' }),
      row('*p03:02'),
    ]);
    expect(state.momentum.sets[0]?.points.map((p) => p.type)).toEqual([
      'breakPoint',
      'breakPoint',
      'sideOut',
      'breakPoint',
      'sideOut',
    ]);
    expect(state.momentum.home).toMatchObject({
      breakPoints: 2,
      sideOuts: 1,
      servedRallies: 3,
      receivedRallies: 2,
      sideOutPct: 0.5,
      longestRun: 2,
    });
    expect(state.momentum.away).toMatchObject({
      breakPoints: 1,
      sideOuts: 1,
      servedRallies: 2,
      receivedRallies: 3,
      sideOutPct: 0.333,
    });
    expect(state.momentum.away.longestRunBySet).toEqual({ '1': 2 });
    expect(state.live.run).toEqual({ team: 'home', length: 1 });
    expect(state.rotations.home[0]).toMatchObject({
      position: 1,
      pointsWon: 3,
      pointsLost: 2,
      sideOuts: 1,
      breakPoints: 2,
    });
    expect(state.rotations.home[0]?.sideOutPct).toBe(0.5);
    expect(state.rotations.home[0]?.breakPointPct).toBe(0.667);
    expect(state.rotations.home[1]?.sideOutPct).toBeNull();
  });

  it('serie in corso, servizio a inizio set, timeout e cambi del set corrente', () => {
    const state = build([
      row('*08SM-~~~14C', { set: 1, phase: 's' }),
      row('*p01:00', { set: 1 }),
      row('**1set', { set: 1 }),
      row('aT', { set: 2 }),
      row('ac03:09', { set: 2 }),
      row('a05SM-~~~41C', { set: 2, phase: 's' }),
    ]);
    expect(state.sets).toHaveLength(2);
    expect(state.sets[0]).toMatchObject({ number: 1, finished: true, winner: 'home' });
    expect(state.sets[1]).toMatchObject({ number: 2, finished: false, winner: null });
    expect(state.setsWon).toEqual({ home: 1, away: 0 });
    expect(state.status).toBe('inProgress');
    expect(state.live).toMatchObject({ set: 2, homeScore: 0, awayScore: 0, servingTeam: 'away', run: null });
    expect(state.live.timeouts).toEqual({ home: 0, away: 1 });
    expect(state.live.substitutions).toEqual({ home: 0, away: 1 });
  });

  it('durata del set dalle ore', () => {
    const state = build([row('*08SM-~~~14C', { time: '18.00.00', phase: 's' }), row('*p01:00', { time: '18.30.00' })]);
    expect(state.sets[0]?.durationMinutes).toBe(30);
  });

  it("durata: piccoli passi indietro dell'ora non sono la mezzanotte, quelli lunghi sì", () => {
    const back = build([
      row('*08SM-~~~14C', { time: '19.55.48', phase: 's' }),
      row('*p01:00', { time: '19.57.28' }),
      row('*z6', { time: '19.57.26' }),
      row('*p02:00', { time: '20.20.48' }),
    ]);
    expect(back.sets[0]?.durationMinutes).toBe(25);
    const night = build([row('*08SM-~~~14C', { time: '23.50.00', phase: 's' }), row('*p01:00', { time: '00.10.00' })]);
    expect(night.sets[0]?.durationMinutes).toBe(20);
  });

  it('file reale: **Nset ha nel campo set il set successivo, ma chiude il set N', () => {
    const lines: string[] = [];
    for (let s = 1; s <= 3; s++) {
      lines.push(
        row('*08SM-~~~14C', { set: s, phase: 's' }),
        row('*p25:20', { set: s }),
        row(`**${s}set`, { set: s + 1 }),
      );
    }
    const state = build(lines);
    expect(state.sets.map((x) => `${x.number} ${x.homeScore}-${x.awayScore}`)).toEqual([
      '1 25-20',
      '2 25-20',
      '3 25-20',
    ]);
    expect(state.status).toBe('finished');
    expect(state.live).toMatchObject({ set: 3, homeScore: 25, awayScore: 20, servingTeam: null });
    // a set 1 chiuso, il set 2 inizia con la prima riga che ha set 2
    const between = build([row('*08SM-~~~14C', { phase: 's' }), row('*p25:20'), row('**1set', { set: 2 })]);
    expect(between.sets).toHaveLength(1);
    expect(between.status).toBe('inProgress');
    const next = build([
      row('*08SM-~~~14C', { phase: 's' }),
      row('*p25:20'),
      row('**1set', { set: 2 }),
      row('*z1', { set: 2 }),
      row('a05SM-~~~41C', { set: 2, phase: 's' }),
    ]);
    expect(next.sets.map((x) => x.number)).toEqual([1, 2]);
    expect(next.live).toMatchObject({ set: 2, homeScore: 0, awayScore: 0, servingTeam: 'away' });
  });

  it('durata di un set chiuso: vale quella di [3SET]', () => {
    const text = [
      '[3SET]',
      'True;8 -3;16-10;21-14;25-21;29;',
      '[3SCOUT]',
      row('*08SM-~~~14C', { time: '12.00.00', phase: 's' }),
      row('*p25:21', { time: '14.00.00' }),
      row('**1set', { time: '14.00.00', set: 2 }),
    ].join('\r\n');
    expect(computeMatchState(parseDvw(text)).sets[0]?.durationMinutes).toBe(29);
  });

  it('partita finita a 3 set', () => {
    const lines: string[] = [];
    for (let s = 1; s <= 3; s++) {
      lines.push(row('*08SM-~~~14C', { set: s, phase: 's' }), row('*p01:00', { set: s }), row(`**${s}set`, { set: s }));
    }
    const state = build(lines);
    expect(state.status).toBe('finished');
    expect(state.setsWon.home).toBe(3);
  });

  it('ritocchi: posizione fuori 1..6, set assurdi, servizio dopo setEnd, muro /', () => {
    // posizione palleggiatore 9 → null
    const a = build([row('*08SM-~~~14C', { hs: 9, as: 3, phase: 's' }), row('*p01:00', { hs: 9, as: 3 })]);
    expect(a.live.setterPosition).toEqual({ home: null, away: 3 });
    // set 0 e 9 ignorati; **0set non crea il set 0
    const b = build([
      row('*08SM-~~~14C', { phase: 's' }),
      row('*p01:00'),
      row('*p02:00', { set: 9 }),
      row('**0set', { set: 0 }),
    ]);
    expect(b.sets.map((s) => s.number)).toEqual([1]);
    expect(b.sets[0]?.homeScore).toBe(2);
    // dopo **1set nessuno serve finché non arriva la prima battuta
    const c = build([row('*08SM-~~~14C', { phase: 's' }), row('*p01:00'), row('**1set')]);
    expect(c.live.servingTeam).toBeNull();
    // muro / = errore (stats e ultimo punto); ricezione / no
    const d = build([
      row('a05SM-~~~41C', { phase: 's' }),
      row('*03RH/', { phase: 'r' }),
      row('*09AH+V5~41A', { phase: 'r' }),
      row('a04BH/', { phase: 'r' }),
      row('*p01:00'),
    ]);
    expect(d.stats.away.total.errors).toBe(1);
    expect(d.stats.home.total.errors).toBe(0);
    expect(d.live.lastPoint).toMatchObject({ kind: 'opponentError', label: 'errore muro #4' });
  });
});
