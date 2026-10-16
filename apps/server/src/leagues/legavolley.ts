import type { FixtureStatus, LeaguePhase } from '@sir/shared';
import { LEAGUE_MAX_EXTERNAL_ID } from '@sir/shared';
import type { HtmlElement, HtmlTable, TableRow } from './html.js';
import { byId, byTag, extractTables, findAll, findFirst, parseHtml, selectOptions, textOf } from './html.js';
import { romeToUtc } from './romeTime.js';

/**
 * Connector of Lega Pallavolo Serie A (www.legavolley.it): the only URLs it builds, and the readers of the calendar,
 * standings and team pages. Every value taken from a page is text or a validated number: no URL found in a page is
 * ever followed. Pure functions.
 */

export const LEGAVOLLEY_ORIGIN = 'https://www.legavolley.it';

/** Paths the connector may request (prefixes). */
export const LEGAVOLLEY_ALLOWED_PATHS = ['/calendario/', '/classifica/', '/team/', '/GetLogo.aspx'] as const;

/** Disallowed by https://www.legavolley.it/robots.txt (checked 2026-10-16): never requested. */
export const LEGAVOLLEY_ROBOTS_DISALLOWED = [
  '/wp-admin/',
  '/statistiche/',
  '/rendimento/',
  '/pillole/',
  '/confronti/',
  '/matchdaily',
] as const;

/** A logo smaller than this on a side is the placeholder of the site (2x2), not a logo. */
export const LOGO_MIN_SIDE = 16;

/** Most phases, teams and matches read for one championship (far above a real one). */
export const MAX_PHASES = 12;
export const MAX_TEAMS = 64;
export const MAX_FIXTURES = 2000;

/** The page is not the expected one or its format changed: the stored data are kept. */
export class LeagueFormatError extends Error {
  readonly code = 'LEAGUE_FORMAT';
  constructor(message: string) {
    super(message);
    this.name = 'LeagueFormatError';
  }
}

const validId = (n: number): boolean => Number.isInteger(n) && n > 0 && n <= LEAGUE_MAX_EXTERNAL_ID;

function requireId(n: number, what: string): number {
  if (!validId(n)) throw new RangeError(`invalid ${what}`);
  return n;
}

const url = (path: string, query: Record<string, string | number> = {}): URL => {
  const u = new URL(path, LEGAVOLLEY_ORIGIN);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
  return u;
};

/** Calendar of a championship (`IdFase`: one phase; without it the site shows its current phase). */
export function calendarUrl(season: number, championshipId: number, phaseId?: number): URL {
  const query: Record<string, number> = {
    Anno: requireId(season, 'season'),
    IdCampionato: requireId(championshipId, 'championship'),
  };
  if (phaseId !== undefined) {
    if (!Number.isInteger(phaseId) || phaseId < 0 || phaseId > 1000) throw new RangeError('invalid phase');
    query.IdFase = phaseId;
    query.IdSquadra = 0;
  }
  return url('/calendario/', query);
}

/** Standings «Fino ad oggi» (whole championship). */
export function standingsUrl(season: number, championshipId: number): URL {
  return url('/classifica/', {
    Anno: requireId(season, 'season'),
    IdCampionato: requireId(championshipId, 'championship'),
  });
}

export function teamUrl(teamId: number): URL {
  return url(`/team/${requireId(teamId, 'team')}`);
}

/**
 * Logo of a team, 220 px wide at most. `Web=1`: with `Web=0` (the one of the team page) the site answers a 2x2
 * placeholder for many teams that do have a logo (checked 2026-10-16).
 */
export function logoUrl(teamId: number): URL {
  return url('/GetLogo.aspx', {
    Field: 'LogoWeb',
    maxWidth: 220,
    Proc: 'LogoSquadra',
    Web: 1,
    Key: requireId(teamId, 'team'),
    Char: 'False',
  });
}

/**
 * Pure: why a URL may not be requested, null when it may: only https://www.legavolley.it, only the allowed paths,
 * never a path disallowed by robots.txt, no credentials and no fragment.
 */
