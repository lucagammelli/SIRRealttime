import type { ActionEntry, ParsedMatch, Skill } from '@arenalive/dvw-parser';
import type { LastPoint, LiveState, MatchStatus, Side, SetSummary } from './types.js';
import type { PointEvent, Timeline } from './timeline.js';
import { SIDES, other, timeToSeconds } from './util.js';

const SKILL_LABEL: Record<Skill, string> = {
  serve: 'battuta',
  reception: 'ricezione',
  attack: 'attacco',
  block: 'muro',
  dig: 'difesa',
  set: 'alzata',
  freeball: 'free ball',
};

/** Set da vincere per chiudere la partita. */
export const SETS_TO_WIN = 3;
/** Punti descritti in `LiveState.recentPoints`. */
export const RECENT_POINTS_LIMIT = 6;
/** Un passo indietro dell'ora più lungo di 12 ore è il passaggio della mezzanotte. */
const MIDNIGHT_GAP = 12 * 3600;

const validPos = (n: number | undefined): number | null =>
  n !== undefined && Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;

function durationMinutes(times: number[]): number | null {
  const first = times[0];
  if (first === undefined || times.length < 2) return null;
  // Il set può attraversare la mezzanotte: si "srotolano" le ore. Piccoli passi indietro (DataVolley scrive
  // la rotazione qualche secondo prima del punto) non sono un cambio di giorno e si ignorano.
  let latest = first;
  let offset = 0;
  for (const t of times) {
    if (latest - (t + offset) > MIDNIGHT_GAP) offset += 86400;
    latest = Math.max(latest, t + offset);
  }
  return Math.round((latest - first) / 60);
}

/** Riepilogo dei set. Il punteggio viene dall'ultima riga `point` del set, mai dal conteggio delle azioni. */
export function computeSets(parsed: ParsedMatch, tl: Timeline): SetSummary[] {
  const active = new Set<number>();
  const times = new Map<number, number[]>();
  const rawTimes = new Map<number, { first?: string; last?: string }>();
  const calls = new Map<number, { timeouts: Record<Side, number>; substitutions: Record<Side, number> }>();
  const callsOf = (set: number) => {
    let c = calls.get(set);
    if (!c) {
      c = { timeouts: { home: 0, away: 0 }, substitutions: { home: 0, away: 0 } };
      calls.set(set, c);
    }
    return c;
  };
  for (const { entry, set } of tl.resolved) {
    if (entry.kind === 'timeout') callsOf(set).timeouts[entry.team]++;
    if (entry.kind === 'substitution') callsOf(set).substitutions[entry.team]++;
    if (entry.kind === 'action' || entry.kind === 'point' || entry.kind === 'setEnd') active.add(set);
    if (entry.time) {
      const sec = timeToSeconds(entry.time);
      if (sec !== undefined) {
        const list = times.get(set) ?? [];
        times.set(set, list);
        list.push(sec);
        const r = rawTimes.get(set) ?? {};
        r.first ??= entry.time;
        r.last = entry.time;
        rawTimes.set(set, r);
      }
    }
  }
  for (const n of tl.endedSets) active.add(n);
  const numbers = [...active].sort((a, b) => a - b);
  const lastNumber = numbers[numbers.length - 1];
  const lastPointOf = new Map<number, PointEvent>();
  for (const p of tl.points) lastPointOf.set(p.set, p);

  return numbers.map((number) => {
    const lp = lastPointOf.get(number);
    const homeScore = lp?.homeScore ?? 0;
    const awayScore = lp?.awayScore ?? 0;
    const finished = tl.endedSets.has(number) || (lastNumber !== undefined && number < lastNumber);
    const winner: Side | null = finished && homeScore !== awayScore ? (homeScore > awayScore ? 'home' : 'away') : null;
    const raw = rawTimes.get(number);
    const fromTimes = durationMinutes(times.get(number) ?? []);
    const header = parsed.sets[number - 1]?.minutes;
    return {
      number,
      homeScore,
      awayScore,
      winner,
      finished,
      startTime: raw?.first ?? null,
      endTime: raw?.last ?? null,
      // Set chiuso: vale la durata ufficiale di DataVolley ([3SET]), che non conta le pause; altrimenti dalle ore.
      durationMinutes: finished && header !== undefined ? header : fromTimes,
      ...callsOf(number),
    };
  });
}

export function computeSetsWon(sets: SetSummary[]): Record<Side, number> {
  const won: Record<Side, number> = { home: 0, away: 0 };
  for (const s of sets) if (s.winner) won[s.winner]++;
  return won;
}

export function computeStatus(tl: Timeline, setsWon: Record<Side, number>): MatchStatus {
  if (setsWon.home >= SETS_TO_WIN || setsWon.away >= SETS_TO_WIN) return 'finished';
  const started = tl.resolved.some(({ entry }) => entry.kind === 'action' || entry.kind === 'point');
  return started ? 'inProgress' : 'notStarted';
}

