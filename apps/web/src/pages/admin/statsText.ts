import type { StatsOverview } from '@arenalive/shared';

/** Pure: seconds as «4 min 20 s», «1 h 05 min», «45 s»; 0 or less as «–». */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Pure: «12 (34%)» of a part on a total («12» without a total). */
export function withShare(part: number, total: number): string {
  return total > 0 ? `${part} (${Math.round((part / total) * 100)}%)` : String(part);
}

const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' });

/** Day of Rome of an instant, `YYYY-MM-DD`. */
export const romeDayOf = (date: Date): string => dayFormat.format(date);

/** Pure: the day `delta` days from `day` (`YYYY-MM-DD`). */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Pure: `2026-10-17` as «17/10/2026». */
export function dayText(day: string): string {
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
}

/**
 * Pure: a cell of the CSV. A text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`
 * so a spreadsheet never runs it as a formula; cells with `;`, a quote or a line break are quoted. Numbers stay numbers.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Byte order mark: Excel reads the accents as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Pure: the CSV of an overview (`;` as separator for the Italian Excel, a BOM for the accents): the totals, the matches,
 * the links and the days of the period.
 */
export function statsCsv(o: StatsOverview): string {
  const rows: (string | number | null)[][] = [
    ['Periodo', `${dayText(o.from)} - ${dayText(o.to)}`],
    [],
    ['Totali'],
    [
      'Visite',
      'Da QR',
      'Da app installata',
      'Picco spettatori',
      'Ora del picco',
      'Durata media (s)',
      'Tempo totale (s)',
    ],
    [
      o.totals.visits,
      o.totals.qrVisits,
      o.totals.appVisits,
      o.totals.peak,
      o.totals.peakAt,
      o.totals.avgSeconds,
      o.totals.totalSeconds,
    ],
    [],
    ['Dispositivi'],
    ['Maxischermo', 'Tablet', 'Smartphone'],
    [o.devices.tv, o.devices.tablet, o.devices.phone],
    [],
    ['Partite'],
    ['Partita', 'Visite', 'Da QR', 'Picco', 'Ora del picco', 'Durata media (s)', 'Tempo totale (s)'],
    ...o.matches.map((m) => [m.label, m.visits, m.qrVisits, m.peak, m.peakAt, m.avgSeconds, m.totalSeconds]),
    [],
    ['Link'],
    ['Link', 'Tipo', 'Visite', 'Da QR', 'Durata media (s)'],
    ...o.links.map((l) => [l.label, l.kind, l.visits, l.qrVisits, l.avgSeconds]),
    [],
    ['Giornate'],
    ['Giorno', 'Visite', 'Tempo totale (s)', 'Picco'],
    ...o.daily.map((d) => [d.day, d.visits, d.totalSeconds, d.peak]),
  ];
  return `${BOM}${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