export function rejectedUrlReason(target: URL): string | null {
  if (target.protocol !== 'https:') return 'solo https';
  if (target.origin !== LEGAVOLLEY_ORIGIN) return 'host non ammesso';
  if (target.username !== '' || target.password !== '') return 'credenziali nell’indirizzo';
  if (target.hash !== '') return 'frammento nell’indirizzo';
  const path = target.pathname.toLowerCase();
  if (LEGAVOLLEY_ROBOTS_DISALLOWED.some((p) => path.startsWith(p.toLowerCase())))
    return 'percorso vietato da robots.txt';
  if (!LEGAVOLLEY_ALLOWED_PATHS.some((p) => target.pathname.startsWith(p))) return 'percorso non ammesso';
  return null;
}

// --- Pages ---------------------------------------------------------------------------------------------------

export interface ParsedTeamRef {
  externalId: number;
  name: string;
}

export interface ParsedFixture {
  /** `n<number>` with the official number of the match, otherwise built from phase, round and teams. */
  externalId: string;
  number: number | null;
  phaseId: number;
  phase: string;
  round: number | null;
  roundLabel: string;
  /** ISO UTC, null when date or time are missing. */
  startsAt: string | null;
  home: ParsedTeamRef;
  away: ParsedTeamRef;
  venue: string | null;
  venueCity: string | null;
  venueAddress: string | null;
  status: FixtureStatus;
  homeSets: number | null;
  awaySets: number | null;
  providerMatchId: number | null;
  note: string | null;
}

export interface ParsedCalendar {
  season: number;
  championshipId: number;
  name: string;
  phases: LeaguePhase[];
  /** Phase shown by the page (its matches are the ones in `fixtures`). */
  phaseId: number;
  /** Teams of the championship (filter «Squadra» of the page). */
  teams: ParsedTeamRef[];
  fixtures: ParsedFixture[];
}

const MAX_TEXT = 200;
const clip = (text: string): string => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);
const orNull = (text: string | undefined): string | null => {
  const t = text?.trim();
  return t ? clip(t) : null;
};

/** Selected value of a select box as a number, or a format error. */
function selectedNumber(doc: HtmlElement, id: string, what: string): { value: number; text: string } {
  const options = selectOptions(doc, id);
  const chosen = options?.find((o) => o.selected) ?? (options?.length === 1 ? options[0] : undefined);
  const value = chosen ? Number(chosen.value) : Number.NaN;
  if (!chosen || !Number.isInteger(value)) throw new LeagueFormatError(`Pagina senza ${what} selezionato`);
  return { value, text: chosen.text };
}

function phasesOf(doc: HtmlElement): LeaguePhase[] {
  const options = selectOptions(doc, 'Fase') ?? [];
  const phases: LeaguePhase[] = [];
  for (const o of options) {
    const id = Number(o.value);
    if (Number.isInteger(id) && id >= 0 && id <= 1000 && !phases.some((p) => p.id === id))
      phases.push({ id, name: clip(o.text) });
  }
  if (phases.length > MAX_PHASES) throw new LeagueFormatError('Troppe fasi nella pagina');
  return phases;
}

/** Numeric id in a `…/team/<id>` or `…/match/<id>` text (attribute or link): only the digits are kept. */
function idIn(text: string | undefined, kind: 'team' | 'match'): number | null {
  const m = text ? new RegExp(`/${kind}/(\\d{1,8})(?!\\d)`).exec(text) : null;
  const id = m?.[1] ? Number(m[1]) : Number.NaN;
  return validId(id) ? id : null;
}

const CALENDAR_COLUMNS = ['Data e Ora ufficiale', 'Casa', 'Ris.', 'Ospite'] as const;

/** Pure: date and time of the cell «Data e Ora ufficiale» (`Sabato 17/10/2026` + `Ore 18:00`, Rome) as ISO UTC. */
export function parseOfficialDate(text: string): string | null {
  const d = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  const t = /(?:^|\D)(\d{1,2})[:.](\d{2})(?!\d)/.exec(text.slice(d ? d.index + d[0].length : 0));
  if (!d || !t) return null;
  const date = romeToUtc(Number(d[3]), Number(d[2]), Number(d[1]), Number(t[1]), Number(t[2]));
  return date ? date.toISOString() : null;
}