/** Azione decisiva del rally concluso da un punto. */
/** Valutazioni che sono errori veri: `=` sempre, `/` solo per attacco (murato) e muro (invasione). */
const isError = (a: ActionEntry): boolean =>
  a.evaluation === '=' || (a.evaluation === '/' && (a.skill === 'attack' || a.skill === 'block'));

export function describePoint(p: PointEvent): LastPoint {
  const base = { set: p.set, team: p.scorer, homeScore: p.homeScore, awayScore: p.awayScore };
  const mk = (kind: LastPoint['kind'], a: ActionEntry, label: string): LastPoint => ({
    ...base,
    kind,
    skill: a.skill,
    player: a.player,
    playerTeam: a.team,
    evaluation: a.evaluation ?? null,
    label,
  });
  const scoring = [...p.actions]
    .reverse()
    .find(
      (a) =>
        a.team === p.scorer &&
        a.evaluation === '#' &&
        (a.skill === 'serve' || a.skill === 'attack' || a.skill === 'block'),
    );
  if (scoring && (scoring.skill === 'serve' || scoring.skill === 'attack' || scoring.skill === 'block')) {
    return mk(scoring.skill, scoring, `${SKILL_LABEL[scoring.skill]} #${scoring.player}`);
  }
  const error = [...p.actions].reverse().find((a) => a.team === other(p.scorer) && isError(a));
  if (error) return mk('opponentError', error, `errore ${SKILL_LABEL[error.skill]} #${error.player}`);
  const empty = { skill: null, player: null, playerTeam: null, evaluation: null };
  if (p.green) return { ...base, kind: 'greenCode', ...empty, label: 'codice verde' };
  return { ...base, kind: 'unknown', ...empty, label: 'punto' };
}

/** Stato "live": set corrente, punteggio, servizio, rotazioni, formazioni, timeout/cambi, ultimo punto, serie. */
export function computeLive(tl: Timeline): LiveState {
  const lastResolved = tl.resolved[tl.resolved.length - 1];
  const set = lastResolved?.set ?? 1;
  const inSet = tl.points.filter((p) => p.set === set);
  const last = inSet[inSet.length - 1];

  let servingTeam: Side | null = last ? last.scorer : null;
  if (!last) {
    const firstServe = tl.resolved.find(
      ({ entry, set: s }) => s === set && entry.kind === 'action' && entry.skill === 'serve',
    );
    servingTeam = firstServe && firstServe.entry.kind === 'action' ? firstServe.entry.team : null;
  } else {
    // Dopo l'ultimo punto, una battuta già scritta indica chi batte davvero.
    for (let i = tl.resolved.length - 1; i >= 0; i--) {
      const r = tl.resolved[i];
      if (!r || r.entry.kind === 'point') break;
      if (r.entry.kind === 'action' && r.entry.skill === 'serve') {
        servingTeam = r.entry.team;
        break;
      }
    }
  }

  // Set appena chiuso e nuovo set non ancora iniziato: nessuno batte fino alla prima serve.
  if (tl.endedSets.has(set)) servingTeam = null;

  const setterPosition: Record<Side, number | null> = { home: null, away: null };
  const lineups: Record<Side, (number | null)[]> = {
    home: [null, null, null, null, null, null],
    away: [null, null, null, null, null, null],
  };
  const lineupFound: Record<Side, boolean> = { home: false, away: false };
  const timeouts: Record<Side, number> = { home: 0, away: 0 };
  const substitutions: Record<Side, number> = { home: 0, away: 0 };

  for (let i = tl.resolved.length - 1; i >= 0; i--) {
    const r = tl.resolved[i];
    if (!r) continue;
    const e = r.entry;
    if (setterPosition.home === null) setterPosition.home = validPos(e.homeSetterPosition);
    if (setterPosition.away === null) setterPosition.away = validPos(e.awaySetterPosition);
    if (!lineupFound.home && e.homeLineup.some((n) => n !== undefined)) {
      lineups.home = e.homeLineup.map((n) => n ?? null);
      lineupFound.home = true;
    }
    if (!lineupFound.away && e.awayLineup.some((n) => n !== undefined)) {
      lineups.away = e.awayLineup.map((n) => n ?? null);
      lineupFound.away = true;
    }
  }
  for (const { entry, set: s } of tl.resolved) {
    if (s !== set) continue;
    if (entry.kind === 'timeout') timeouts[entry.team]++;
    if (entry.kind === 'substitution') substitutions[entry.team]++;
  }

  let run: LiveState['run'] = null;
  if (last) {
    let length = 0;
    for (let i = inSet.length - 1; i >= 0 && inSet[i]?.scorer === last.scorer; i--) length++;
    run = { team: last.scorer, length };
  }
  for (const s of SIDES) lineups[s] = lineups[s].slice(0, 6);

  return {
    set,
    homeScore: last?.homeScore ?? 0,
    awayScore: last?.awayScore ?? 0,
    servingTeam,
    setterPosition,
    lineups,
    timeouts,
    substitutions,
    lastPoint: last ? describePoint(last) : null,
    recentPoints: tl.points.slice(-RECENT_POINTS_LIMIT).map(describePoint),
    run,
  };
}
