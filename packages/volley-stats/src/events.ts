import type { ParsedMatch } from '@sir/dvw-parser';
import { describePoint } from './score.js';
import type { PointEvent, Timeline } from './timeline.js';
import { buildTimeline } from './timeline.js';
import type { EventPlayer, MatchEvent, MatchEventKind, PlayerRef, Side } from './types.js';
import { other } from './util.js';
import { playerRefs } from './players.js';

/** Eventi della partita, dal più importante al meno importante per le priorità predefinite. */
export const MATCH_EVENT_KINDS = [
  'matchEnd',
  'matchPoint',
  'setEnd',
  'setPoint',
  'ace',
  'block',
  'lead',
  'tie',
  'run',
  'timeout',
  'longRally',
  'substitution',
] as const satisfies readonly MatchEventKind[];

/** Priorità predefinita (1-10, più alta = più importante): il portale mostra prima l'evento più importante. */
export const MATCH_EVENT_PRIORITY: Record<MatchEventKind, number> = {
  matchEnd: 10,
  matchPoint: 9,
  setEnd: 8,
  setPoint: 7,
  ace: 6,
  block: 6,
  lead: 5,
  tie: 4,
  run: 4,
  timeout: 4,
  longRally: 3,
  substitution: 2,
};

/** Eventi tenuti nello stato (`MatchState.events`): gli ultimi, quanti bastano agli avvisi del portale. */
export const RECENT_EVENTS_LIMIT = 20;
/** Punti consecutivi di una squadra da cui si segnala la serie (break). */
export const RUN_MIN_POINTS = 3;
/** Attacchi (delle due squadre) da cui un rally è uno scambio lungo. */
export const LONG_RALLY_MIN_ATTACKS = 4;
/** Rimonta (svantaggio massimo recuperato) da cui pareggio e sorpasso si segnalano a qualsiasi punteggio. */
export const COMEBACK_MIN_POINTS = 3;

const SETS_TO_WIN = 3;
/** Funzione pura: punti per vincere il set (senza i due di scarto): 25, 15 al tie-break (5° set). */
export const setTarget = (set: number): number => (set >= 5 ? 15 : 25);
/** Punteggio da cui pareggio e sorpasso si segnalano sempre: 15 nei set a 25, 9 al tie-break (3/5 del set). */
const lateScore = (set: number): number => Math.round((setTarget(set) * 3) / 5);

/** Squadra che ha set point al punteggio dato (un punto dalla vittoria del set), `null` se nessuna. */
export function setPointTeam(set: number, homeScore: number, awayScore: number): Side | null {
  if (homeScore === awayScore) return null;
  const leader: Side = homeScore > awayScore ? 'home' : 'away';
  const lead = Math.max(homeScore, awayScore);
  const diff = Math.abs(homeScore - awayScore);
  const target = setTarget(set);
  // Set già vinto: almeno `target` punti con due di scarto.
  if (lead >= target && diff >= 2) return null;
  return lead >= target - 1 ? leader : null;
}

/**
 * Funzione pura: tutti gli eventi della partita in ordine di riga, ognuno con un `id` stabile (tipo, set e
 * punteggio, o il conteggio nel set): rileggendo lo stesso file, o lo stesso file con righe in più, gli eventi già
 * trovati hanno lo stesso id. Eventi:
 * - `ace` (battuta #) e `block` (muro #): punto diretto, col giocatore;
 * - `run`: la squadra segna il RUN_MIN_POINTS° punto consecutivo nel set, e ogni punto dopo (`count` = punti);
 * - `longRally`: rally con almeno LONG_RALLY_MIN_ATTACKS attacchi (`count` = attacchi), squadra che segna;
 * - `setPoint`/`matchPoint`: una squadra arriva a un punto dalla vittoria del set (della partita, se ha già 2 set),
 *   solo quando la situazione nasce (24-20 sì, 24-21 no; 25-24 dopo il 24-24 sì), ai vantaggi e al tie-break a 15;
 * - `tie`: pareggio dal 15-15 (9-9 al tie-break) o dopo una rimonta di COMEBACK_MIN_POINTS punti;
 * - `lead`: sorpasso (passa avanti la squadra che era dietro prima del pareggio), con la stessa soglia;
 * - `timeout`, `substitution` (giocatore che entra, `playerOut` quello che esce);
 * - `setEnd` (riga `**Nset`) e, al set che dà il 3° set vinto, `matchEnd` al posto di `setEnd`.
 * Non lancia mai; le righe sconosciute non contano.
 */
