/**
 * Official times of the Italian leagues are written in Italian time (Europe/Rome, with summer time). Conversions
 * with Intl only (no time zone library). Pure functions.
 */

const ROME = 'Europe/Rome';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ROME,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface RomeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Pure: wall clock in Rome at an instant. */
export function romeParts(date: Date): RomeParts {
  const parts: Record<string, number> = {};
  for (const p of formatter.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Milliseconds Rome is ahead of UTC at an instant (3600000 in winter, 7200000 in summer). */
function offsetAt(ms: number): number {
  const p = romeParts(new Date(ms));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * Pure: instant of a wall clock time in Rome; null when the date does not exist (31/02, month 13). A time skipped by
 * the change to summer time (02:30 of the last Sunday of March) moves forward one hour; a repeated one (02:30 of the
 * last Sunday of October) is the second, in winter time.
 */
export function romeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  let utc = wall - offsetAt(wall);
  const second = offsetAt(utc);
  if (second !== wall - utc) utc = wall - second;
  return new Date(utc);
}

/** Pure: day in Rome of an instant, `YYYY-MM-DD`. */
export function romeDateKey(date: Date): string {
  const p = romeParts(date);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Pure: instant of `hour:00` in Rome on the Rome day of `date`, and of the same hour the next day. */
export function romeDayAt(date: Date, hour: number): { at: Date; nextDay: Date } {
  const p = romeParts(date);
  const at = romeToUtc(p.year, p.month, p.day, hour, 0);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const nextDay = romeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, 0);
  if (!at || !nextDay) throw new Error('invalid Rome day');
  return { at, nextDay };
}