/** Pure: sets of a result cell (`3-1`), null when not a result. */
function parseSets(text: string): { home: number; away: number } | null {
  const m = /^(\d)\s*-\s*(\d)$/.exec(text.trim());
  if (!m) return null;
  const home = Number(m[1]);
  const away = Number(m[2]);
  return home <= 5 && away <= 5 ? { home, away } : null;
}

const POSTPONED = /rinvi|posticip|sospes|da recuperare|da definire/i;

function roundOf(header: string, phaseName: string): { round: number | null; roundLabel: string } {
  const label = clip((header.split(/\s+-\s+/)[0] ?? '').trim()) || phaseName;
  const m = /(\d{1,3})/.exec(label);
  const round = m?.[1] ? Number(m[1]) : null;
  return { round: round && round > 0 ? round : null, roundLabel: label };
}

/** Index of each expected column in the header row (`th`), or null when the row is not the header. */
function columnIndex(row: TableRow): Map<string, number> | null {
  if (!row.cells.some((c) => c.tag === 'th')) return null;
  const index = new Map<string, number>();
  let col = 0;
  for (const cell of row.cells) {
    index.set(cell.text, col);
    col += cell.colspan;
  }
  return index;
}

function cellAt(row: TableRow, column: number) {
  let col = 0;
  for (const cell of row.cells) {
    if (col === column) return cell;
    col += cell.colspan;
  }
  return undefined;
}

/**
 * Pure: calendar page (`/calendario/`): championship, season and phase selected in the filters, phases, teams and the
 * matches of the phase shown, round by round. Throws LeagueFormatError when the filters or the expected columns are
 * missing. A page with the filters and no round is an empty calendar.
 */
export function parseCalendar(html: string): ParsedCalendar {
  const doc = parseHtml(html);
  const season = selectedNumber(doc, 'Anno', 'la stagione').value;
  // The site shows no championship selected when IdCampionato is not of that season.
  if (!selectOptions(doc, 'Campionato')?.some((o) => o.selected) && selectOptions(doc, 'Campionato') !== null)
    throw new LeagueFormatError(
      `Il sito non ha questo campionato nella stagione ${season}/${season + 1}: controlla IdCampionato e stagione`,
    );
  const championship = selectedNumber(doc, 'Campionato', 'il campionato');
  const phases = phasesOf(doc);
  const phase = phases.length > 0 ? selectedNumber(doc, 'Fase', 'la fase') : { value: 0, text: championship.text };
  const phaseName = clip(phase.text);
  const teams: ParsedTeamRef[] = [];
  for (const o of selectOptions(doc, 'Squadra') ?? []) {
    const id = Number(o.value);
    if (validId(id) && !teams.some((t) => t.externalId === id)) teams.push({ externalId: id, name: clip(o.text) });
  }
  const fixtures: ParsedFixture[] = [];
  for (const table of extractTables(doc)) {
    const headerAt = table.rows.findIndex((r) =>
      r.cells.some((c) => c.tag === 'th' && c.text === 'Data e Ora ufficiale'),
    );
    if (headerAt === -1) continue;
    const header = table.rows[headerAt];
    const columns = header ? columnIndex(header) : null;
    if (!columns || CALENDAR_COLUMNS.some((c) => !columns.has(c)))
      throw new LeagueFormatError('Calendario senza le colonne attese (Data e Ora ufficiale, Casa, Ris., Ospite)');
    const roundRow = table.rows.slice(0, headerAt).find((r) => r.text.length > 0);
    const { round, roundLabel } = roundOf(roundRow?.text ?? '', phaseName);
    for (const row of table.rows.slice(headerAt + 1)) {
      if (!row.cells.some((c) => c.tag === 'td')) continue;
      fixtures.push(readFixture(row, columns, { phaseId: phase.value, phase: phaseName, round, roundLabel }));
      if (fixtures.length > MAX_FIXTURES) throw new LeagueFormatError('Troppe partite nella pagina');
    }
  }
  const hasRounds = fixtures.length > 0;
  if (!hasRounds && findFirst(doc, (el) => el.name === 'tr' && (el.attrs.class ?? '').includes('tab-gara')))
    throw new LeagueFormatError('Calendario con partite in un formato sconosciuto');
  for (const f of fixtures)
    for (const t of [f.home, f.away])
      if (!teams.some((x) => x.externalId === t.externalId)) teams.push({ externalId: t.externalId, name: t.name });
  if (teams.length > MAX_TEAMS) throw new LeagueFormatError('Troppe squadre nella pagina');
  return {
    season,
    championshipId: championship.value,
    name: clip(championship.text),
    phases,
    phaseId: phase.value,
    teams,
    fixtures,
  };
}

