import { romeParts } from '../leagues/romeTime.js';

/** Pure: day of an instant in Rome, `YYYY-MM-DD` (the unit of the daily totals). */
export function romeDay(date: Date): string {
  const p = romeParts(date);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Pure: `day` moved by `delta` days (calendar arithmetic on the string, no time zone involved). */
export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
