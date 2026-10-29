import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParsedMatch } from '@arenalive/dvw-parser';
import { parseDvw } from '@arenalive/dvw-parser';
import { generateMatch, renderDvw } from '@arenalive/dvw-simulator';
import { describe, expect, it } from 'vitest';
import {
  computeMatchState,
  MATCH_EVENT_KINDS,
  MATCH_EVENT_PRIORITY,
  matchEvents,
  RECENT_EVENTS_LIMIT,
  recentEvents,
  setPointTeam,
} from './index.js';
import type { MatchEvent } from './index.js';

/** Riga scout minima: codice;fase;;;;;;ora;set;posizione palleggiatore casa;ospite. */
const row = (code: string, set = 1, phase = ''): string => `${code};${phase};;;;;;18.00.00;${set};1;1;1;0`;

function parsedOf(lines: string[]): ParsedMatch {
  return parseDvw(
    [
      '[3MATCH]',
      '2025-01-18;18.00.00;2024/25;Test;;;;;',
      '[3TEAMS]',
      'AAA;Alfa;0;;;',
      'BBB;Beta;0;;;',
      '[3PLAYERS-H]',
      '0;8;1;1;*;*;*;*;1001;Rossi;Mario;;;2;;',
      '0;12;2;2;*;*;*;*;1002;Bianchi;Luca;;;4;;',
      '[3PLAYERS-V]',
      '1;5;1;1;*;*;*;*;2001;Verdi;Paolo;;;3;;',
      '[3SCOUT]',
      ...lines,
    ].join('\r\n'),
  );
}
const eventsOf = (lines: string[]): MatchEvent[] => matchEvents(parsedOf(lines));
const kinds = (lines: string[]): string[] => eventsOf(lines).map((e) => e.id);
const pad = (n: number): string => String(n).padStart(2, '0');
const point = (hs: number, as: number, set = 1, team: '*' | 'a' = '*'): string =>
  row(`${team}p${pad(hs)}:${pad(as)}`, set);

/** Rally semplice: battuta (non ace) della squadra che segna e punto. */
const rally = (hs: number, as: number, set = 1, team: '*' | 'a' = '*'): string[] => [
  row(`${team}08SM-~~~14C`, set, 's'),
  point(hs, as, set, team),
];

/** Punti di fila dal punteggio `from` a `to` (una squadra alla volta, nell'ordine dato). */
function score(sequence: ('h' | 'a')[], set = 1, start: [number, number] = [0, 0]): string[] {
  let [h, a] = start;
  const out: string[] = [];
  for (const s of sequence) {
    if (s === 'h') h++;
    else a++;
    out.push(...rally(h, a, set, s === 'h' ? '*' : 'a'));
  }
  return out;
}
const times = (s: 'h' | 'a', n: number): ('h' | 'a')[] => Array.from({ length: n }, () => s);
/** Punti alternati casa-ospite: `n` pareggi senza svantaggi. */
const alternate = (n: number): ('h' | 'a')[] => Array.from({ length: n }, () => ['h', 'a'] as const).flat();
/** Set vinto 25-20 dalla squadra data e chiuso da `**Nset`. */
const wonSet = (set: number, team: '*' | 'a' = '*'): string[] => [
  ...(team === '*' ? rally(25, 20, set) : rally(20, 25, set, 'a')),
  row(`**${set}set`, set + 1),
];