function readFixture(
  row: TableRow,
  columns: Map<string, number>,
  round: { phaseId: number; phase: string; round: number | null; roundLabel: string },
): ParsedFixture {
  const at = (name: string) => {
    const col = columns.get(name);
    return col === undefined ? undefined : cellAt(row, col);
  };
  const homeCell = at('Casa');
  const awayCell = at('Ospite');
  const resultCell = at('Ris.');
  const home = homeCell ? idIn(homeCell.attrs.onclick, 'team') : null;
  const away = awayCell ? idIn(awayCell.attrs.onclick, 'team') : null;
  if (!homeCell || !awayCell || !resultCell || home === null || away === null)
    throw new LeagueFormatError('Partita del calendario senza squadre riconoscibili');
  const numberText = at('#')?.text ?? '';
  const parsedNumber = /^\d{1,6}$/.test(numberText) ? Number(numberText) : null;
  const number = parsedNumber && parsedNumber > 0 ? parsedNumber : null;
  const providerMatchId =
    idIn(resultCell.attrs.onclick, 'match') ??
    resultCell.links.map((l) => idIn(l, 'match')).find((id) => id !== null) ??
    null;
  const sets = parseSets(resultCell.text);
  const note = orNull(at('Note')?.text.replace(/\n/g, ' '));
  const played = sets !== null && sets.home + sets.away > 0 && providerMatchId !== null;
  const status: FixtureStatus = played ? 'played' : note && POSTPONED.test(note) ? 'postponed' : 'scheduled';
  const venueCell = at('Impianto');
  const [venue, venueCity] = (venueCell?.text ?? '').split('\n');
  const address = (venueCell?.attrs.title ?? '')
    .replace(/^\s*Indirizzo:\s*/i, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(', ');
  return {
    externalId: number !== null ? `n${number}` : `p${round.phaseId}-r${round.round ?? 0}-${home}-${away}`,
    number,
    phaseId: round.phaseId,
    phase: round.phase,
    round: round.round,
    roundLabel: round.roundLabel,
    startsAt: parseOfficialDate(at('Data e Ora ufficiale')?.text ?? ''),
    home: { externalId: home, name: clip(homeCell.text.replace(/\n/g, ' ')) },
    away: { externalId: away, name: clip(awayCell.text.replace(/\n/g, ' ')) },
    venue: orNull(venue),
    venueCity: orNull(venueCity),
    venueAddress: orNull(address),
    status,
    homeSets: played ? (sets?.home ?? null) : null,
    awaySets: played ? (sets?.away ?? null) : null,
    providerMatchId,
    note,
  };
}

export interface ParsedStanding {
  position: number;
  teamName: string;
  points: number;
  played: number;
  won: number;
  lost: number;
  /** Matches by result: 3-0, 3-1, 3-2, 2-3, 1-3, 0-3. */
  byResult: number[];
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  setRatio: number | null;
  pointRatio: number | null;
}

export interface ParsedStandings {
  season: number;
  /** Championship selected in the filter; null when the filter does not list it (play off). */
  championshipId: number | null;
  rows: ParsedStanding[];
}

const STANDINGS_HEADERS = ['Punti', 'Partite', 'Quoziente'];
const STANDINGS_SUBHEADERS = ['Giocate', 'Vinte', 'Perse', 'Vinti', 'Persi', 'Fatti', 'Subiti'];

/** Integer written with thousands dots (`1.960`); empty or `.` (no match played) is 0. */
function integer(text: string): number {
  const digits = text.replace(/[.\s]/g, '');
  if (digits === '') return 0;
  if (!/^-?\d{1,7}$/.test(digits)) throw new LeagueFormatError('Classifica con valori non numerici');
  return Number(digits);
}

/** Quotient written with a decimal comma (`3,15`); `-` or text (not computed) is null. */
function ratio(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(t)) return null;
  return Number(t);
}

