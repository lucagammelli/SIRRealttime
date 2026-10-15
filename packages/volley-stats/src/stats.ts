import type { ActionEntry } from '@sir/dvw-parser';
import type { PlayerStats, Side, StatLine, TeamStats } from './types.js';
import type { Resolved } from './timeline.js';
import { ratio } from './util.js';

/** Contatori grezzi, da cui si ricavano le statistiche. */
interface Counts {
  serveTotal: number;
  aces: number;
  serveErrors: number;
  recTotal: number;
  recPerfect: number;
  recPositive: number;
  recErrors: number;
  attTotal: number;
  attKills: number;
  attErrors: number;
  attBlocked: number;
  blockKills: number;
  blockTouches: number;
  digTotal: number;
  digErrors: number;
  otherErrors: number;
}

const emptyCounts = (): Counts => ({
  serveTotal: 0,
  aces: 0,
  serveErrors: 0,
  recTotal: 0,
  recPerfect: 0,
  recPositive: 0,
  recErrors: 0,
  attTotal: 0,
  attKills: 0,
  attErrors: 0,
  attBlocked: 0,
  blockKills: 0,
  blockTouches: 0,
  digTotal: 0,
  digErrors: 0,
  otherErrors: 0,
});

function addAction(c: Counts, a: ActionEntry): void {
  const ev = a.evaluation;
  switch (a.skill) {
    case 'serve':
      c.serveTotal++;
      if (ev === '#') c.aces++;
      if (ev === '=') c.serveErrors++;
      break;
    case 'reception':
      c.recTotal++;
      if (ev === '#') c.recPerfect++;
      if (ev === '#' || ev === '+') c.recPositive++;
      if (ev === '=') c.recErrors++;
      break;
    case 'attack':
      c.attTotal++;
      if (ev === '#') c.attKills++;
      if (ev === '=') c.attErrors++;
      if (ev === '/') c.attBlocked++;
      break;
    case 'block':
      c.blockTouches++;
      if (ev === '#') c.blockKills++;
      if (ev === '=' || ev === '/') c.otherErrors++;
      break;
    case 'dig':
      c.digTotal++;
      if (ev === '=') c.digErrors++;
      break;
    default:
      if (ev === '=') c.otherErrors++;
  }
}

function toLine(c: Counts): StatLine {
  return {
    serve: {
      total: c.serveTotal,
      aces: c.aces,
      errors: c.serveErrors,
      efficiency: ratio(c.aces - c.serveErrors, c.serveTotal),
    },
    reception: {
      total: c.recTotal,
      perfect: c.recPerfect,
      positive: c.recPositive,
      errors: c.recErrors,
      positivePct: ratio(c.recPositive, c.recTotal),
      perfectPct: ratio(c.recPerfect, c.recTotal),
    },
    attack: {
      total: c.attTotal,
      kills: c.attKills,
      errors: c.attErrors,
      blocked: c.attBlocked,
      killPct: ratio(c.attKills, c.attTotal),
      efficiency: ratio(c.attKills - c.attErrors - c.attBlocked, c.attTotal),
    },
    block: { kills: c.blockKills, touches: c.blockTouches },
    dig: { total: c.digTotal, errors: c.digErrors },
    points: c.attKills + c.blockKills + c.aces,
    errors: c.serveErrors + c.recErrors + c.attErrors + c.attBlocked + c.digErrors + c.otherErrors,
  };
}

/** Riga di statistiche senza azioni (tutto a zero, rapporti `null`). */
export const emptyStatLine = (): StatLine => toLine(emptyCounts());

interface Bucket {
  total: Counts;
  bySet: Map<number, Counts>;
}
const newBucket = (): Bucket => ({ total: emptyCounts(), bySet: new Map() });

function add(b: Bucket, set: number, a: ActionEntry): void {
  addAction(b.total, a);
  let s = b.bySet.get(set);
  if (!s) b.bySet.set(set, (s = emptyCounts()));
  addAction(s, a);
}

function bySetLines(b: Bucket): Record<string, StatLine> {
  const out: Record<string, StatLine> = {};
  for (const set of [...b.bySet.keys()].sort((x, y) => x - y)) {
    const c = b.bySet.get(set);
    if (c) out[String(set)] = toLine(c);
  }
  return out;
}

/** Statistiche di squadra e di giocatore (totali e per set) dalle azioni. */
export function computeStats(resolved: Resolved[]): Record<Side, TeamStats> {
  const teams: Record<Side, { team: Bucket; players: Map<number, Bucket> }> = {
    home: { team: newBucket(), players: new Map() },
    away: { team: newBucket(), players: new Map() },
  };
  for (const { entry, set } of resolved) {
    if (entry.kind !== 'action') continue;
    const t = teams[entry.team];
    add(t.team, set, entry);
    let p = t.players.get(entry.player);
    if (!p) t.players.set(entry.player, (p = newBucket()));
    add(p, set, entry);
  }
  const finish = (t: { team: Bucket; players: Map<number, Bucket> }): TeamStats => {
    const players: Record<string, PlayerStats> = {};
    for (const number of [...t.players.keys()].sort((x, y) => x - y)) {
      const b = t.players.get(number);
      if (b) players[String(number)] = { number, total: toLine(b.total), bySet: bySetLines(b) };
    }
    return { total: toLine(t.team.total), bySet: bySetLines(t.team), players };
  };
  return { home: finish(teams.home), away: finish(teams.away) };
}
