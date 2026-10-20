import type { ActionEntry } from '@arenalive/dvw-parser';
import type { Side, TeamZones, ZoneCell, ZoneMaps } from './types.js';
import type { Resolved } from './timeline.js';

const ZONE = /^[1-9]$/;

type CellMap = Map<string, ZoneCell>;
interface MapsAcc {
  attack: CellMap;
  serve: CellMap;
}
interface TeamAcc {
  team: MapsAcc;
  players: Map<number, MapsAcc>;
}
const newMaps = (): MapsAcc => ({ attack: new Map(), serve: new Map() });

function addCell(m: CellMap, a: ActionEntry, from: string, to: string): void {
  const key = `${from}>${to}`;
  let cell = m.get(key);
  if (!cell) m.set(key, (cell = { from, to, total: 0, byEvaluation: {} }));
  const ev = a.evaluation ?? '~';
  cell.total++;
  cell.byEvaluation[ev] = (cell.byEvaluation[ev] ?? 0) + 1;
}

const toList = (m: CellMap): ZoneCell[] =>
  [...m.values()].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
const finish = (m: MapsAcc): ZoneMaps => ({ attack: toList(m.attack), serve: toList(m.serve) });

/** Mappe di campo (zona di partenza → zona di arrivo) di attacco e battuta; le azioni senza zone valide sono escluse. */
export function computeZones(resolved: Resolved[]): Record<Side, TeamZones> {
  const home: TeamAcc = { team: newMaps(), players: new Map() };
  const away: TeamAcc = { team: newMaps(), players: new Map() };
  for (const { entry } of resolved) {
    if (entry.kind !== 'action') continue;
    if (entry.skill !== 'attack' && entry.skill !== 'serve') continue;
    const { startZone: from, endZone: to } = entry;
    if (from === undefined || to === undefined || !ZONE.test(from) || !ZONE.test(to)) continue;
    const t = entry.team === 'home' ? home : away;
    let p = t.players.get(entry.player);
    if (!p) t.players.set(entry.player, (p = newMaps()));
    const key = entry.skill;
    addCell(t.team[key], entry, from, to);
    addCell(p[key], entry, from, to);
  }
  const build = (t: TeamAcc): TeamZones => {
    const players: Record<string, ZoneMaps> = {};
    for (const n of [...t.players.keys()].sort((x, y) => x - y)) {
      const m = t.players.get(n);
      if (m) players[String(n)] = finish(m);
    }
    return { ...finish(t.team), players };
  };
  return { home: build(home), away: build(away) };
}
