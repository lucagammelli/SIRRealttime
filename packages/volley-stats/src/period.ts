import type { PlayerRole } from '@sir/dvw-parser';
import { emptyStatLine } from './stats.js';
import type { MatchState, PlayerRef, Ratio, Side, StatLine } from './types.js';
import { SIDES } from './util.js';

/**
 * Periodo di un calcolo: l'intera partita oppure un set (chiuso o in corso: per il set in corso valgono i dati fino
 * all'ultima azione).
 */
export type Period = { kind: 'match' } | { kind: 'set'; set: number };

export const MATCH_PERIOD: Period = { kind: 'match' };
export const setPeriod = (set: number): Period => ({ kind: 'set', set });

type PeriodState = Pick<MatchState, 'stats' | 'players'>;

/** Riga di un giocatore nel periodo (blocchi «punti dei giocatori», ace, muri, percentuali di attacco). */
export interface PlayerPeriodLine {
  team: Side;
  number: number;
  /** Anagrafica, `null` se la maglia non è nell'elenco della squadra. */
  player: PlayerRef | null;
  role: PlayerRole | null;
  /** Attacco # + muro # + battuta #. */
  points: number;
  attackPoints: number;
  aces: number;
  blocks: number;
  errors: number;
  attack: { total: number; kills: number; killPct: Ratio; efficiency: Ratio };
  /** Ricezione e difese: le metriche del libero. */
  reception: { total: number; perfect: number; positive: number; positivePct: Ratio; perfectPct: Ratio };
  digs: number;
  /** Riga completa del periodo. */
  line: StatLine;
}

/** Realizzatore di un fondamentale (ace, muro). */
export interface Scorer {
  team: Side;
  number: number;
  player: PlayerRef | null;
  count: number;
}

export interface TeamPeriodSummary {
  /** Punti da azioni: attacco # + muro # + battuta # (gli errori avversari non sono qui: vedi il parziale). */
  points: number;
  attackPoints: number;
  blockPoints: number;
  aces: number;
  /** Realizzatori degli ace / dei muri punto, dal più al meno prolifico (a parità maglia più bassa). */
  aceScorers: Scorer[];
  blockScorers: Scorer[];
  errors: number;
  attackTotal: number;
  /** Attacco: punti / attacchi. */
  attackKillPct: Ratio;
  /** Attacco: (punti − errori − murati) / attacchi. */
  attackEfficiency: Ratio;
  receptionPositivePct: Ratio;
  line: StatLine;
  /** Tutti i giocatori con almeno un'azione nel periodo, dal primo per punti. */
  players: PlayerPeriodLine[];
}

export interface PeriodSummary {
  period: Period;
  /**
   * Parziale: `set` = punteggio ufficiale del set (righe `point`), `match` = set vinti.
   * `finished`: set chiuso, o partita finita.
   */
  score: { kind: 'set' | 'match'; home: number; away: number; finished: boolean };
  teams: Record<Side, TeamPeriodSummary>;
}

/** Riga del periodo di un giocatore, `undefined` se non ha azioni nel periodo. */
function periodLine(stats: PeriodState['stats'][Side]['players'][string], period: Period): StatLine | undefined {
  return period.kind === 'match' ? stats.total : stats.bySet[String(period.set)];
}

const roleOf = (p: PlayerRef | null): PlayerRole | null => p?.role ?? (p?.specialRole === 'L' ? 'libero' : null);

/** Ordine per punti: punti, attacchi vincenti, meno errori, maglia più bassa. */
const byPoints = (a: PlayerPeriodLine, b: PlayerPeriodLine): number =>
  b.points - a.points || b.attackPoints - a.attackPoints || a.errors - b.errors || a.number - b.number;