export function detectEvents(tl: Timeline, players: Record<Side, PlayerRef[]>): MatchEvent[] {
  const out: MatchEvent[] = [];
  const pointByIndex = new Map<number, PointEvent>();
  for (const p of tl.points) pointByIndex.set(p.index, p);
  const playerOf = (team: Side, number: number | null): EventPlayer | null => {
    if (number === null || !Number.isInteger(number)) return null;
    const ref = players[team].find((p) => p.number === number);
    return { number, firstName: ref?.firstName ?? null, lastName: ref?.lastName ?? null };
  };

  const setsWon: Record<Side, number> = { home: 0, away: 0 };
  const closed = new Set<number>();
  let set = 0;
  let home = 0;
  let away = 0;
  let run: { team: Side; length: number } | null = null;
  let setPointOf: Side | null = null;
  let lastLeader: Side | null = null;
  const maxDeficit: Record<Side, number> = { home: 0, away: 0 };
  const comeback: Record<Side, number> = { home: 0, away: 0 };
  const timeouts: Record<Side, number> = { home: 0, away: 0 };

  const closeSet = (n: number): Side | null => {
    if (closed.has(n) || home === away) return null;
    closed.add(n);
    const winner: Side = home > away ? 'home' : 'away';
    setsWon[winner]++;
    return winner;
  };

  const push = (
    kind: MatchEventKind,
    id: string,
    index: number,
    fields: Partial<Pick<MatchEvent, 'team' | 'player' | 'playerOut' | 'count'>> = {},
  ): void => {
    out.push({
      id,
      kind,
      index,
      set,
      team: fields.team ?? null,
      player: fields.player ?? null,
      playerOut: fields.playerOut ?? null,
      homeScore: home,
      awayScore: away,
      count: fields.count ?? null,
      priority: MATCH_EVENT_PRIORITY[kind],
    });
  };

  for (const r of tl.resolved) {
    if (r.set !== set) {
      // Set nuovo senza `**Nset` per il precedente: il set chiuso conta per i set vinti, senza evento.
      if (set > 0) closeSet(set);
      set = r.set;
      home = 0;
      away = 0;
      run = null;
      setPointOf = null;
      lastLeader = null;
      maxDeficit.home = maxDeficit.away = comeback.home = comeback.away = 0;
      timeouts.home = timeouts.away = 0;
    }
    const e = r.entry;
    switch (e.kind) {
      case 'point': {
        const prevTied = home === away;
        home = e.homeScore;
        away = e.awayScore;
        const scorer = e.team;
        const score = `${set}-${home}-${away}`;
        const pe = pointByIndex.get(e.index);
        if (pe) {
          const decisive = describePoint(pe);
          if ((decisive.kind === 'serve' || decisive.kind === 'block') && decisive.playerTeam) {
            push(
              decisive.kind === 'serve' ? 'ace' : 'block',
              `${decisive.kind === 'serve' ? 'ace' : 'block'}-${score}`,
              e.index,
              {
                team: decisive.playerTeam,
                player: playerOf(decisive.playerTeam, decisive.player),
              },
            );
          }
          const attacks = pe.actions.filter((a) => a.skill === 'attack').length;
          if (attacks >= LONG_RALLY_MIN_ATTACKS)
            push('longRally', `longRally-${score}`, e.index, { team: scorer, count: attacks });
        }
        run = run && run.team === scorer ? { team: scorer, length: run.length + 1 } : { team: scorer, length: 1 };
        if (run.length >= RUN_MIN_POINTS) push('run', `run-${score}`, e.index, { team: scorer, count: run.length });

        // Dal 15-15 (9-9 al tie-break): il punteggio più basso è già alla soglia.
        const late = Math.min(home, away) >= lateScore(set);
        if (home === away) {
          if (home > 0 && (late || maxDeficit[scorer] >= COMEBACK_MIN_POINTS))
            push('tie', `tie-${score}`, e.index, { team: scorer });
          comeback[scorer] = maxDeficit[scorer];
          maxDeficit.home = maxDeficit.away = 0;
        } else {
          const leader: Side = home > away ? 'home' : 'away';
          const gap = Math.abs(home - away);
          maxDeficit[other(leader)] = Math.max(maxDeficit[other(leader)], gap);
          if (prevTied && leader === scorer && lastLeader === other(scorer)) {
            if (late || comeback[scorer] >= COMEBACK_MIN_POINTS)
              push('lead', `lead-${score}`, e.index, { team: scorer });
          }
          lastLeader = leader;
        }

        const sp = setPointTeam(set, home, away);
        if (sp !== null && sp !== setPointOf) {
          const kind = setsWon[sp] === SETS_TO_WIN - 1 ? 'matchPoint' : 'setPoint';
          push(kind, `${kind}-${score}`, e.index, { team: sp });
        }
        setPointOf = sp;
        break;
      }
      case 'timeout': {
        timeouts[e.team]++;
        push('timeout', `timeout-${set}-${e.team}-${timeouts[e.team]}`, e.index, { team: e.team });
        break;
      }
      case 'substitution':
        push('substitution', `substitution-${set}-${home}-${away}-${e.team}-${e.out}-${e.in}`, e.index, {
          team: e.team,
          player: playerOf(e.team, e.in),
          playerOut: playerOf(e.team, e.out),
        });
        break;
      case 'setEnd': {
        if (!tl.endedSets.has(e.setNumber) || e.setNumber !== set) break;
        const winner = closeSet(set);
        if (!winner) break;
        if (setsWon[winner] === SETS_TO_WIN) push('matchEnd', 'matchEnd', e.index, { team: winner });
        else push('setEnd', `setEnd-${set}`, e.index, { team: winner });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Funzione pura: gli eventi più recenti (al massimo `limit`), dal più vecchio al più nuovo. */
export const recentEvents = (events: MatchEvent[], limit = RECENT_EVENTS_LIMIT): MatchEvent[] =>
  limit <= 0 ? [] : events.slice(-limit);

/** Funzione pura: tutti gli eventi della partita dall'output del parser (vedi `detectEvents`). */
export function matchEvents(parsed: ParsedMatch): MatchEvent[] {
  return detectEvents(buildTimeline(parsed), {
    home: playerRefs(parsed.homePlayers),
    away: playerRefs(parsed.awayPlayers),
  });
}
