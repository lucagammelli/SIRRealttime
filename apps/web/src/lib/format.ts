import type { PlayerRef, Ratio, Side, TeamRef } from '@arenalive/volley-stats';

/** Shown for every missing value (`null`, ratio with zero denominator). */
export const DASH = '–';

const pctFormat = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

/** Ratio 0-1 → "48,3%" (×100, one decimal); `null` → "–". */
export function formatPct(ratio: Ratio | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return DASH;
  return `${pctFormat.format(ratio * 100)}%`;
}

/** Integer count; `null` → "–". */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return intFormat.format(n);
}

/** Ratio 0-1 → number 0-100 with one decimal (for chart values); `null` stays `null`. */
export function toPercent(ratio: Ratio | undefined): number | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  return Math.round(ratio * 1000) / 10;
}

/** Minutes → "1 h 05 min" / "23 min"; `null` → "–". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return DASH;
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export const SIDE_LABEL: Record<Side, string> = { home: 'Casa', away: 'Ospiti' };

/** Team name, or "Casa"/"Ospiti" when the file has none. */
export function teamName(teams: Record<Side, TeamRef>, side: Side): string {
  const t = teams[side];
  return t.name?.trim() || t.code?.trim() || SIDE_LABEL[side];
}

/** Short code for tight spaces (3 letters). */
export function teamShort(teams: Record<Side, TeamRef>, side: Side): string {
  const t = teams[side];
  const code = t.code?.trim();
  if (code) return code.slice(0, 4).toUpperCase();
  const name = teamName(teams, side);
  return (
    name
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, 3)
      .toUpperCase() || SIDE_LABEL[side].slice(0, 3).toUpperCase()
  );
}

/** Surname only («Rossi»); the first name if the surname is missing; "#12" if both are. */
export function playerName(player: PlayerRef | null | undefined, number: number): string {
  const last = player?.lastName?.trim();
  const first = player?.firstName?.trim();
  if (last) return last;
  if (first) return first;
  return `#${number}`;
}

/** Bytes in MB with at most one decimal, Italian style (`1,5`). */
export const megabytes = (bytes: number): string =>
  (bytes / (1024 * 1024)).toLocaleString('it-IT', { maximumFractionDigits: 1 });

/** ISO 8601 UTC → local date and time for display. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

const fixtureDate = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const fixtureTime = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });

const dayMonthYear = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Day of an ISO instant in Italian time, «16/10/2026»; `null` or not a date → «–». */
export function formatDay(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? dayMonthYear.format(d) : DASH;
}

/**
 * Official date and time of a match of the calendar, in Italian time like the league writes them: «dom 18 ott 2026»
 * and «18:00»; `null` (not set yet) → «Data da definire» and «–».
 */
export function formatFixtureDate(iso: string | null): { date: string; time: string } {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return { date: 'Data da definire', time: DASH };
  return { date: fixtureDate.format(d), time: fixtureTime.format(d) };
}

const romeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function romeFields(ms: number): { y: number; mo: number; d: number; h: number; mi: number } {
  const get = (type: string): number => Number(romeParts.formatToParts(ms).find((p) => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

/** Date and time (`YYYY-MM-DD`, `HH:MM`) of an ISO instant in Italian time, for the inputs; empty when not a date. */
export function romeDateTime(iso: string | null): { date: string; time: string } {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const f = romeFields(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${f.y}-${pad(f.mo)}-${pad(f.d)}`, time: `${pad(f.h)}:${pad(f.mi)}` };
}

/** Pure: the ISO instant (UTC) of a date `YYYY-MM-DD` and a time `HH:MM` written in Italian time; null when invalid. */
export function romeToIso(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  // The offset of Rome changes with the summer time: settle it with two passes around the guess.
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const f = romeFields(guess);
    guess += wall - Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi);
  }
  const f = romeFields(guess);
  if (Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi) !== wall) return null;
  return new Date(guess).toISOString();
}

/** Evaluation symbols of DataVolley, from best to worst (`~` = no evaluation). */
export const EVALUATIONS = ['#', '+', '!', '-', '/', '='] as const;
export type EvaluationSymbol = (typeof EVALUATIONS)[number];

export const EVALUATION_LABEL: Record<string, string> = {
  '#': 'Perfetta (#)',
  '+': 'Positiva (+)',
  '!': 'Buona (!)',
  '-': 'Negativa (-)',
  '/': 'Scarsa (/)',
  '=': 'Errore (=)',
  '~': 'Senza valutazione',
};
