import { COACHES, FIRST_NAMES, LAST_NAMES } from './names.js';
import { resolveProfile } from './profile.js';
import { Rng } from './rng.js';
import type {
  GenerateOptions,
  GeneratedMatch,
  LineKind,
  MatchProfile,
  Role,
  ScoutLine,
  SimPlayer,
  SimSet,
  SimTeam,
} from './types.js';

export const DEFAULT_START_TIME = '2025-01-18T18:00:00Z';
export const DEFAULT_HOME_NAME = 'Pallavolo Città';
export const DEFAULT_AWAY_NAME = 'Volley Club Lugo';

const ROLE_ORDER: Role[] = ['S', 'S', 'O', 'O', 'H', 'H', 'H', 'M', 'M', 'M', 'L', 'H', 'L', 'M'];

function teamCode(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return letters.slice(0, 3).padEnd(3, 'X');
}

function makeTeam(rng: Rng, name: string, idBase: number): SimTeam {
  const size = rng.int(12, 14);
  const numbers = rng.shuffle(Array.from({ length: 20 }, (_, i) => i + 1)).slice(0, size);
  const usedNames = new Set<string>();
  const players: SimPlayer[] = [];
  for (let i = 0; i < size; i++) {
    let lastName = rng.pick(LAST_NAMES);
    let firstName = rng.pick(FIRST_NAMES);
    while (usedNames.has(`${lastName} ${firstName}`)) {
      lastName = rng.pick(LAST_NAMES);
      firstName = rng.pick(FIRST_NAMES);
    }
    usedNames.add(`${lastName} ${firstName}`);
    players.push({
      number: numbers[i] as number,
      id: idBase + i + 1,
      lastName,
      firstName,
      role: ROLE_ORDER[i] as Role,
    });
  }
  return { name, code: teamCode(name), coach: rng.pick(COACHES), players };
}

interface TeamState {
  team: SimTeam;
  roles: Map<number, Role>;
  /** Jersey numbers P1..P6 (real players, the libero is applied only for display). */
  lineup: number[];
  bench: number[];
  subs: number;
  timeouts: number;
  libero: number | null;
  /** Substitute on court -> the player he replaced (on the bench): only he can come back, only for him. */
  pairs: Map<number, number>;
  /** Players who already came back or went out for good: no other substitution in the set. */
  locked: Set<number>;
}

function newTeamState(team: SimTeam, rng: Rng): TeamState {
  const roles = new Map(team.players.map((p) => [p.number, p.role]));
  const byRole = (role: Role): number[] => team.players.filter((p) => p.role === role).map((p) => p.number);
  const [s] = byRole('S');
  const [o] = byRole('O');
  const h = byRole('H');
  const m = byRole('M');
  const base = [s, h[0], m[0], o, h[1], m[1]] as number[];
  const turns = rng.int(0, 5);
  const lineup = [...base.slice(turns), ...base.slice(0, turns)];
  const libero = byRole('L')[0] ?? null;
  const bench = team.players.map((p) => p.number).filter((n) => !base.includes(n) && n !== libero);
  return { team, roles, lineup, bench, subs: 0, timeouts: 0, libero, pairs: new Map(), locked: new Set() };
}

const role = (ts: TeamState, n: number): Role => ts.roles.get(n) as Role;

function display(ts: TeamState): number[] {
  return ts.lineup.map((n, i) => ((i === 4 || i === 5) && ts.libero !== null && role(ts, n) === 'M' ? ts.libero : n));
}

function setterPos(ts: TeamState): number {
  return ts.lineup.findIndex((n) => role(ts, n) === 'S') + 1;
}