describe('eventi: punti diretti', () => {
  it('ace: battuta # con il giocatore (numero e nome)', () => {
    const [ace] = eventsOf([row('*08SM#~~~14C', 1, 's'), point(1, 0)]);
    expect(ace).toEqual({
      id: 'ace-1-1-0',
      kind: 'ace',
      index: 1,
      set: 1,
      team: 'home',
      player: { number: 8, firstName: 'Mario', lastName: 'Rossi' },
      playerOut: null,
      homeScore: 1,
      awayScore: 0,
      count: null,
      priority: MATCH_EVENT_PRIORITY.ace,
    });
  });

  it('muro punto, anche di un giocatore fuori elenco (solo numero)', () => {
    const lines = [row('a05SM+~~~14C', 1, 'r'), row('*12RM-'), row('*08AH-'), row('a07BH#'), point(0, 1, 1, 'a')];
    const [block] = eventsOf(lines);
    expect(block).toMatchObject({ kind: 'block', team: 'away', player: { number: 7, lastName: null } });
    expect(eventsOf([row('a05SM+~~~14C', 1, 'r'), row('*12RM-'), row('a07BH-'), point(1, 0)])).toEqual([]);
  });

  it('punto in attacco: attacco # col giocatore che attacca, priorità sotto sorpasso e pareggio', () => {
    const lines = [row('a05SM+~~~14C', 1, 'r'), row('*12RM-'), row('*08AH#'), point(1, 0)];
    expect(eventsOf(lines)).toEqual([
      {
        id: 'attack-1-1-0',
        kind: 'attack',
        index: 3,
        set: 1,
        team: 'home',
        player: { number: 8, firstName: 'Mario', lastName: 'Rossi' },
        playerOut: null,
        homeScore: 1,
        awayScore: 0,
        count: null,
        priority: MATCH_EVENT_PRIORITY.attack,
      },
    ]);
    expect(MATCH_EVENT_PRIORITY.attack).toBeLessThan(MATCH_EVENT_PRIORITY.tie);
    expect(MATCH_EVENT_PRIORITY.attack).toBeLessThan(MATCH_EVENT_PRIORITY.lead);
    expect(MATCH_EVENT_PRIORITY.attack).toBeLessThan(MATCH_EVENT_PRIORITY.run);
  });

  it('un attacco murato non è un punto in attacco (è il muro avversario)', () => {
    const lines = [row('*08SM+~~~14C', 1, 's'), row('a05AH/'), row('*12BH#'), point(1, 0)];
    expect(eventsOf(lines).map((e) => e.kind)).toEqual(['block']);
  });

  it('un errore avversario non è un ace né un muro', () => {
    expect(eventsOf([row('*08SM=~~~14C', 1, 's'), point(0, 1, 1, 'a')])).toEqual([]);
  });
});

describe('eventi: serie e scambio lungo', () => {
  it('serie dal terzo punto di fila, a ogni punto in più; si interrompe col punto avversario', () => {
    const runs = eventsOf(score(['h', 'h', 'h', 'h', 'a', 'h'])).filter((e) => e.kind === 'run');
    expect(runs.map((e) => [e.id, e.count])).toEqual([
      ['run-1-3-0', 3],
      ['run-1-4-0', 4],
    ]);
    expect(runs[0]).toMatchObject({ team: 'home', homeScore: 3, awayScore: 0 });
  });

  it('la serie riparte a ogni set', () => {
    const lines = [...score(['h', 'h']), row('**1set', 2), ...score(['h'], 2)];
    expect(eventsOf(lines).filter((e) => e.kind === 'run')).toEqual([]);
  });

  it('scambio lungo da 4 attacchi (delle due squadre)', () => {
    const rallyOf = (attacks: number): string[] => [
      row('*08SM+~~~14C', 1, 's'),
      ...Array.from({ length: attacks }, (_, i) => row(i % 2 ? '*08AH-' : 'a05AH-')),
      point(1, 0),
    ];
    expect(eventsOf(rallyOf(3))).toEqual([]);
    expect(eventsOf(rallyOf(4))).toEqual([expect.objectContaining({ id: 'longRally-1-1-0', count: 4, team: 'home' })]);
  });
});

