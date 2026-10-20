import type { ParsedMatch, Side } from '@arenalive/dvw-parser';
import type { FixtureCandidate } from '@arenalive/shared';
import { romeParts } from './romeTime.js';

/**
 * Link of a `.dvw` to the match of the calendar of the club (pure functions): same day in Italy (one day of tolerance
 * when the time is missing or near midnight), and both teams recognized by name. The names of DataVolley and of the
 * league often differ in the sponsors («Sir Susa Scai Perugia_Amichevoli» against «Sir Safety Perugia»): they are
 * compared by words, without case, accents, punctuation and suffixes, and the city of the team counts the most.
 */

export interface DvwDay {
  year: number;
  month: number;
  day: number;
}

export interface DvwFacts {
  /** Date of `[3MATCH]`, null when missing or not readable. */
  date: DvwDay | null;
  /** Time of `[3MATCH]`, otherwise of the first scout line; null when none. */
  time: { hour: number; minute: number } | null;
  teams: Record<Side, { name: string | null; code: string | null }>;
  /** Side of the club in the file when known (the «nostra squadra» of the graphics); null: try both. */
  ourSide: Side | null;
}

/** A match of the club in the calendar. */
export interface CalendarCandidate {
  id: string;
  startsAt: Date | null;
  /** Side of the club in the official match. */
  ourSide: Side;
  homeName: string;
  awayName: string;
  homeCity: string | null;
  awayCity: string | null;
}

export type LinkOutcome =
  | { kind: 'linked'; clientFixtureId: string; candidates: FixtureCandidate[] }
  | { kind: 'pending'; candidates: FixtureCandidate[] };

/** A candidate this good, and clearly better than the second, is linked without asking. */
export const AUTO_LINK_MIN_SCORE = 0.55;
export const AUTO_LINK_MARGIN = 0.2;
/** Candidates below this are not even proposed. */
export const CANDIDATE_MIN_SCORE = 0.25;
export const MAX_CANDIDATES = 5;
/** Matches starting this close to midnight (hours) may be written in the `.dvw` with the day before or after. */
export const NEAR_MIDNIGHT_HOURS = 2;
/** A match of the day before or after counts a little less than one of the same day. */
export const NEXT_DAY_PENALTY = 0.1;

/** Words that say nothing about the team (and the suffixes DataVolley users add, e.g. «_Amichevoli»). */
const STOPWORDS = new Set([
  'volley',
  'volleyball',
  'pallavolo',
  'club',
  'team',
  'sport',
  'sporting',
  'asd',
  'ssd',
  'srl',
  'spa',
  'ac',
  'as',
  'us',
  'sc',
  'pv',
  'vb',
  'di',
  'de',
  'del',
  'della',
  'la',
  'le',
  'il',
  'lo',
  'and',
  'the',
  'amichevole',
  'amichevoli',
  'friendly',
]);

/** Pure: comparable words of a team name: lower case, no accents and punctuation, text after `_` dropped. */
export function nameTokens(name: string): string[] {
  const base = name.split('_')[0]?.trim() || name;
  return base
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Pure: words of a city as the league writes it («Prata di Pordenone (PN)» → prata, pordenone). */
export function cityTokens(city: string | null): string[] {
  return city ? nameTokens(city.replace(/\([^)]*\)/g, ' ')) : [];
}

/** Same word, or one the beginning of the other when both are long enough («trento», «trentino»). */
const sameWord = (a: string, b: string): boolean =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Pure: similarity (0-1) of a team name of the `.dvw` with the official name of a team: share of common words, raised
 * when the most distinctive word (the city, otherwise the last word of the official name) is in the `.dvw` name.
 */
export function teamNameScore(dvwName: string | null, officialName: string, city: string | null): number {
  if (!dvwName) return 0;
  const a = nameTokens(dvwName);
  const b = nameTokens(officialName);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  const common = b.filter((w) => a.some((x) => sameWord(x, w))).length;
  const dice = (2 * common) / (a.length + b.length);
  const last = b[b.length - 1];
  const distinctive = [...cityTokens(city), ...(last ? [last] : [])];
  const cityHit = distinctive.some((d) => a.some((x) => sameWord(x, d)));
  return cityHit ? Math.min(1, 0.5 + dice / 2) : dice;
}