function playerLines(state: PeriodState, period: Period, team: Side): PlayerPeriodLine[] {
  const out: PlayerPeriodLine[] = [];
  for (const stats of Object.values(state.stats[team].players)) {
    const line = periodLine(stats, period);
    if (!line) continue;
    const player = state.players[team].find((p) => p.number === stats.number) ?? null;
    out.push({
      team,
      number: stats.number,
      player,
      role: roleOf(player),
      points: line.points,
      attackPoints: line.attack.kills,
      aces: line.serve.aces,
      blocks: line.block.kills,
      errors: line.errors,
      attack: {
        total: line.attack.total,
        kills: line.attack.kills,
        killPct: line.attack.killPct,
        efficiency: line.attack.efficiency,
      },
      reception: {
        total: line.reception.total,
        perfect: line.reception.perfect,
        positive: line.reception.positive,
        positivePct: line.reception.positivePct,
        perfectPct: line.reception.perfectPct,
      },
      digs: line.dig.total,
      line,
    });
  }
  return out.sort(byPoints);
}

function scorersOf(lines: PlayerPeriodLine[], pick: (l: PlayerPeriodLine) => number): Scorer[] {
  return lines
    .filter((l) => pick(l) > 0)
    .map((l) => ({ team: l.team, number: l.number, player: l.player, count: pick(l) }))
    .sort((a, b) => b.count - a.count || a.number - b.number);
}

function teamLine(state: Pick<MatchState, 'stats'>, period: Period, team: Side): StatLine {
  const t = state.stats[team];
  return (period.kind === 'match' ? t.total : t.bySet[String(period.set)]) ?? emptyStatLine();
}

/**
 * Funzione pura: sintesi del periodo per squadra (punti, ace e muri con realizzatori, errori, percentuali di attacco
 * e ricezione, giocatori ordinati per punti) più il parziale. `null` se il set richiesto non esiste.
 * Il set in corso vale fino all'ultima azione ricevuta.
 */
export function periodSummary(
  state: Pick<MatchState, 'stats' | 'players' | 'sets' | 'setsWon' | 'status'>,
  period: Period,
): PeriodSummary | null {
  let score: PeriodSummary['score'];
  if (period.kind === 'match') {
    score = {
      kind: 'match',
      home: state.setsWon.home,
      away: state.setsWon.away,
      finished: state.status === 'finished',
    };
  } else {
    const s = state.sets.find((x) => x.number === period.set);
    if (!s) return null;
    score = { kind: 'set', home: s.homeScore, away: s.awayScore, finished: s.finished };
  }
  const team = (side: Side): TeamPeriodSummary => {
    const line = teamLine(state, period, side);
    const players = playerLines(state, period, side);
    return {
      points: line.points,
      attackPoints: line.attack.kills,
      blockPoints: line.block.kills,
      aces: line.serve.aces,
      aceScorers: scorersOf(players, (p) => p.aces),
      blockScorers: scorersOf(players, (p) => p.blocks),
      errors: line.errors,
      attackTotal: line.attack.total,
      attackKillPct: line.attack.killPct,
      attackEfficiency: line.attack.efficiency,
      receptionPositivePct: line.reception.positivePct,
      line,
      players,
    };
  };
  return { period, score, teams: { home: team('home'), away: team('away') } };
}

/** Funzione pura: i primi `limit` marcatori di una squadra nel periodo (solo chi ha almeno un punto). */
export function scorers(state: PeriodState, period: Period, team: Side, limit: number): PlayerPeriodLine[] {
  return playerLines(state, period, team)
    .filter((p) => p.points > 0)
    .slice(0, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0)));
}

/** Ruoli dei duelli, nell'ordine in cui si mostrano. */
export const DUEL_ROLES: readonly PlayerRole[] = ['opposite', 'outside', 'middle', 'setter', 'libero'];

export interface RoleDuel {
  role: PlayerRole;
  /** Posizione dell'abbinamento nel ruolo (1 = i migliori di ciascuna squadra). */
  rank: number;
  home: PlayerPeriodLine;
  away: PlayerPeriodLine;
}

