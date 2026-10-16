import type { PlayerRef, Ratio, Side, TeamRef } from '@sir/volley-stats';

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

/** "Rossi M." from a player reference; "#12" if the name is missing. */
export function playerName(player: PlayerRef | undefined, number: number): string {
  const last = player?.lastName?.trim();
  const first = player?.firstName?.trim();
  if (last && first) return `${last} ${first.charAt(0)}.`;
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

/**
 * Official date and time of a match of the calendar, in Italian time like the league writes them: «dom 18 ott 2026»
 * and «18:00»; `null` (not set yet) → «Data da definire» and «–».
 */
export function formatFixtureDate(iso: string | null): { date: string; time: string } {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return { date: 'Data da definire', time: DASH };
  return { date: fixtureDate.format(d), time: fixtureTime.format(d) };
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
