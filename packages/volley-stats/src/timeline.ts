import type { ActionEntry, ParsedMatch, ScoutEntry } from '@sir/dvw-parser';
import type { Side } from './types.js';
import { other } from './util.js';

export interface Resolved {
  entry: ScoutEntry;
  /** Set a cui appartiene la riga (campo della riga, altrimenti dedotto). */
  set: number;
}

export interface PointEvent {
  index: number;
  set: number;
  scorer: Side;
  /** Squadra al servizio nel rally; `null` se non ricavabile. */
  server: Side | null;
  homeScore: number;
  awayScore: number;
  time?: string;
  setter: Record<Side, number | null>;
  /** Azioni del rally concluso da questo punto. */
  actions: ActionEntry[];
  /** Nel rally c'è un codice verde. */
  green: boolean;
}

export interface Timeline {
  resolved: Resolved[];
  points: PointEvent[];
  endedSets: Set<number>;
}

const validPos = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 6;
const validSet = (n: number | undefined): n is number => n !== undefined && Number.isInteger(n) && n >= 1 && n <= 5;

/**
 * Percorre le righe scout una volta sola: assegna a ogni riga il set, e costruisce i punti con squadra al servizio,
 * posizione dei palleggiatori e azioni del rally. Non lancia mai.
 */
export function buildTimeline(parsed: ParsedMatch): Timeline {
  const resolved: Resolved[] = [];
  const points: PointEvent[] = [];
  const endedSets = new Set<number>();

  let fallbackSet = 1;
  let lastSet = 1;
  let server: Side | null = null;
  let rally: ActionEntry[] = [];
  let green = false;
  const setter: Record<Side, number | null> = { home: null, away: null };

  for (const entry of parsed.scout) {
    // La riga `**Nset` appartiene al set N: DataVolley nel suo campo set scrive già il set successivo.
    let set =
      entry.kind === 'setEnd' && validSet(entry.setNumber)
        ? entry.setNumber
        : validSet(entry.set)
          ? entry.set
          : fallbackSet;
    if (set < lastSet) set = lastSet;
    if (set !== lastSet) {
      server = null;
      rally = [];
      green = false;
      lastSet = set;
    }
    fallbackSet = set;
    resolved.push({ entry, set });

    if (entry.homeSetterPosition !== undefined && validPos(entry.homeSetterPosition))
      setter.home = entry.homeSetterPosition;
    if (entry.awaySetterPosition !== undefined && validPos(entry.awaySetterPosition))
      setter.away = entry.awaySetterPosition;

    switch (entry.kind) {
      case 'rotation':
        if (entry.number >= 1 && entry.number <= 6) setter[entry.team] = entry.number;
        break;
      case 'action':
        if (entry.skill === 'serve') server = entry.team;
        rally.push(entry);
        break;
      case 'greenCode':
        green = true;
        break;
      case 'setEnd':
        if (validSet(entry.setNumber)) endedSets.add(entry.setNumber);
        fallbackSet = set + 1;
        rally = [];
        green = false;
        server = null;
        break;
      case 'point': {
        let srv = server;
        if (srv === null) {
          const phased = [...rally].reverse().find((a) => a.pointPhase === 's' || a.pointPhase === 'r');
          if (phased) srv = phased.pointPhase === 's' ? phased.team : other(phased.team);
        }
        points.push({
          index: entry.index,
          set,
          scorer: entry.team,
          server: srv,
          homeScore: entry.homeScore,
          awayScore: entry.awayScore,
          ...(entry.time ? { time: entry.time } : {}),
          setter: { ...setter },
          actions: rally,
          green,
        });
        server = entry.team;
        rally = [];
        green = false;
        break;
      }
      default:
        break;
    }
  }
  return { resolved, points, endedSets };
}