describe('eventi: set point e match point', () => {
  it('setPointTeam: a 25, ai vantaggi e al tie-break a 15', () => {
    expect(setPointTeam(1, 24, 20)).toBe('home');
    expect(setPointTeam(1, 23, 20)).toBeNull();
    expect(setPointTeam(1, 24, 24)).toBeNull();
    expect(setPointTeam(1, 25, 24)).toBe('home');
    expect(setPointTeam(1, 27, 28)).toBe('away');
    expect(setPointTeam(1, 25, 23)).toBeNull();
    expect(setPointTeam(5, 14, 12)).toBe('home');
    expect(setPointTeam(5, 13, 14)).toBe('away');
    expect(setPointTeam(5, 15, 13)).toBeNull();
    expect(setPointTeam(5, 15, 14)).toBe('home');
  });

  it('solo quando nasce: 24-20 sì, 24-21 no, 25-24 dopo il pareggio sì, poi all’avversario', () => {
    const lines = score([...times('h', 24), ...times('a', 4), 'a', ...times('a', 19), 'h', 'a', 'a'], 1);
    // 24-0 … 24-24, 25-24, 25-25, 25-26
    const sp = eventsOf(lines).filter((e) => e.kind === 'setPoint');
    expect(sp.map((e) => `${e.team} ${e.homeScore}-${e.awayScore}`)).toEqual(['home 24-0', 'home 25-24', 'away 25-26']);
  });

  it('match point a chi ha già 2 set; set point all’altra squadra', () => {
    const base = [...wonSet(1), ...wonSet(2)];
    const lines = [...base, ...score([...times('a', 24), ...times('h', 24), 'h'], 3)];
    const marks = eventsOf(lines).filter((e) => e.kind === 'setPoint' || e.kind === 'matchPoint');
    expect(marks.map((e) => `${e.kind} ${e.team} ${e.homeScore}-${e.awayScore}`)).toEqual([
      'setPoint away 0-24',
      'matchPoint home 25-24',
    ]);
  });

  it('tie-break: match point a 14 per chi ha 2 set, a tutte e due le squadre', () => {
    const base = [...wonSet(1), ...wonSet(2, 'a'), ...wonSet(3), ...wonSet(4, 'a')];
    const lines = [...base, ...score([...times('h', 14), ...times('a', 14), 'a'], 5)];
    const marks = eventsOf(lines).filter((e) => e.kind === 'setPoint' || e.kind === 'matchPoint');
    expect(marks.map((e) => `${e.kind} ${e.team} ${e.homeScore}-${e.awayScore}`)).toEqual([
      'matchPoint home 14-0',
      'matchPoint away 14-15',
    ]);
  });
});

describe('eventi: pareggio e sorpasso', () => {
  it('niente all’inizio del set; pareggio dopo 3 punti di svantaggio e poi sorpasso', () => {
    const ids = kinds(score(['a', 'h', 'h', 'a', 'a', 'a', 'h', 'h', 'h', 'h']));
    // 0-1, 1-1, 2-1 (sorpasso a inizio set: niente), 2-2, 2-3, 2-4 (svantaggio 2: niente), poi 3-4, 4-4 no
    expect(ids.filter((id) => id.startsWith('tie') || id.startsWith('lead'))).toEqual([]);
    const comeback = kinds(score(['a', 'a', 'a', 'h', 'h', 'h', 'h']));
    expect(comeback.filter((id) => id.startsWith('tie') || id.startsWith('lead'))).toEqual(['tie-1-3-3', 'lead-1-4-3']);
  });

  it('dal 15-15 sempre; sorpasso solo di chi era dietro prima del pareggio', () => {
    const late = score([...alternate(14), 'a', 'h', 'h', 'h', 'a', 'h'], 1);
    // 14-14 senza svantaggi: niente; 14-15 niente; 15-15 pareggio; 16-15 sorpasso; 17-15, 17-16, 18-16 niente
    const ids = kinds(late).filter((id) => id.startsWith('tie') || id.startsWith('lead'));
    expect(ids).toEqual(['tie-1-15-15', 'lead-1-16-15']);
    const back = score([...times('h', 15), ...times('a', 15), 'h'], 1);
    // 15-15 pareggio dell'ospite; 16-15 della casa che era già avanti: non è un sorpasso
    expect(kinds(back).filter((id) => id.startsWith('tie') || id.startsWith('lead'))).toEqual(['tie-1-15-15']);
  });

  it('tie-break: dal 9-9', () => {
    const base = [...wonSet(1), ...wonSet(2, 'a'), ...wonSet(3), ...wonSet(4, 'a')];
    const ids = kinds([...base, ...score([...alternate(8), 'a', 'h', 'h'], 5)]);
    expect(ids.filter((id) => id.startsWith('tie') || id.startsWith('lead'))).toEqual(['tie-5-9-9', 'lead-5-10-9']);
  });
});

