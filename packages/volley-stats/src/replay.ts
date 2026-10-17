import { summarizeMomentum } from './momentum.js';
import { computeSetsWon, SETS_TO_WIN } from './score.js';
import type { LastPoint, LiveState, MatchEvent, MatchState, MomentumPoint, SetSummary, Side } from './types.js';

/** Un punto dell'andamento con il suo set, nell'ordine della partita. */
export interface MatchPoint extends MomentumPoint {
  set: number;
}

/** Punti della partita in ordine (dall'andamento dello stato), con il set di ognuno. */
export function matchPoints(state: Pick<MatchState, 'momentum'>): MatchPoint[] {
  const sets = (state.momentum as Partial<MatchState['momentum']> | undefined)?.sets;
  if (!Array.isArray(sets)) return [];
  return sets.flatMap(({ set, points }) => points.map((p) => ({ ...p, set })));
}

const samePoint = (a: MatchPoint, b: MatchPoint): boolean =>
  a.set === b.set &&
  a.index === b.index &&
  a.homeScore === b.homeScore &&
  a.awayScore === b.awayScore &&
  a.scorer === b.scorer;

/**
 * I punti di `before` sono l'inizio dei punti di `after` (nessun punto tolto né cambiato): `after` aggiunge solo
 * punti nuovi in fondo. Falso quando lo scout ha corretto o tolto un punto già giocato.
 */
export function pointsExtend(before: Pick<MatchState, 'momentum'>, after: Pick<MatchState, 'momentum'>): boolean {
  const a = matchPoints(before);
  const b = matchPoints(after);
  if (a.length > b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return q !== undefined && samePoint(p, q);
  });
}

const eventsOf = (state: MatchState): MatchEvent[] => {
  const events = (state as Partial<MatchState>).events;
  return Array.isArray(events) ? events : [];
};

const describedAs = (lp: LastPoint, p: MatchPoint): boolean =>
  lp.set === p.set && lp.homeScore === p.homeScore && lp.awayScore === p.awayScore && lp.team === p.scorer;

/** Punto senza descrizione (stato salvato prima di `recentPoints`, o punto più vecchio di quelli descritti). */
const bareLastPoint = (p: MatchPoint): LastPoint => ({
  set: p.set,
  team: p.scorer,
  homeScore: p.homeScore,
  awayScore: p.awayScore,
  kind: 'unknown',
  skill: null,
  player: null,
  playerTeam: null,
  evaluation: null,
  label: 'punto',
});

/**
 * Stato della partita come appariva subito dopo i primi `count` punti, ricavato solo da `state` (funzione pura,
 * `state` non cambia): per mostrare uno alla volta i punti arrivati tutti insieme. Si ricostruiscono ciò che cambia
 * punto per punto (set e punteggi, set vinti, stato della partita, battuta, ultimo punto e ultimi punti, serie,
 * andamento, time-out e cambi del set, esatti solo pochi punti indietro, finché gli eventi successivi restano tra gli ultimi
 * `RECENT_EVENTS_LIMIT` di `state`; eventi fino a quel punto); fase `rally` (le pause arrivano con lo stato vero);
 * statistiche, rotazioni, zone e formazioni restano quelle di `state`. `count` oltre i punti di `state`: `state`.
 */
export function matchStateUntilPoint(state: MatchState, count: number): MatchState {
  const all = matchPoints(state);
  if (count >= all.length) return state;
  const kept = all.slice(0, Math.max(0, count));
  const last = kept[kept.length - 1];
  const events = eventsOf(state);
  if (last === undefined) {
    return {
      ...state,
      sets: [],
      setsWon: { home: 0, away: 0 },
      status: 'notStarted',
      live: {
        ...state.live,
        set: 1,
        homeScore: 0,
        awayScore: 0,
        servingTeam: null,
        timeouts: { home: 0, away: 0 },
        substitutions: { home: 0, away: 0 },
        lastPoint: null,
        recentPoints: [],
        run: null,
      },
      momentum: summarizeMomentum([]),
      phase: { kind: 'preMatch' },
      events: [],
    };
  }

  const set = last.set;
  const setComplete = !all.some((p, i) => i >= kept.length && p.set === set);
  const sets: SetSummary[] = state.sets
    .filter((s) => s.number <= set)
    .map((s) =>
      s.number < set || setComplete
        ? s
        : {
            ...s,
            homeScore: last.homeScore,
            awayScore: last.awayScore,
            finished: false,
            winner: null,
            endTime: last.time ?? s.endTime,
          },
    );
  const setsWon = computeSetsWon(sets);
  const finished = setsWon.home >= SETS_TO_WIN || setsWon.away >= SETS_TO_WIN;
  const setOver = sets.find((s) => s.number === set)?.finished === true;

  // Il punto e i suoi eventi stanno su righe scout fino a quella del punto; quelli dopo non sono ancora successi.
  const shownEvents = events.filter((e) => e.index <= last.index);
  // Time-out e cambi del set fino al punto: quelli dell'intero set (dal riepilogo del set; per uno stato salvato prima
  // che esistesse, quelli del set in corso) meno quelli scritti dopo il punto, che sono tra gli ultimi eventi.
  const summary = state.sets.find((s) => s.number === set) as Partial<SetSummary> | undefined;
  const counted = (kind: 'timeout' | 'substitution', team: Side): number => {
    const key = kind === 'timeout' ? 'timeouts' : 'substitutions';
    const total = summary?.[key]?.[team] ?? (state.live.set === set ? state.live[key][team] : null);
    const inSet = events.filter((e) => e.kind === kind && e.set === set && e.team === team);
    if (total === null || total === undefined) return inSet.filter((e) => e.index <= last.index).length;
    return Math.max(0, total - inSet.filter((e) => e.index > last.index).length);
  };

  const described = Array.isArray((state.live as Partial<LiveState>).recentPoints) ? state.live.recentPoints : [];
  const at = described.findIndex((lp) => describedAs(lp, last));
  const recentPoints = at >= 0 ? described.slice(0, at + 1) : [];
  const lastPoint = recentPoints[recentPoints.length - 1] ?? bareLastPoint(last);

  const inSet = kept.filter((p) => p.set === set);
  let length = 0;
  for (let i = inSet.length - 1; i >= 0 && inSet[i]?.scorer === last.scorer; i--) length++;

  return {
    ...state,
    sets,
    setsWon,
    status: finished ? 'finished' : 'inProgress',
    live: {
      ...state.live,
      set,
      homeScore: last.homeScore,
      awayScore: last.awayScore,
      servingTeam: setOver || finished ? null : last.scorer,
      timeouts: { home: counted('timeout', 'home'), away: counted('timeout', 'away') },
      substitutions: { home: counted('substitution', 'home'), away: counted('substitution', 'away') },
      lastPoint,
      recentPoints,
      run: { team: last.scorer, length },
    },
    momentum: summarizeMomentum(kept.map(({ set: s, ...point }) => ({ set: s, point }))),
    phase: { kind: 'rally', set },
    events: shownEvents,
  };
}
