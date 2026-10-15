import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDvw } from '@sir/dvw-parser';
import { describe, expect, it } from 'vitest';
import { computeMatchState, matchMvp, setRecap } from './index.js';
import type { MatchState } from './index.js';

const row = (code: string, set = 1, phase = ''): string => `${code};${phase};;;;;;18.00.00;${set};1;1;1;0`;

function build(lines: string[]): MatchState {
  const text = [
    '[3TEAMS]',
    'AAA;Alfa;0;;;',
    'BBB;Beta;0;;;',
    '[3PLAYERS-H]',
    '0;8;1;1;*;*;*;*;1001;Rossi;Mario;;;2;;',
    '0;9;2;2;*;*;*;*;1002;Verdi;Luca;;;4;;',
    '[3PLAYERS-V]',
    '1;5;1;1;*;*;*;*;2001;Bianchi;Paolo;;;2;;',
    '[3SCOUT]',
    ...lines,
  ].join('\r\n');
  return computeMatchState(parseDvw(text));
}

describe('riepilogo del set', () => {
  // set 1: #8 casa 2 ace, #9 casa 1 attacco murato; set 2: #9 casa 2 attacchi, #5 ospite 1 muro
  const state = build([
    row('*08SM#~~~14C', 1, 's'),
    row('*p01:00'),
    row('*08SM#~~~14C', 1, 's'),
    row('*p02:00'),
    row('a05SM-~~~41C', 1, 's'),
    row('*09AH/V5~41A', 1, 'r'),
    row('a05BH#', 1, 'r'),
    row('ap02:01'),
    row('**1set', 2),
    row('*09AH#V5~41A', 2, 'r'),
    row('*p01:00', 2),
    row('*09AH#V5~41A', 2, 'r'),
    row('*p02:00', 2),
    row('a05BH#', 2, 'r'),
    row('ap02:01', 2),
  ]);

  it('solo le azioni del set: punti, attacco, battuta, muri, errori e migliore giocatore', () => {
    const one = setRecap(state, 1);
    expect(one).toMatchObject({ set: 1, homeScore: 2, awayScore: 1, winner: 'home', finished: true });
    expect(one?.teams.home.serve).toMatchObject({ total: 2, aces: 2 });
    expect(one?.teams.home.attack).toMatchObject({ total: 1, kills: 0, blocked: 1 });
    expect(one?.teams.home.errors).toBe(1);
    expect(one?.teams.away.block.kills).toBe(1);
    expect(one?.best).toMatchObject({ team: 'home', number: 8, points: 2, aces: 2 });
    expect(one?.best?.player?.lastName).toBe('Rossi');

    const two = setRecap(state, 2);
    expect(two).toMatchObject({ set: 2, homeScore: 2, awayScore: 1, winner: null, finished: false });
    expect(two?.teams.home.serve.total).toBe(0);
    expect(two?.teams.home.attack).toMatchObject({ total: 2, kills: 2, efficiency: 1 });
    expect(two?.best).toMatchObject({ team: 'home', number: 9, points: 2, attackKills: 2 });
  });

  it('set che non esiste: null; set senza azioni: righe vuote e nessun migliore', () => {
    expect(setRecap(state, 4)).toBeNull();
    const onlyPoints = build([row('*p01:00')]);
    const recap = setRecap(onlyPoints, 1);
    expect(recap?.teams.home).toMatchObject({ points: 0, errors: 0, attack: { total: 0, efficiency: null } });
    expect(recap?.best).toBeNull();
  });

  it('campione samples/partita-sintetica.dvw: i set sommati danno la partita', () => {
    const file = fileURLToPath(new URL('../../../samples/partita-sintetica.dvw', import.meta.url));
    const real = computeMatchState(parseDvw(readFileSync(file)));
    const recaps = real.sets.map((s) => setRecap(real, s.number));
    expect(recaps.map((r) => `${r?.homeScore}-${r?.awayScore}`)).toEqual(['23-25', '18-25', '25-27']);
    for (const side of ['home', 'away'] as const) {
      const sum = recaps.reduce((a, r) => a + (r?.teams[side].points ?? 0), 0);
      expect(sum).toBe(real.stats[side].total.points);
      for (const r of recaps) expect(r?.teams[side].points ?? 0).toBeLessThanOrEqual(r?.[`${side}Score`] ?? 0);
    }
    expect(recaps.every((r) => r?.best !== null)).toBe(true);
  });
});

describe('MVP della partita', () => {
  /** Tre set vinti dalla casa con le azioni date nel primo. */
  const won = (first: string[]): MatchState =>
    build([
      ...first,
      row('*p25:20'),
      row('**1set', 2),
      row('*p25:20', 2),
      row('**2set', 3),
      row('*p25:20', 3),
      row('**3set', 4),
    ]);

  it('a parità di punti vince la migliore efficienza d’attacco', () => {
    // #8: 2 attacchi vincenti su 2 (efficienza 1); #9: 2 vincenti su 3 con un errore (0,333)
    const state = won([
      row('*08AH#', 1, 'r'),
      row('*08AH#', 1, 'r'),
      row('*09AH#', 1, 'r'),
      row('*09AH#', 1, 'r'),
      row('*09AH=', 1, 'r'),
    ]);
    expect(state.status).toBe('finished');
    expect(matchMvp(state)).toMatchObject({ team: 'home', number: 8, points: 2, attackEfficiency: 1, attackTotal: 2 });
  });

  it('chi ha più punti vince comunque; senza attacchi conta meno di chi ha attaccato', () => {
    const more = won([row('*08AH#', 1, 'r'), row('*09SM#', 1, 's'), row('*09SM#', 1, 's'), row('*09SM#', 1, 's')]);
    expect(matchMvp(more)).toMatchObject({ number: 9, points: 3, attackEfficiency: null });
    const tie = won([row('*08AH=', 1, 'r'), row('*08BH#', 1, 'r'), row('*09SM#', 1, 's')]);
    // #8: 1 punto, efficienza −1; #9: 1 punto senza attacchi → vince #8
    expect(matchMvp(tie)).toMatchObject({ number: 8, attackEfficiency: -1 });
  });

  it('a partita finita solo la squadra vincitrice; in corso tutte e due', () => {
    const lines = [row('a05AH#', 1, 'r'), row('a05AH#', 1, 'r'), row('*08AH#', 1, 'r')];
    expect(matchMvp(won(lines))).toMatchObject({ team: 'home', number: 8 });
    expect(matchMvp(build(lines))).toMatchObject({ team: 'away', number: 5 });
    // vincitori senza punti: si guarda a tutti
    expect(matchMvp(won([row('a05AH#', 1, 'r')]))).toMatchObject({ team: 'away', number: 5 });
  });

  it('nessun punto: null; ordine stabile a parità di tutto (casa, poi maglia più bassa)', () => {
    expect(matchMvp(build([row('*p01:00')]))).toBeNull();
    const same = build([row('*09AH#', 1, 'r'), row('*08AH#', 1, 'r'), row('a05AH#', 1, 'r')]);
    expect(matchMvp(same)).toMatchObject({ team: 'home', number: 8 });
    expect(matchMvp(same)).toEqual(matchMvp(same));
  });
});
