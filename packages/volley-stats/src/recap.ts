import type { TopPlayer } from './leaders.js';
import { topPlayers } from './leaders.js';
import { emptyStatLine } from './stats.js';
import type { MatchState, PlayerStats, Ratio, Side, StatLine, TeamStats } from './types.js';
import { SIDES } from './util.js';

/** Riepilogo consolidato di un set (schermata della pausa di fine set). */
export interface SetRecap {
  set: number;
  homeScore: number;
  awayScore: number;
  winner: Side | null;
  finished: boolean;
  durationMinutes: number | null;
  /** Statistiche di squadra del solo set: punti per fondamentale, attacco, battuta, ricezione, muri, errori. */
  teams: Record<Side, StatLine>;
  /** Migliore giocatore del set: il primo di `topPlayers` sulle statistiche del solo set; `null` senza punti. */
  best: TopPlayer | null;
}

/** Statistiche di una squadra ridotte al set `set` (ogni giocatore con le sole azioni del set). */
function teamInSet(team: TeamStats, set: string): TeamStats {
  const players: Record<string, PlayerStats> = {};
  for (const [key, p] of Object.entries(team.players)) {
    const line = p.bySet[set];
    if (line) players[key] = { number: p.number, total: line, bySet: { [set]: line } };
  }
  const line = team.bySet[set] ?? emptyStatLine();
  return { total: line, bySet: { [set]: line }, players };
}

/**
 * Funzione pura: riepilogo del set `set` dallo stato già calcolato (statistiche `bySet`), `null` se il set non c'è.
 * Il punteggio è quello ufficiale del set (righe `point`).
 */
export function setRecap(state: Pick<MatchState, 'sets' | 'stats' | 'players'>, set: number): SetRecap | null {
  const summary = state.sets.find((s) => s.number === set);
  if (!summary) return null;
  const key = String(set);
  const stats: Record<Side, TeamStats> = {
    home: teamInSet(state.stats.home, key),
    away: teamInSet(state.stats.away, key),
  };
  const [best] = topPlayers({ stats, players: state.players }, { limit: 1 });
  return {
    set,
    homeScore: summary.homeScore,
    awayScore: summary.awayScore,
    winner: summary.winner,
    finished: summary.finished,
    durationMinutes: summary.durationMinutes,
    teams: { home: stats.home.total, away: stats.away.total },
    best: best ?? null,
  };
}

/** MVP della partita: il giocatore di `topPlayers` con l'efficienza d'attacco usata per gli spareggi. */
export interface Mvp extends TopPlayer {
  attackTotal: number;
  /** (attacchi # − errori − murati) / attacchi, `null` senza attacchi. */
  attackEfficiency: Ratio;
}

/**
 * Funzione pura: MVP della partita, deterministico. Regola:
 * 1. candidati: i giocatori della squadra che ha vinto la partita (a partita finita); altrimenti, o se nessuno dei
 *    vincitori ha punti, quelli di tutte e due le squadre; solo chi ha almeno un punto;
 * 2. vince chi ha più punti (attacco # + muro # + battuta #);
 * 3. a parità, la migliore efficienza d'attacco (senza attacchi conta meno di qualsiasi efficienza);
 * 4. poi meno errori, poi la squadra di casa, poi il numero di maglia più basso.
 * `null` se nessun giocatore ha punti.
 */
export function matchMvp(state: Pick<MatchState, 'stats' | 'players' | 'setsWon' | 'status'>): Mvp | null {
  const { home, away } = state.setsWon;
  const winner: Side | null = state.status === 'finished' && home !== away ? (home > away ? 'home' : 'away') : null;
  const all = (team: Side | 'both'): Mvp[] =>
    topPlayers(state, { limit: Number.MAX_SAFE_INTEGER, team }).map((p) => {
      const attack = state.stats[p.team].players[String(p.number)]?.total.attack;
      return { ...p, attackTotal: attack?.total ?? 0, attackEfficiency: attack?.efficiency ?? null };
    });
  let candidates = winner ? all(winner) : [];
  if (candidates.length === 0) candidates = all('both');
  const eff = (r: Ratio): number => (r === null ? Number.NEGATIVE_INFINITY : r);
  candidates.sort(
    (a, b) =>
      b.points - a.points ||
      eff(b.attackEfficiency) - eff(a.attackEfficiency) ||
      a.errors - b.errors ||
      SIDES.indexOf(a.team) - SIDES.indexOf(b.team) ||
      a.number - b.number,
  );
  return candidates[0] ?? null;
}