function rotate(ts: TeamState): void {
  const l = ts.lineup;
  ts.lineup = [l[1], l[2], l[3], l[4], l[5], l[0]] as number[];
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

type Weights = ReadonlyArray<readonly [string, number]>;

/** Reception after a serve in play (an ace is `#` on the serve and `=` on the reception, never here). */
const RECEPTION_AFTER: Record<string, Weights> = {
  '+': [
    ['#', 0.14],
    ['+', 0.32],
    ['!', 0.28],
    ['-', 0.2],
    ['/', 0.06],
  ],
  '!': [
    ['#', 0.24],
    ['+', 0.38],
    ['!', 0.22],
    ['-', 0.13],
    ['/', 0.03],
  ],
  '-': [
    ['#', 0.34],
    ['+', 0.4],
    ['!', 0.17],
    ['-', 0.09],
  ],
  '/': [
    ['#', 0.1],
    ['+', 0.3],
    ['!', 0.3],
    ['-', 0.3],
  ],
};

/** Kill probability of an attack by the quality of the ball before it (reception or dig), teams on a par. */
const KILL_BY_QUALITY: Record<string, number> = { '#': 0.56, '+': 0.52, '!': 0.43, '-': 0.32, '/': 0.25 };
/** Serves of a team in a set, on average (a set of about 46 rallies): turns the targets per set into rates. */
const SERVES_PER_SET = 22.5;
/** Attacks of a team in a set, on average: turns the block points per set into a rate. */
const ATTACKS_PER_SET = 28;
/** Kill probability added to the stronger team at 100 (and taken from the other one). */
const STRENGTH_EDGE = 0.12;
/** Largest change of level of a team from set to set, and within a set, at variability 100. */
const SET_FORM = 0.1;
const SPELL_FORM = 0.05;
/** Points between two changes of level within a set. */
const SPELL_POINTS = 6;

/** Count of events in a set: binomial on `max` tries, so its mean is `mean` and it never goes over `max`. */
function plannedCount(rng: Rng, mean: number, max: number): number {
  let n = 0;
  for (let i = 0; i < max; i++) if (rng.chance(mean / max)) n++;
  return n;
}

/** Sorted points of the set (total of both teams) after which the planned events are called. */
function plannedAt(rng: Rng, count: number, from: number, to: number): number[] {
  return Array.from({ length: count }, () => rng.int(from, to)).sort((a, b) => a - b);
}

class SetPlayer {
  readonly lines: ScoutLine[] = [];
  readonly score: [number, number] = [0, 0];
  second: number;
  private server = 0;
  private readonly form: [number, number];
  private spell: [number, number] = [0, 0];
  private readonly subsAt: [number[], number[]];
  private readonly timeoutsAt: [number[], number[]];
  private readonly aceRate: number;
  private readonly serveErrorRate: number;
  private readonly blockRate: number;

  constructor(
    private readonly rng: Rng,
    private readonly teams: [TeamState, TeamState],
    private readonly setNo: number,
    private readonly target: number,
    private readonly profile: MatchProfile,
    /** Extra kill probability per team (only after many sets not won by the team wanted). */
    private readonly bias: [number, number],
    startSecond: number,
  ) {
    this.second = startSecond;
    const v = profile.variability / 100;
    this.form = [(rng.next() * 2 - 1) * SET_FORM * v, (rng.next() * 2 - 1) * SET_FORM * v];
    const scale = target / 25;
    const at = (from: number, to: number) => [Math.round(from * scale), Math.round(to * scale)] as const;
    const [subFrom, subTo] = at(6, 40);
    const [toFrom, toTo] = at(5, 34);
    const subs = () => plannedAt(rng, plannedCount(rng, profile.substitutionsPerSet, 6), subFrom, subTo);
    const timeouts = () => plannedAt(rng, plannedCount(rng, profile.timeoutsPerSet, 2), toFrom, toTo);
    this.subsAt = [subs(), subs()];
    this.timeoutsAt = [timeouts(), timeouts()];
    this.aceRate = profile.acesPerSet / SERVES_PER_SET;
    this.serveErrorRate = profile.serveErrorsPerSet / SERVES_PER_SET;
    const sum = this.aceRate + this.serveErrorRate;
    if (sum > 0.8) {
      this.aceRate *= 0.8 / sum;
      this.serveErrorRate *= 0.8 / sum;
    }
    this.blockRate = Math.min(0.4, profile.blocksPerSet / ATTACKS_PER_SET);
  }

  /** Level of team `t` now: strength, form of the set, spell within the set (kill probability added). */
  private edge(t: number): number {
    const strength = ((this.profile.homeStrength - 50) / 50) * STRENGTH_EDGE;
    return (t === 0 ? strength : -strength) + (this.form[t] ?? 0) + (this.spell[t] ?? 0) + (this.bias[t] ?? 0);
  }

  private emit(kind: LineKind, code: string, score?: [number, number]): void {
    const [h, a] = this.teams;
    const line: ScoutLine = {
      kind,
      code,
      set: this.setNo,
      second: this.second,
      rotHome: setterPos(h),
      rotAway: setterPos(a),
      positions: [...display(h), ...display(a)],
    };
    if (score) line.score = score;
    if (kind === 'action') line.phase = (code.startsWith('*') ? 0 : 1) === this.server ? 's' : 'r';
    this.lines.push(line);
  }

  private prefix(t: number): string {
    return t === 0 ? '*' : 'a';
  }

  private action(t: number, player: number, skill: string, type: string, evalCh: string, ext = ''): void {
    this.second += this.rng.int(2, 5);
    this.emit('action', `${this.prefix(t)}${pad2(player)}${skill}${type}${evalCh}${ext}`);
  }

  private actor(t: number, pick: (n: number, pos: number) => number): number {
    const ts = this.teams[t] as TeamState;
    const court = display(ts);
    const entries = court.map((n, i) => [n, pick(n, i + 1)] as const).filter(([, w]) => w > 0);
    return this.rng.weighted(entries);
  }

  private roleOf(t: number, n: number): Role {
    return role(this.teams[t] as TeamState, n);
  }

  private blocker(t: number): number {
    return this.actor(t, (n, p) => (p >= 2 && p <= 4 && this.roleOf(t, n) !== 'L' ? 1 : 0));
  }

  /** Plays the rally; returns the winning team index. */
  private rally(server: number): number {
    const rng = this.rng;
    this.server = server;
    const recv = 1 - server;
    const serverNum = display(this.teams[server] as TeamState)[0] as number;
    const u = rng.next();
    const serveEval =
      u < this.aceRate
        ? '#'
        : u < this.aceRate + this.serveErrorRate
          ? '='
          : rng.weighted([
              ['+', 0.2],
              ['!', 0.35],
              ['-', 0.3],
              ['/', 0.15],
            ]);
    const type = rng.pick(['H', 'M', 'Q']);
    this.action(server, serverNum, 'S', type, serveEval, `~~~1${rng.int(1, 9)}${rng.pick(['A', 'B', 'C', 'D'])}`);
    if (serveEval === '=') return recv;

    const receiverNum = this.actor(recv, (n) => ({ L: 3, H: 2, O: 0.5, M: 0.2, S: 0 })[this.roleOf(recv, n)]);
    if (serveEval === '#') {
      this.action(recv, receiverNum, 'R', 'H', '=');
      return server;
    }
    let quality = rng.weighted(RECEPTION_AFTER[serveEval] as Weights);
    this.action(recv, receiverNum, 'R', 'H', quality);

    let att = recv;
    for (let step = 0; ; step++) {
      const other = 1 - att;
      const ts = this.teams[att] as TeamState;
      const court = display(ts);
      const setter = court.find((n) => this.roleOf(att, n) === 'S') as number;
      const setEval = rng.weighted(
        quality === '#' || quality === '+'
          ? [
              ['#', 0.3],
              ['+', 0.5],
              ['!', 0.2],
            ]
          : quality === '!'
            ? [
                ['+', 0.4],
                ['!', 0.4],
                ['-', 0.2],
              ]
            : [
                ['!', 0.3],
                ['-', 0.7],
              ],
      );
      this.action(att, setter, 'E', 'H', setEval);

      const good = quality === '#' || quality === '+';
      const attacker = this.actor(att, (n, pos) => {
        const r = this.roleOf(att, n);
        const front = pos >= 2 && pos <= 4;
        if (r === 'S' || r === 'L') return 0;
        if (front) return r === 'M' ? (good ? 0.8 : 0.1) : r === 'O' ? 1.3 : 1;
        return r === 'M' ? 0 : 0.2;
      });
      const pos = display(ts).indexOf(attacker) + 1;
      const combo = pos === 3 ? rng.pick(['X1', 'X2']) : pos === 4 ? 'V5' : pos === 2 ? rng.pick(['V6', 'X7']) : 'PP';
      const attType = pos === 3 ? 'Q' : pos === 1 || pos >= 5 ? 'T' : rng.pick(['H', 'M']);
      const ext = `${combo}~${pos}${rng.int(1, 9)}${rng.pick(['A', 'B', 'C', 'D'])}`;

      const edge = this.edge(att);
      const block = this.blockRate;
      const err = Math.max(0.02, 0.07 - edge / 2);
      const kill = Math.min(0.95 - block - err, Math.max(0.05, (KILL_BY_QUALITY[quality] as number) + edge));
      const x = rng.next();
      if (step >= 14 || x < kill) {
        this.action(att, attacker, 'A', attType, '#', ext);
        return att;
      }
      if (x < kill + err) {
        this.action(att, attacker, 'A', attType, '=', ext);
        return other;
      }
      if (x < kill + err + block) {
        this.action(att, attacker, 'A', attType, '/', ext);
        this.action(other, this.blocker(other), 'B', 'H', '#');
        return other;
      }
      this.action(att, attacker, 'A', attType, '+', ext);
      if (rng.chance(0.12)) this.action(other, this.blocker(other), 'B', 'H', '+');
      const digger = this.actor(
        other,
        (n, p) => ({ L: 3, H: 2, O: 1, M: 0.3, S: 0.5 })[this.roleOf(other, n)] * (p === 1 || p >= 5 ? 1 : 0.3),
      );
      quality = rng.weighted([
        ['+', 0.35],
        ['!', 0.3],
        ['-', 0.35],
      ]);
      this.action(other, digger, 'D', 'H', quality);
      att = other;
    }
  }

  /**
   * A substitution of team `t` (6 at most in a set): a substitute coming back out for the player he replaced, or a
   * player of the court replaced by one of the bench with the same role (the libero never).
   */
  private substitute(t: number): void {
    const ts = this.teams[t] as TeamState;
    if (ts.subs >= 6) return;
    const back = [...ts.pairs.entries()].filter(([sub]) => ts.lineup.includes(sub));
    let out: number;
    let inn: number;
    if (back.length > 0 && this.rng.chance(0.5)) {
      [out, inn] = this.rng.pick(back);
      ts.pairs.delete(out);
      ts.locked.add(out).add(inn);
    } else {
      const free = (n: number) => !ts.locked.has(n) && !ts.pairs.has(n) && ![...ts.pairs.values()].includes(n);
      const outs = ts.lineup.filter((n) => free(n) && role(ts, n) !== 'L');
      if (outs.length === 0) return;
      out = this.rng.pick(outs);
      const ins = ts.bench.filter((n) => free(n) && role(ts, n) === role(ts, out));
      if (ins.length === 0) return;
      inn = this.rng.pick(ins);
      ts.pairs.set(inn, out);
    }
    ts.lineup = ts.lineup.map((n) => (n === out ? inn : n));
    ts.bench = ts.bench.map((n) => (n === inn ? out : n));
    ts.subs++;
    this.emit('substitution', `${this.prefix(t)}c${pad2(out)}:${pad2(inn)}`);
  }

  /** Time-outs and substitutions planned for this moment of the set (a dead ball after the point). */
  private calls(winner: number, streak: number): void {
    const played = this.score[0] + this.score[1];
    const loser = 1 - winner;
    const lt = this.teams[loser] as TeamState;
    const next = this.timeoutsAt[loser]?.[0];
    // A time-out is called by the team that lost the point, during a run of the other team or a bit later anyway.
    if (next !== undefined && lt.timeouts < 2 && played >= next && (streak >= 2 || played >= next + 4)) {
      this.timeoutsAt[loser]?.shift();
      lt.timeouts++;
      this.second += 60;
      this.emit('timeout', `${this.prefix(loser)}T`);
    }
    for (const t of [0, 1]) {
      const at = this.subsAt[t] as number[];
      while (at.length > 0 && (at[0] as number) <= played) {
        at.shift();
        this.substitute(t);
      }
    }
  }

  /** Plays the set; returns the index of the winner. */
  run(firstServer: number): number {
    const [h, a] = this.teams;
    this.emit('setter', `*P${pad2(h.lineup.find((n) => role(h, n) === 'S') as number)}`);
    this.emit('setter', `aP${pad2(a.lineup.find((n) => role(a, n) === 'S') as number)}`);
    this.emit('rotation', `*z${setterPos(h)}`);
    this.emit('rotation', `az${setterPos(a)}`);
    const v = this.profile.variability / 100;
    let server = firstServer;
    const streak = [0, 0];
    for (;;) {
      const played = this.score[0] + this.score[1];
      if (played % SPELL_POINTS === 0) {
        this.spell = [(this.rng.next() * 2 - 1) * SPELL_FORM * v, (this.rng.next() * 2 - 1) * SPELL_FORM * v];
      }
      this.second += this.rng.int(15, 25);
      const winner = this.rally(server);
      this.score[winner] = (this.score[winner] as number) + 1;
      streak[winner] = (streak[winner] as number) + 1;
      streak[1 - winner] = 0;
      this.second += 1;
      this.emit('point', `${this.prefix(winner)}p${pad2(this.score[0])}:${pad2(this.score[1])}`, [
        this.score[0],
        this.score[1],
      ]);
      const ws = this.score[winner] ?? 0;
      const ls = this.score[1 - winner] ?? 0;
      if (ws >= this.target && ws - ls >= 2) {
        this.second += 2;
        this.emit('endset', `**${this.setNo}set`);
        return winner;
      }
      if (winner !== server) {
        rotate(this.teams[winner] as TeamState);
        this.emit('rotation', `${this.prefix(winner)}z${setterPos(this.teams[winner] as TeamState)}`);
        server = winner;
      }
      this.calls(winner, streak[winner] ?? 0);
    }
  }
}

/** Probability that the home team wins the match, from its strength (50: one in two). */
function homeWinChance(homeStrength: number): number {
  return 1 / (1 + Math.exp(-(homeStrength - 50) / 15));
}

/** Sets played again (with other rallies) before the team wanted gets a little help to win the set. */
const FREE_ATTEMPTS = 40;

/**
 * Generates a deterministic synthetic match. Same options, same result. The number of sets is chosen (`sets`); the
 * winner of the match comes from the strength of the teams, and each set is played rally by rally until it is won by
 * the team it has to go to (so its score stays the one of a real set).
 */
export function generateMatch(options: GenerateOptions): GeneratedMatch {
  const rng = new Rng(options.seed);
  const totalSets = options.sets ?? 3;
  const profile = resolveProfile(options.profile);
  const home = makeTeam(rng, options.homeName ?? DEFAULT_HOME_NAME, 1000);
  const away = makeTeam(rng, options.awayName ?? DEFAULT_AWAY_NAME, 2000);
  const startTime = options.startTime ?? DEFAULT_START_TIME;

  const matchWinner = rng.chance(homeWinChance(profile.homeStrength)) ? 0 : 1;
  const loserWins = totalSets - 3;
  const loserSets = new Set(rng.shuffle(Array.from({ length: totalSets - 1 }, (_, i) => i)).slice(0, loserWins));

  const sets: SimSet[] = [];
  const lines: ScoutLine[] = [];
  let second = 20;
  let firstServer = rng.int(0, 1);
  for (let i = 0; i < totalSets; i++) {
    const setNo = i + 1;
    const wanted = loserSets.has(i) ? 1 - matchWinner : matchWinner;
    const target = totalSets === 5 && setNo === 5 ? 15 : 25;
    for (let attempt = 0; ; attempt++) {
      const bias: [number, number] = [0, 0];
      bias[wanted] = Math.max(0, attempt - FREE_ATTEMPTS) * 0.01;
      const s: [TeamState, TeamState] = [newTeamState(home, rng), newTeamState(away, rng)];
      const player = new SetPlayer(rng, s, setNo, target, profile, bias, second);
      const winner = player.run(firstServer);
      if (winner === wanted) {
        lines.push(...player.lines);
        sets.push({
          number: setNo,
          home: player.score[0],
          away: player.score[1],
          startHome: (player.lines[0]?.positions ?? []).slice(0, 6),
          startAway: (player.lines[0]?.positions ?? []).slice(6),
        });
        second = player.second + 300;
        break;
      }
    }
    firstServer = 1 - firstServer;
  }
  return { seed: options.seed, startTime, home, away, sets, lines };
}