/** Libero: si ordina per palloni toccati in ricezione e difesa (non fa punti); gli altri per punti. */
function rankLines(role: PlayerRole, lines: PlayerPeriodLine[]): PlayerPeriodLine[] {
  if (role !== 'libero') return lines; // già ordinate per punti
  const touches = (l: PlayerPeriodLine): number => l.reception.total + l.digs;
  return [...lines].sort((a, b) => touches(b) - touches(a) || a.number - b.number);
}

/**
 * Funzione pura: duelli giocatore contro giocatore per ruolo, casa contro ospite.
 * - Ruoli in ordine fisso: opposto, schiacciatore, centrale, palleggiatore, libero.
 * - In ogni ruolo i giocatori che hanno agito nel periodo si ordinano per punti (libero: ricezioni + difese) e si
 *   abbinano per graduatoria: 1° con 1°, 2° con 2°… A parità: attacchi vincenti, meno errori, maglia più bassa.
 * - Si abbina solo fino al numero di giocatori della squadra che ne ha meno (nessun duello contro il vuoto).
 * - Un giocatore senza ruolo nel file (e che non sia segnato libero `L`) è escluso dai duelli.
 * - Per il libero i valori utili sono ricezione positiva/perfetta e difese (`reception`, `digs`), non i punti.
 */
export function roleDuels(state: PeriodState, period: Period): RoleDuel[] {
  const lines = { home: playerLines(state, period, 'home'), away: playerLines(state, period, 'away') };
  const duels: RoleDuel[] = [];
  for (const role of DUEL_ROLES) {
    const [h, a] = SIDES.map((side) =>
      rankLines(
        role,
        lines[side].filter((l) => l.role === role),
      ),
    );
    const n = Math.min(h?.length ?? 0, a?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const home = h?.[i];
      const away = a?.[i];
      if (home && away) duels.push({ role, rank: i + 1, home, away });
    }
  }
  return duels;
}

export type TeamDuelGroup =
  'Punti' | 'Battuta' | 'Ricezione' | 'Attacco' | 'Muro' | 'Difesa' | 'Errori' | 'Cambio palla';

/** Riga del confronto squadra contro squadra. */
export interface TeamDuelRow {
  key: string;
  group: TeamDuelGroup;
  label: string;
  kind: 'count' | 'ratio';
  home: number | null;
  away: number | null;
  /** `low`: meno è meglio (errori). */
  better: 'high' | 'low';
}

const TEAM_ROWS: {
  key: string;
  group: TeamDuelGroup;
  label: string;
  kind: 'count' | 'ratio';
  pick: (s: StatLine) => number | Ratio;
  better?: 'low';
}[] = [
  { key: 'points', group: 'Punti', label: 'Punti vinti (attacco, muro, ace)', kind: 'count', pick: (s) => s.points },
  { key: 'aces', group: 'Battuta', label: 'Ace', kind: 'count', pick: (s) => s.serve.aces },
  {
    key: 'serveErrors',
    group: 'Battuta',
    label: 'Errori in battuta',
    kind: 'count',
    pick: (s) => s.serve.errors,
    better: 'low',
  },
  { key: 'serveEff', group: 'Battuta', label: 'Efficienza battuta', kind: 'ratio', pick: (s) => s.serve.efficiency },
  {
    key: 'recPositive',
    group: 'Ricezione',
    label: 'Ricezione positiva',
    kind: 'ratio',
    pick: (s) => s.reception.positivePct,
  },
  {
    key: 'recPerfect',
    group: 'Ricezione',
    label: 'Ricezione perfetta',
    kind: 'ratio',
    pick: (s) => s.reception.perfectPct,
  },
  { key: 'kills', group: 'Attacco', label: 'Punti in attacco', kind: 'count', pick: (s) => s.attack.kills },
  { key: 'killPct', group: 'Attacco', label: 'Attacco: % punti', kind: 'ratio', pick: (s) => s.attack.killPct },
  { key: 'attackEff', group: 'Attacco', label: 'Efficienza attacco', kind: 'ratio', pick: (s) => s.attack.efficiency },
  { key: 'blocks', group: 'Muro', label: 'Punti a muro', kind: 'count', pick: (s) => s.block.kills },
  { key: 'digs', group: 'Difesa', label: 'Difese', kind: 'count', pick: (s) => s.dig.total },
  { key: 'errors', group: 'Errori', label: 'Errori totali', kind: 'count', pick: (s) => s.errors, better: 'low' },
];