/** Pure: date as written in `[3MATCH]` (`dd/mm/yyyy`, also with `.` or `-`, or `yyyy-mm-dd`); null otherwise. */
export function parseDvwDate(text: string | undefined): DvwDay | null {
  const value = text?.trim() ?? '';
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  let parts: [number, number, number] | null = m ? [Number(m[3]), Number(m[2]), Number(m[1])] : null;
  if (!parts) {
    m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(value);
    parts = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }
  if (!parts) return null;
  const [year, month, day] = parts;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Pure: time `HH.MM`, `HH:MM` or `HH.MM.SS`; null otherwise. */
export function parseDvwTime(text: string | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})[.:](\d{2})(?:[.:]\d{2})?$/.exec(text?.trim() ?? '');
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Pure: what the link needs from a parsed `.dvw`. */
export function dvwFacts(parsed: ParsedMatch, ourSide: Side | null = null): DvwFacts {
  let time = parseDvwTime(parsed.match.time);
  for (let i = 0; time === null && i < parsed.scout.length; i++) time = parseDvwTime(parsed.scout[i]?.time);
  return {
    date: parseDvwDate(parsed.match.date),
    time,
    teams: {
      home: { name: parsed.home?.name ?? null, code: parsed.home?.code ?? null },
      away: { name: parsed.away?.name ?? null, code: parsed.away?.code ?? null },
    },
    ourSide,
  };
}

/** Pure: `YYYY-MM-DD` of a date of the `.dvw`. */
export const dvwDayKey = (d: DvwDay): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

const dayNumber = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day) / 86_400_000;

const nearMidnight = (hour: number, minute: number): boolean => {
  const minutes = hour * 60 + minute;
  return minutes < NEAR_MIDNIGHT_HOURS * 60 || minutes >= (24 - NEAR_MIDNIGHT_HOURS) * 60;
};

/** Pure: day distance accepted between the `.dvw` and a match of the calendar (null: not that match). */
function dayDistance(facts: DvwFacts, startsAt: Date): number | null {
  if (!facts.date) return 0;
  const rome = romeParts(startsAt);
  const diff = Math.abs(
    dayNumber(rome.year, rome.month, rome.day) - dayNumber(facts.date.year, facts.date.month, facts.date.day),
  );
  if (diff === 0) return 0;
  if (diff > 1) return null;
  const tolerant =
    facts.time === null || nearMidnight(facts.time.hour, facts.time.minute) || nearMidnight(rome.hour, rome.minute);
  return tolerant ? 1 : null;
}

const SIDES: readonly Side[] = ['home', 'away'];
const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

/** Pure: similarity of a `.dvw` with a match of the club (both teams must be recognized), 0-1. */
export function candidateScore(facts: DvwFacts, c: CalendarCandidate): number {
  const official = {
    our: c.ourSide === 'home' ? { name: c.homeName, city: c.homeCity } : { name: c.awayName, city: c.awayCity },
    opponent: c.ourSide === 'home' ? { name: c.awayName, city: c.awayCity } : { name: c.homeName, city: c.homeCity },
  };
  let best = 0;
  for (const ourDvwSide of facts.ourSide ? [facts.ourSide] : SIDES) {
    const our = teamNameScore(facts.teams[ourDvwSide].name, official.our.name, official.our.city);
    const opponent = teamNameScore(facts.teams[other(ourDvwSide)].name, official.opponent.name, official.opponent.city);
    best = Math.max(best, Math.min(our, opponent));
  }
  return best;
}

/**
 * Pure: the match of the calendar of a `.dvw`. Linked when exactly one candidate is good (at least
 * AUTO_LINK_MIN_SCORE, AUTO_LINK_MARGIN above the second) and the date of the file is known; otherwise `pending`
 * with the candidates to propose (possibly none: a friendly match).
 */
export function linkFixture(facts: DvwFacts, list: readonly CalendarCandidate[]): LinkOutcome {
  const scored: FixtureCandidate[] = [];
  for (const c of list) {
    if (!c.startsAt) continue;
    const distance = dayDistance(facts, c.startsAt);
    if (distance === null) continue;
    const score = Math.max(0, candidateScore(facts, c) - distance * NEXT_DAY_PENALTY);
    if (score >= CANDIDATE_MIN_SCORE) scored.push({ clientFixtureId: c.id, score: Math.round(score * 100) / 100 });
  }
  scored.sort((x, y) => y.score - x.score);
  const candidates = scored.slice(0, MAX_CANDIDATES);
  const [best, second] = candidates;
  if (
    facts.date &&
    best &&
    best.score >= AUTO_LINK_MIN_SCORE &&
    (!second || best.score - second.score >= AUTO_LINK_MARGIN)
  )
    return { kind: 'linked', clientFixtureId: best.clientFixtureId, candidates };
  return { kind: 'pending', candidates };
}
