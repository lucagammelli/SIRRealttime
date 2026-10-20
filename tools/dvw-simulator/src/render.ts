import iconv from 'iconv-lite';
import type { GeneratedMatch, ScoutLine, SimTeam } from './types.js';

export interface RenderOptions {
  encoding?: 'win1252' | 'utf8';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function clock(startTime: string, second: number): { date: string; time: string } {
  const d = new Date(Date.parse(startTime) + second * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    time: `${pad2(d.getUTCHours())}.${pad2(d.getUTCMinutes())}.${pad2(d.getUTCSeconds())}`,
  };
}

const pad4 = (n: number): string => String(n % 10000).padStart(4, '0');

/** Plausible (deterministic) 4-digit coordinates for serves and attacks; empty otherwise. */
function coordinates(line: ScoutLine): [string, string, string] {
  if (line.kind !== 'action' || !/^.\d\d[SA]/.test(line.code)) return ['', '', ''];
  const s = line.second;
  return [pad4(((s * 37) % 100) * 100 + ((s * 11) % 100)), '', pad4(((s * 53) % 100) * 100 + ((s * 29) % 100))];
}

/**
 * Text of a [3SCOUT] row in DataVolley 4 layout (0 = code): 1 point phase, 2 attack phase, 3 flag,
 * 4-6 start/mid/end coordinates, 7 time, 8 set, 9-10 setter positions, 11 video file, 12 video time,
 * 13 empty, 14-19 home players P1-P6, 20-25 away players P1-P6.
 */
export function scoutLineText(match: GeneratedMatch, line: ScoutLine): string {
  const { time } = clock(match.startTime, line.second);
  const [start, mid, end] = coordinates(line);
  return [
    line.code,
    line.phase ?? '',
    '',
    '',
    start,
    mid,
    end,
    time,
    line.set,
    line.rotHome,
    line.rotAway,
    1,
    line.second,
    '',
    ...line.positions,
    '',
  ].join(';');
}

function setRows(lines: ScoutLine[], setCount: number): { rows: string[]; won: [number, number] } {
  const rows: string[] = [];
  const won: [number, number] = [0, 0];
  for (let n = 1; n <= setCount; n++) {
    const inSet = lines.filter((l) => l.set === n);
    if (inSet.length === 0) {
      rows.push(';;;;;;');
      continue;
    }
    const finished = inSet.some((l) => l.kind === 'endset');
    const thresholds = n === 5 ? [5, 10, 12] : [8, 16, 21];
    const points = inSet.filter((l) => l.kind === 'point' && l.score);
    const partials = thresholds.map((t) => {
      const p = points.find((l) => Math.max(...(l.score as [number, number])) === t);
      return p?.score ? `${p.score[0]}-${p.score[1]}` : '';
    });
    const last = points[points.length - 1]?.score;
    const final = finished && last ? `${last[0]}-${last[1]}` : '';
    if (finished && last) won[last[0] > last[1] ? 0 : 1]++;
    const first = inSet[0] as ScoutLine;
    const end = inSet[inSet.length - 1] as ScoutLine;
    const minutes = Math.ceil((end.second - first.second) / 60);
    rows.push(`${finished ? 'True' : 'False'};${[...partials, final].join(';')};${minutes};`);
  }
  return { rows, won };
}

const ROLE_CODE: Record<string, string> = { L: '1', H: '2', O: '3', M: '4', S: '5' };

/** [3PLAYERS-*] rows, DV4: team;number;index;start positions set 1-5 (`*` = bench);id;last;first;nick;special role;role;;. */
function playerRows(match: GeneratedMatch, side: 0 | 1): string[] {
  const team = side === 0 ? match.home : match.away;
  return team.players.map((p, i) => {
    const starts = match.sets.map((s) => {
      const idx = (side === 0 ? s.startHome : s.startAway).indexOf(p.number);
      return idx >= 0 ? String(idx + 1) : '*';
    });
    while (starts.length < 5) starts.push('*');
    return [
      side,
      p.number,
      i + 1,
      ...starts.slice(0, 5),
      p.id,
      p.lastName,
      p.firstName,
      '',
      p.role === 'L' ? 'L' : '',
      ROLE_CODE[p.role],
      '',
      '',
    ].join(';');
  });
}

function teamRow(team: SimTeam, won: number): string {
  return `${team.code};${team.name};${won};${team.coach};;`;
}

const COMBINATIONS = [
  'X1;3;Q;Primo tempo',
  'X2;3;Q;Primo tempo dietro',
  'X7;2;Q;Slide',
  'V5;4;H;Alta ala sinistra',
  'V6;2;H;Alta ala destra',
  'PP;6;T;Pipe',
];
const SETTER_CALLS = ['K1;Primo tempo', 'K2;Alzata alta', 'K3;Pipe'];

/**
 * Renders the whole .dvw file as DataVolley would write it when `upToLine` scout rows exist.
 * Sets, partials and sets won are derived from those rows only.
 */
export function renderDvw(match: GeneratedMatch, upToLine: number, options: RenderOptions = {}): Uint8Array {
  const lines = match.lines.slice(0, Math.max(0, upToLine));
  const { date, time } = clock(match.startTime, 0);
  const { rows: sets, won } = setRows(lines, 5);
  const out: string[] = [
    '[3DATAVOLLEYSCOUT]',
    'FILEFORMAT: 2.0',
    `GENERATOR-DAY: ${date} ${time.replaceAll('.', ':')}`,
    'GENERATOR-PRG: ArenaLive dvw-simulator',
    '',
    '[3MATCH]',
    `${date};${time};2024/25;Campionato Serie C;Girone A;;;;`,
    '',
    '[3TEAMS]',
    teamRow(match.home, won[0]),
    teamRow(match.away, won[1]),
    '',
    '[3MORE]',
    'Arbitro Uno;Arbitro Due;Città Alta;Palazzetto dello Sport;',
    '',
    '[3SET]',
    ...sets,
    '',
    '[3PLAYERS-H]',
    ...playerRows(match, 0),
    '',
    '[3PLAYERS-V]',
    ...playerRows(match, 1),
    '',
    '[3ATTACKCOMBINATION]',
    ...COMBINATIONS,
    '',
    '[3SETTERCALL]',
    ...SETTER_CALLS,
    '',
    '[3SCOUT]',
    ...lines.map((l) => scoutLineText(match, l)),
  ];
  const text = `${out.join('\r\n')}\r\n`;
  if (options.encoding === 'utf8') return new Uint8Array(Buffer.from(text, 'utf8'));
  return new Uint8Array(iconv.encode(text, 'win1252'));
}