/**
 * Funzione pura: righe del confronto squadra contro squadra nel periodo (stesse metriche e stesso ordine del blocco
 * «Confronto squadre» del portale). Le righe del cambio palla (side-out, break point) ci sono solo per l'intera
 * partita, perché `momentum` non è diviso per set. Set inesistente: valori `null` (come `teamComparison` del web).
 */
export function teamDuel(state: Pick<MatchState, 'stats' | 'momentum'>, period: Period): TeamDuelRow[] {
  const lineOf = (side: Side): StatLine | null =>
    period.kind === 'match' ? state.stats[side].total : (state.stats[side].bySet[String(period.set)] ?? null);
  const home = lineOf('home');
  const away = lineOf('away');
  const rows: TeamDuelRow[] = TEAM_ROWS.map((r) => ({
    key: r.key,
    group: r.group,
    label: r.label,
    kind: r.kind,
    home: home ? r.pick(home) : null,
    away: away ? r.pick(away) : null,
    better: r.better ?? 'high',
  }));
  if (period.kind === 'match') {
    const m = state.momentum;
    rows.push(
      {
        key: 'sideOut',
        group: 'Cambio palla',
        label: '% cambio palla (side-out)',
        kind: 'ratio',
        home: m.home.sideOutPct,
        away: m.away.sideOutPct,
        better: 'high',
      },
      {
        key: 'breakPoint',
        group: 'Cambio palla',
        label: '% break point',
        kind: 'ratio',
        home: m.home.breakPointPct,
        away: m.away.breakPointPct,
        better: 'high',
      },
    );
  }
  return rows;
}

/** Soglia «ogni N punti» raggiunta nel set in corso. */
export interface PointMilestone {
  /**
   * Chiave stabile, es. `set-2-16`. Il portale tiene, per ogni set, la soglia più alta già mostrata e apre la pausa
   * solo con una `threshold` più alta (se lo scout corregge un punto la chiave può scendere: non è una nuova pausa);
   * ignora il primo calcolo dopo il caricamento della pagina o una riconnessione.
   */
  key: string;
  set: number;
  /** Multiplo di `every` raggiunto (somma dei punti del set). */
  threshold: number;
  homeScore: number;
  awayScore: number;
}

/**
 * Funzione pura: soglia «ogni `every` punti» del set in corso, cioè il più grande multiplo di `every` che la somma
 * dei punti del set (casa + ospite) ha raggiunto; `null` se non ce n'è ancora una, se il set è chiuso (lì c'è la
 * pausa di fine set), se la partita non è in corso o se `every` non è un intero ≥ 1.
 * Se il punteggio salta più soglie tra due calcoli vale l'ultima.
 */
export function pointMilestone(
  state: Pick<MatchState, 'live' | 'sets' | 'status'>,
  every: number,
): PointMilestone | null {
  if (!Number.isInteger(every) || every < 1) return null;
  if (state.status !== 'inProgress') return null;
  const set = state.sets.find((s) => s.number === state.live.set);
  if (!set || set.finished) return null;
  const total = set.homeScore + set.awayScore;
  const threshold = Math.floor(total / every) * every;
  if (threshold < every) return null;
  return {
    key: `set-${set.number}-${threshold}`,
    set: set.number,
    threshold,
    homeScore: set.homeScore,
    awayScore: set.awayScore,
  };
}