function isStandingsTable(table: HtmlTable): boolean {
  const heads = table.rows.slice(0, 2).map((r) => r.cells.map((c) => c.text));
  return (
    STANDINGS_HEADERS.every((h) => heads[0]?.includes(h) === true) &&
    STANDINGS_SUBHEADERS.every((h) => heads[1]?.includes(h) === true)
  );
}

/**
 * Pure: standings page (`/classifica/`, «Fino ad oggi»). Throws LeagueFormatError when the table or its columns are
 * missing; a table without rows is an empty standings.
 */
export function parseStandings(html: string): ParsedStandings {
  const doc = parseHtml(html);
  const season = selectedNumber(doc, 'Anno', 'la stagione').value;
  const options = selectOptions(doc, 'Campionato');
  const chosen = options?.find((o) => o.selected);
  const championshipId = chosen && Number.isInteger(Number(chosen.value)) ? Number(chosen.value) : null;
  const table = extractTables(doc).find(isStandingsTable);
  if (!table) throw new LeagueFormatError('Classifica senza la tabella attesa (Punti, Partite, Set, Quoziente)');
  const rows: ParsedStanding[] = [];
  for (const row of table.rows.slice(2)) {
    const first = row.cells[0];
    const pos = first ? findFirst(first.element, byTag('span', 'pos')) : null;
    if (!first || !pos) continue;
    const values = row.cells.slice(1).map((c) => c.text);
    if (values.length < 16) throw new LeagueFormatError('Riga della classifica con colonne mancanti');
    const position = integer(textOf(pos));
    const teamName = clip(
      first.text
        .replace(/^\d+\s*/, '')
        .replace(/\n/g, ' ')
        .trim(),
    );
    if (position < 1 || teamName === '') throw new LeagueFormatError('Riga della classifica senza posizione o squadra');
    const v = (k: number) => values[k] ?? '';
    rows.push({
      position,
      teamName,
      points: integer(v(0)),
      played: integer(v(1)),
      won: integer(v(2)),
      lost: integer(v(3)),
      byResult: [4, 5, 6, 7, 8, 9].map((k) => integer(v(k))),
      setsWon: integer(v(10)),
      setsLost: integer(v(11)),
      pointsFor: integer(v(12)),
      pointsAgainst: integer(v(13)),
      setRatio: ratio(v(14)),
      pointRatio: ratio(v(15)),
    });
    if (rows.length > MAX_TEAMS) throw new LeagueFormatError('Troppe righe nella classifica');
  }
  return { season, championshipId, rows };
}

export interface ParsedTeam {
  name: string;
  venue: string | null;
  venueAddress: string | null;
  /** City of the venue (`Perugia (PG)`). */
  city: string | null;
}

/** Pure: team page (`/team/<id>`): name and venue. Throws LeagueFormatError without the name. */
export function parseTeam(html: string): ParsedTeam {
  const doc = parseHtml(html);
  const nameEl = findFirst(doc, byTag('div', 'squadra-nome-main'));
  const name = nameEl ? textOf(nameEl) : '';
  if (!name) throw new LeagueFormatError('Pagina della squadra senza il nome');
  const box = findFirst(doc, byId('impianto'));
  const venueEl = box ? findFirst(box, byTag('div', 'title-gray')) : null;
  const info = box
    ? findAll(box, byTag('div', 'squadra-info'))
        .map((el) => textOf(el).replace(/\n/g, ' '))
        .filter(Boolean)
    : [];
  const cityLine = info.find((l) => /^\d{5}\s*-\s*/.test(l));
  const address = info.find((l) => l !== cityLine && !/^(Capienza|Tel|Fax|Email)\b/i.test(l));
  return {
    name: clip(name.replace(/\n/g, ' ')),
    venue: orNull(venueEl ? textOf(venueEl) : undefined),
    venueAddress: orNull(address),
    city: orNull(cityLine?.replace(/^\d{5}\s*-\s*/, '')),
  };
}