describe('eventi: time-out, cambi, fine set, fine partita', () => {
  it('time-out numerati per squadra e per set; cambio con chi entra e chi esce', () => {
    const lines = [...rally(1, 0), row('aT'), row('*c08:12'), row('aT'), row('**1set', 2), row('aT', 2)];
    const events = eventsOf(lines);
    expect(events.map((e) => e.id)).toEqual([
      'timeout-1-away-1',
      'substitution-1-1-0-home-8-12',
      'timeout-1-away-2',
      'setEnd-1',
      'timeout-2-away-1',
    ]);
    expect(events[1]).toMatchObject({
      team: 'home',
      player: { number: 12, lastName: 'Bianchi' },
      playerOut: { number: 8, lastName: 'Rossi' },
      homeScore: 1,
    });
    expect(events[3]).toMatchObject({ kind: 'setEnd', team: 'home', homeScore: 1, awayScore: 0, set: 1 });
  });

  it('il set che dà il terzo set vinto è la fine della partita, non un fine set', () => {
    const events = eventsOf([...wonSet(1), ...wonSet(2, 'a'), ...wonSet(3), ...wonSet(4)]);
    const ends = events.filter((e) => e.kind === 'setEnd' || e.kind === 'matchEnd');
    expect(ends.map((e) => `${e.id} ${e.team}`)).toEqual([
      'setEnd-1 home',
      'setEnd-2 away',
      'setEnd-3 home',
      'matchEnd home',
    ]);
    expect(ends[3]).toMatchObject({ set: 4, homeScore: 25, awayScore: 20, priority: MATCH_EVENT_PRIORITY.matchEnd });
  });

  it('righe malformate o sconosciute non danno eventi né eccezioni', () => {
    expect(eventsOf(['@@@', row('*p'), row('**9set'), row('*$$&H#')])).toEqual([]);
    expect(matchEvents(parseDvw(''))).toEqual([]);
  });
});

describe('eventi nello stato', () => {
  it('lo stato tiene gli ultimi RECENT_EVENTS_LIMIT eventi, dal più vecchio', () => {
    const lines = score(times('h', 25));
    const all = eventsOf(lines);
    expect(all.length).toBeGreaterThan(RECENT_EVENTS_LIMIT);
    const state = computeMatchState(parsedOf(lines));
    expect(state.events).toEqual(all.slice(-RECENT_EVENTS_LIMIT));
    expect(recentEvents(all, 2)).toEqual(all.slice(-2));
    expect(recentEvents(all, 0)).toEqual([]);
  });

  it('tipi ed priorità: elenco chiuso, priorità 1-10', () => {
    for (const kind of MATCH_EVENT_KINDS) {
      expect(MATCH_EVENT_PRIORITY[kind]).toBeGreaterThanOrEqual(1);
      expect(MATCH_EVENT_PRIORITY[kind]).toBeLessThanOrEqual(10);
    }
    expect(MATCH_EVENT_PRIORITY.matchPoint).toBeGreaterThan(MATCH_EVENT_PRIORITY.ace);
  });
});

/**
 * Riproduzione riga per riga, come l'agente che invia il file mentre DataVolley lo scrive: un evento, una volta
 * comparso, resta uguale (stesso id e stesso contenuto) e un client che tiene gli id già visti non lo mostra due volte.
 */
function replay(parsed: ParsedMatch): void {
  const full = matchEvents(parsed);
  const byId = new Map(full.map((e) => [e.id, e]));
  expect(byId.size).toBe(full.length);
  const json = new Map(full.map((e) => [e.id, JSON.stringify(e)]));
  const changed: string[] = [];
  // The state carries the most recent events (checked once; line by line only the events, faster).
  expect(computeMatchState(parsed).events).toEqual(recentEvents(full));
  const seen = new Set<string>();
  let shown = 0;
  for (let k = 0; k <= parsed.scout.length; k++) {
    const prefix = { ...parsed, scout: parsed.scout.slice(0, k) };
    const events = matchEvents(prefix);
    // Compared as JSON (same content, same order of the fields) and checked once at the end: much faster.
    for (const e of events) if (json.get(e.id) !== JSON.stringify(e)) changed.push(`riga ${k}: ${e.id}`);
    for (const e of recentEvents(events)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      shown++;
    }
  }
  expect(changed).toEqual([]);
  expect(shown).toBe(full.length);
}

describe('eventi: riproduzione riga per riga', () => {
  it('campione samples/partita-sintetica.dvw', () => {
    const file = fileURLToPath(new URL('../../../samples/partita-sintetica.dvw', import.meta.url));
    const parsed = parseDvw(readFileSync(file));
    replay(parsed);
    const events = matchEvents(parsed);
    const found = new Set(events.map((e) => e.kind));
    for (const kind of ['ace', 'block', 'attack', 'run', 'setPoint', 'matchPoint', 'timeout', 'substitution', 'setEnd'])
      expect(found).toContain(kind);
    expect(events.filter((e) => e.kind === 'matchEnd')).toHaveLength(1);
  });

  for (const seed of [1, 2]) {
    it(`partita del simulatore, seed ${seed}, 5 set`, () => {
      const match = generateMatch({ seed, sets: 5 });
      replay(parseDvw(renderDvw(match, match.lines.length)));
    });
  }
});
