import type { Ratio, Side } from './types.js';

export const SIDES: readonly Side[] = ['home', 'away'];

export const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

export const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Rapporto arrotondato a 3 decimali; `null` se il denominatore è 0. */
export function ratio(num: number, den: number): Ratio {
  return den === 0 ? null : round3(num / den);
}

/** `HH.MM.SS` → secondi dalla mezzanotte, `undefined` se non valido. */
export function timeToSeconds(t: string | undefined): number | undefined {
  const m = /^(\d{1,2})[.:](\d{2})[.:](\d{2})$/.exec(t ?? '');
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
