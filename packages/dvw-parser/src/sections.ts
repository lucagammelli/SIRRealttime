import type { MatchInfo, PlayerInfo, PlayerRole, SetInfo, TeamInfo } from './types.js';

const HEADER = /^\[3([A-Z0-9-]+)\]\s*$/;

export function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
}

/** Divide il testo in sezioni `[3NOME]`: nome → righe (senza l'intestazione). */
export function splitSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of splitLines(text)) {
    const m = HEADER.exec(line.trim());
    if (m?.[1]) {
      current = sections.get(m[1]) ?? [];
      sections.set(m[1], current);
    } else if (current) {
      current.push(line);
    }
  }
  return sections;
}

const nonEmpty = (lines: string[]): string[] => lines.filter((l) => l.trim() !== '');
const clean = (v: string | undefined): string | undefined =>
  v === undefined || v.trim() === '' ? undefined : v.trim();
const int = (v: string | undefined): number | undefined => {
  const s = clean(v);
  return s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined;
};

/** Righe grezze (non vuote) della sezione [3SCOUT]. */
export function scoutLinesOf(sections: Map<string, string[]>): string[] {
  return nonEmpty(sections.get('SCOUT') ?? []);
}

export function parseMatch(lines: string[]): MatchInfo {
  const f = (nonEmpty(lines)[0] ?? '').split(';');
  return { date: clean(f[0]), time: clean(f[1]), season: clean(f[2]), league: clean(f[3]), extra: f.slice(4) };
}

export function parseTeams(lines: string[]): TeamInfo[] {
  return nonEmpty(lines)
    .slice(0, 2)
    .map((l) => {
      const f = l.split(';');
      return { code: clean(f[0]), name: clean(f[1]), setsWon: int(f[2]), coach: clean(f[3]), extra: f.slice(4) };
    });
}

const ROLES = new Map<string, PlayerRole>([
  ['1', 'libero'],
  ['2', 'outside'],
  ['3', 'opposite'],
  ['4', 'middle'],
  ['5', 'setter'],
]);

export function parsePlayers(lines: string[]): PlayerInfo[] {
  // DV4: squadra;maglia;indice;posizioni set 1-5;id;cognome;nome;soprannome;ruolo speciale;ruolo;...
  return nonEmpty(lines).map((l) => {
    const f = l.split(';');
    const roleCode = clean(f[13]);
    return {
      teamIndex: int(f[0]),
      number: int(f[1]),
      index: int(f[2]),
      startPositions: [3, 4, 5, 6, 7].map((i) => int(f[i])),
      id: clean(f[8]),
      lastName: clean(f[9]),
      firstName: clean(f[10]),
      nickname: clean(f[11]),
      specialRole: clean(f[12]),
      roleCode,
      role: roleCode ? ROLES.get(roleCode) : undefined,
      extra: f.slice(14).filter((x) => x.trim() !== ''),
    };
  });
}

const SCORE = /^(\d+)-(\d+)$/;

export function parseSets(lines: string[]): SetInfo[] {
  // Riga: True|False;parziale1;parziale2;parziale3;finale;minuti;  (celle vuote = non giocato)
  return nonEmpty(lines).map((l, i) => {
    const f = l.split(';').map((x) => x.trim());
    const flag = f[0]?.toLowerCase();
    const finished = flag === 'true' ? true : flag === 'false' ? false : undefined;
    const cells = (finished === undefined ? f : f.slice(1)).filter((x) => x !== '');
    const scores = cells.filter((x) => SCORE.test(x));
    const others = cells.filter((x) => !SCORE.test(x));
    const minutes =
      others.length > 0 && /^\d+$/.test(others[others.length - 1] ?? '') ? Number(others.pop()) : undefined;
    const final = scores.length > 1 || finished ? scores[scores.length - 1] : undefined;
    const m = final ? SCORE.exec(final) : null;
    return {
      number: i + 1,
      partials: final ? scores.slice(0, -1) : scores,
      finalScore: final,
      minutes,
      finished,
      homeScore: m ? Number(m[1]) : undefined,
      awayScore: m ? Number(m[2]) : undefined,
      extra: others,
    };
  });
}
