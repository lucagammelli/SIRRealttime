import { COACHES, FIRST_NAMES, LAST_NAMES } from './names.js';
import { Rng } from './rng.js';
import type {
  GenerateOptions,
  GeneratedMatch,
  LineKind,
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
  return { team, roles, lineup, bench, subs: 0, timeouts: 0, libero };
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

const EVAL_AFTER: Record<string, ReadonlyArray<readonly [string, number]>> = {
  '+': [
    ['#', 0.12],
    ['+', 0.3],
    ['!', 0.25],
    ['-', 0.23],
    ['=', 0.1],
  ],
  '!': [
    ['#', 0.22],
    ['+', 0.38],
    ['!', 0.2],
    ['-', 0.14],
    ['=', 0.06],
  ],
  '-': [
    ['#', 0.3],
    ['+', 0.4],
    ['!', 0.18],
    ['-', 0.1],
    ['=', 0.02],
  ],
  '/': [
    ['+', 0.15],
    ['!', 0.25],
    ['-', 0.3],
    ['=', 0.3],
  ],
};

const KILL_BY_QUALITY: Record<string, number> = { '#': 0.55, '+': 0.5, '!': 0.4, '-': 0.28, '/': 0.2 };

class SetPlayer {
  readonly lines: ScoutLine[] = [];
  readonly score: [number, number] = [0, 0];
  second: number;
  private server = 0;

  constructor(
    private readonly rng: Rng,
    private readonly teams: [TeamState, TeamState],
    private readonly setNo: number,
    private readonly target: number,
    private readonly bias: [number, number],
    startSecond: number,
  ) {
    this.second = startSecond;
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

  /** Plays the rally; returns the winning team index. */
  private rally(server: number): number {
    const rng = this.rng;
    this.server = server;
    const recv = 1 - server;
    const serverNum = display(this.teams[server] as TeamState)[0] as number;
    const u = rng.next();
    const serveEval =
      u < 0.07
        ? '#'
        : u < 0.16
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
    let quality = rng.weighted(EVAL_AFTER[serveEval] as ReadonlyArray<readonly [string, number]>);
    this.action(recv, receiverNum, 'R', 'H', quality);
    if (quality === '=') return server;

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
      const startZone = pos === 1 ? 1 : pos === 2 ? 2 : pos === 3 ? 3 : pos === 4 ? 4 : pos === 5 ? 5 : 6;
      const combo = pos === 3 ? rng.pick(['X1', 'X2']) : pos === 4 ? 'V5' : pos === 2 ? rng.pick(['V6', 'X7']) : 'PP';
      const attType = pos === 3 ? 'Q' : pos === 1 || pos >= 5 ? 'T' : rng.pick(['H', 'M']);
      const ext = `${combo}~${startZone}${rng.int(1, 9)}${rng.pick(['A', 'B', 'C', 'D'])}`;

      const bias = this.bias[att] as number;
      const kill = (KILL_BY_QUALITY[quality] as number) + bias;
      const err = Math.max(0.02, 0.07 - bias / 2);
      const block = 0.1;
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
        const blocker = this.actor(other, (n, p) => (p >= 2 && p <= 4 && this.roleOf(other, n) !== 'L' ? 1 : 0));
        this.action(other, blocker, 'B', 'H', '#');
        return other;
      }
      this.action(att, attacker, 'A', attType, '+', ext);
      if (rng.chance(0.12)) {
        const blocker = this.actor(other, (n, p) => (p >= 2 && p <= 4 && this.roleOf(other, n) !== 'L' ? 1 : 0));
        this.action(other, blocker, 'B', 'H', '+');
      }
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

  private maybeSubstitute(t: number): void {
    const ts = this.teams[t] as TeamState;
    if (ts.subs >= 4 || !this.rng.chance(0.03)) return;
    const candidates = ts.lineup.filter((n) => role(ts, n) !== 'S');
    const out = this.rng.pick(candidates);
    const ins = ts.bench.filter((n) => role(ts, n) === role(ts, out));
    if (ins.length === 0) return;
    const inn = this.rng.pick(ins);
    ts.lineup = ts.lineup.map((n) => (n === out ? inn : n));
    ts.bench = ts.bench.map((n) => (n === inn ? out : n));
    ts.subs++;
    this.emit('substitution', `${this.prefix(t)}c${pad2(out)}:${pad2(inn)}`);
  }

  /** Plays the set; returns the index of the winner. */
  run(firstServer: number): number {
    const [h, a] = this.teams;
    this.emit('setter', `*P${pad2(h.lineup.find((n) => role(h, n) === 'S') as number)}`);
    this.emit('setter', `aP${pad2(a.lineup.find((n) => role(a, n) === 'S') as number)}`);
    this.emit('rotation', `*z${setterPos(h)}`);
    this.emit('rotation', `az${setterPos(a)}`);
    let server = firstServer;
    const streak = [0, 0];
    for (;;) {
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
      const loser = 1 - winner;
      const lt = this.teams[loser] as TeamState;
      if ((streak[winner] ?? 0) >= 3 && lt.timeouts < 2 && this.rng.chance(0.3)) {
        lt.timeouts++;
        this.second += 60;
        this.emit('timeout', `${this.prefix(loser)}T`);
      }
      this.maybeSubstitute(0);
      this.maybeSubstitute(1);
    }
  }
}

/** Generates a deterministic synthetic match. Same options, same result. */
export function generateMatch(options: GenerateOptions): GeneratedMatch {
  const rng = new Rng(options.seed);
  const totalSets = options.sets ?? 3;
  const home = makeTeam(rng, options.homeName ?? DEFAULT_HOME_NAME, 1000);
  const away = makeTeam(rng, options.awayName ?? DEFAULT_AWAY_NAME, 2000);
  const startTime = options.startTime ?? DEFAULT_START_TIME;

  const matchWinner = rng.int(0, 1);
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
    let attempt = 0;
    for (;;) {
      const bias: [number, number] = [0, 0];
      bias[wanted] = 0.06 + 0.02 * attempt;
      const s: [TeamState, TeamState] = [newTeamState(home, rng), newTeamState(away, rng)];
      const player = new SetPlayer(rng, s, setNo, target, bias, second);
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
      attempt++;
    }
    firstServer = 1 - firstServer;
  }
  return { seed: options.seed, startTime, home, away, sets, lines };
}
