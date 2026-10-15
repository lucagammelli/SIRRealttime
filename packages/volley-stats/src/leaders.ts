import type { MatchState, PlayerRef, Side } from './types.js';
import { SIDES } from './util.js';

/** Giocatore nella classifica dei migliori (blocco «Migliori giocatori» del portale). */
export interface TopPlayer {
  team: Side;
  number: number;
  /** Anagrafica del giocatore, `null` se la maglia non è nell'elenco della squadra. */
  player: PlayerRef | null;
  /** Punti: attacco # + muro # + battuta #. */
  points: number;
  attackKills: number;
  blockKills: number;
  aces: number;
  errors: number;
}

export interface TopPlayersOptions {
  /** Quanti giocatori al massimo. */
  limit: number;
  /** Squadra: una sola oppure entrambe (default). */
  team?: Side | 'both';
}

/**
 * Funzione pura: i giocatori con più punti (solo chi ne ha almeno uno), dalle statistiche già calcolate. A parità di
 * punti conta chi ha più attacchi vincenti, poi chi ha meno errori, poi la squadra di casa e il numero di maglia più
 * basso (ordine sempre lo stesso).
 */
export function topPlayers(state: Pick<MatchState, 'stats' | 'players'>, options: TopPlayersOptions): TopPlayer[] {
  const team = options.team ?? 'both';
  const sides = team === 'both' ? SIDES : [team];
  const out: TopPlayer[] = [];
  for (const side of sides) {
    for (const stats of Object.values(state.stats[side].players)) {
      const line = stats.total;
      if (line.points <= 0) continue;
      out.push({
        team: side,
        number: stats.number,
        player: state.players[side].find((p) => p.number === stats.number) ?? null,
        points: line.points,
        attackKills: line.attack.kills,
        blockKills: line.block.kills,
        aces: line.serve.aces,
        errors: line.errors,
      });
    }
  }
  out.sort(
    (a, b) =>
      b.points - a.points ||
      b.attackKills - a.attackKills ||
      a.errors - b.errors ||
      SIDES.indexOf(a.team) - SIDES.indexOf(b.team) ||
      a.number - b.number,
  );
  return out.slice(0, Math.max(0, Math.floor(options.limit)));
}
