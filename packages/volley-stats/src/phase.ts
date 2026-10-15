import type { MatchPhase, MatchStatus, SetSummary, Side } from './types.js';
import type { Timeline } from './timeline.js';

/**
 * Fase della partita (vedi `MatchPhase`) dalle righe già risolte: funzione pura, deterministica, mai l'orologio.
 * Righe di gioco = azioni e punti; i time-out sono le righe `*T`/`aT`; la fine del set è `**Nset`. Le righe
 * `unknown` (anche l'ultima riga troncata di un file salvato a metà), i codici verdi, i cambi, le rotazioni e i
 * palleggiatori non cambiano la fase.
 */
export function computePhase(
  tl: Timeline,
  sets: SetSummary[],
  status: MatchStatus,
  setsWon: Record<Side, number>,
): MatchPhase {
  const lastSet = sets[sets.length - 1]?.number ?? 1;
  if (status === 'finished') {
    const winner: Side | null = setsWon.home === setsWon.away ? null : setsWon.home > setsWon.away ? 'home' : 'away';
    return { kind: 'matchEnd', winner, setsWon: { ...setsWon }, lastSet };
  }
  if (status === 'notStarted') return { kind: 'preMatch' };

  let lastPlay = -1;
  let lastSetEnd = -1;
  let lastTimeout = -1;
  tl.resolved.forEach(({ entry }, i) => {
    if (entry.kind === 'action' || entry.kind === 'point') lastPlay = i;
    else if (entry.kind === 'setEnd' && tl.endedSets.has(entry.setNumber)) lastSetEnd = i;
    else if (entry.kind === 'timeout') lastTimeout = i;
  });

  const scoreOf = (set: number): { homeScore: number; awayScore: number } => {
    const s = sets.find((x) => x.number === set);
    return { homeScore: s?.homeScore ?? 0, awayScore: s?.awayScore ?? 0 };
  };

  const timeout = tl.resolved[lastTimeout];
  if (timeout && timeout.entry.kind === 'timeout' && lastTimeout > lastPlay && lastTimeout > lastSetEnd) {
    const { set } = timeout;
    const team = timeout.entry.team;
    let teamTimeouts = 0;
    for (const r of tl.resolved)
      if (r.set === set && r.entry.kind === 'timeout' && r.entry.team === team) teamTimeouts++;
    return { kind: 'timeout', set, team, teamTimeouts, ...scoreOf(set) };
  }

  const setEnd = tl.resolved[lastSetEnd];
  if (setEnd && lastSetEnd > lastPlay) {
    const set = setEnd.set;
    const summary = sets.find((x) => x.number === set);
    return {
      kind: 'setBreak',
      set,
      nextSet: set + 1,
      winner: summary?.winner ?? null,
      ...scoreOf(set),
    };
  }

  const play = tl.resolved[lastPlay];
  return { kind: 'rally', set: play?.set ?? lastSet };
}
