import type { Evaluation, HitType, ScoutEntry, ScoutFields, Side, Skill } from './types.js';

const SKILLS: Record<string, Skill> = {
  S: 'serve',
  R: 'reception',
  A: 'attack',
  B: 'block',
  D: 'dig',
  E: 'set',
  F: 'freeball',
};
const HIT_TYPES = 'HMQTUNO';
const EVALUATIONS = '#+!-/=';

const side = (c: string | undefined): Side | undefined => (c === '*' ? 'home' : c === 'a' ? 'away' : undefined);
const opt = (c: string | undefined): string | undefined => (c === undefined || c === '' || c === '~' ? undefined : c);
const num = (v: string | undefined): number | undefined => {
  const s = v?.trim();
  return s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined;
};

function lineup(fields: string[], from: number): (number | undefined)[] {
  return Array.from({ length: 6 }, (_, i) => num(fields[from + i]));
}

/** `fields[0]` = codice, come negli indici DV4. */
function parseFields(fields: string[]): ScoutFields {
  const txt = (i: number): string | undefined => opt(fields[i]?.trim());
  return {
    pointPhase: txt(1),
    attackPhase: txt(2),
    flag3: txt(3),
    startCoordinate: txt(4),
    midCoordinate: txt(5),
    endCoordinate: txt(6),
    time: txt(7),
    set: num(fields[8]),
    homeSetterPosition: num(fields[9]),
    awaySetterPosition: num(fields[10]),
    videoFile: num(fields[11]),
    videoTime: num(fields[12]),
    homeLineup: lineup(fields, 14),
    awayLineup: lineup(fields, 20),
  };
}

/** Interpreta una riga scout. Non lancia mai: righe non riconosciute → `unknown` + avviso. */
export function parseScoutLine(rawLine: string, index: number, warnings: string[]): ScoutEntry {
  const parts = rawLine.split(';');
  const code = (parts[0] ?? '').trim();
  const gt = code.indexOf('>');
  const suffix = gt >= 0 ? code.slice(gt) : undefined;
  const base = { index, rawLine, code, ...(suffix ? { suffix } : {}), ...parseFields(parts) };
  const team = side(code[0]);
  const rest = (gt >= 0 ? code.slice(0, gt) : code).slice(1);
  const bare = gt >= 0 ? code.slice(0, gt) : code;

  const unknown = (): ScoutEntry => {
    warnings.push(`SCOUT riga ${index}: codice non riconosciuto "${code}"`);
    return team ? { ...base, kind: 'unknown', team } : { ...base, kind: 'unknown' };
  };

  if (code.startsWith('**')) {
    const m = /^\*\*(\d+)set$/i.exec(bare);
    return m ? { ...base, kind: 'setEnd', setNumber: Number(m[1]) } : unknown();
  }
  if (!team) return unknown();

  let m: RegExpExecArray | null;
  if ((m = /^\$\$(.)(.*)$/.exec(rest))) {
    return { ...base, kind: 'greenCode', team, symbol: m[1] ?? '', detail: m[2] ?? '' };
  }
  if ((m = /^p(\d+):(\d+)$/.exec(rest))) {
    return { ...base, kind: 'point', team, homeScore: Number(m[1]), awayScore: Number(m[2]) };
  }
  if ((m = /^z(\d+)$/.exec(rest))) return { ...base, kind: 'rotation', team, number: Number(m[1]) };
  if ((m = /^c(\d+):(\d+)$/.exec(rest))) {
    return { ...base, kind: 'substitution', team, out: Number(m[1]), in: Number(m[2]) };
  }
  if (rest === 'T') return { ...base, kind: 'timeout', team };
  if ((m = /^P(\d+)$/.exec(rest))) return { ...base, kind: 'setter', team, number: Number(m[1]) };

  if ((m = /^(\d{2})([SRABDEF])(.*)$/.exec(rest))) {
    const skill = SKILLS[m[2] ?? ''];
    const tail = m[3] ?? '';
    if (!skill) return unknown();
    const hit = tail[0];
    const ev = tail[1];
    const entry: ScoutEntry = { ...base, kind: 'action', team, player: Number(m[1]), skill };
    if (hit && hit !== '~' && HIT_TYPES.includes(hit)) entry.hitType = hit as HitType;
    else if (hit && hit !== '~') warnings.push(`SCOUT riga ${index}: tipo "${hit}" non valido`);
    if (ev && ev !== '~' && EVALUATIONS.includes(ev)) entry.evaluation = ev as Evaluation;
    else if (ev && ev !== '~') warnings.push(`SCOUT riga ${index}: valutazione "${ev}" non valida`);
    const comb = tail.slice(2, 4);
    if (comb !== '' && comb !== '~~') entry.combination = comb;
    const set = <K extends 'setTarget' | 'startZone' | 'endZone' | 'endSubZone' | 'skillType' | 'playersCount'>(
      k: K,
      c: string | undefined,
    ) => {
      const v = opt(c);
      if (v) entry[k] = v;
    };
    set('setTarget', tail[4]);
    set('startZone', tail[5]);
    set('endZone', tail[6]);
    set('endSubZone', tail[7]);
    set('skillType', tail[8]);
    set('playersCount', tail[9]);
    const extra = tail.slice(10);
    if (extra !== '' && !/^~*$/.test(extra)) entry.extra = extra;
    return entry;
  }
  return unknown();
}
