import type { ChampionshipOption, LeagueSeries } from '@arenalive/shared';
import { LEAGUE_SERIES, pickSeriesChampionships } from '@arenalive/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { LeagueFetcher } from './fetcher.js';
import { decodePage } from './fetcher.js';
import type { ParsedChampionshipMenu } from './legavolley.js';
import {
  calendarMenuUrl,
  championshipPageUrl,
  LeagueFormatError,
  parseChampionshipLinkIds,
  parseChampionshipMenu,
} from './legavolley.js';

/** A championship of the catalog on the official site: its `IdCampionato` and season. */
export interface CatalogChampionship extends ChampionshipOption {
  season: number;
}

/** The menu is read again after this time when a club asks for a series. */
export const CATALOG_MAX_AGE_MS = 12 * 3_600_000;
/** The nightly update reads the menu again when the last reading is older than this. */
export const CATALOG_NIGHTLY_AGE_MS = 20 * 3_600_000;
/** Most pages read to find every series of the catalog (the first one included). */
export const CATALOG_MAX_PAGES = 10;

/** A page read: its menu «Campionato» and the `IdCampionato` of its links. */
export interface CatalogPage {
  menu: ParsedChampionshipMenu;
  linkIds: number[];
}

/**
 * Pure (the reading of the pages is `read`): the championships of the season. The calendar page without filters lists
 * only the series of the page; its navigation links name the other championships, whose own pages list their series.
 * Pages are read (highest ids first, the most recent season) until every series of the catalog is found, at most
 * `maxPages`; the menus are merged.
 */
export async function discoverChampionships(
  read: (id: number | null) => Promise<CatalogPage>,
  series: readonly LeagueSeries[] = LEAGUE_SERIES,
  maxPages = CATALOG_MAX_PAGES,
  onSkip: (id: number, err: LeagueFormatError) => void = () => undefined,
): Promise<ParsedChampionshipMenu> {
  const first = await read(null);
  const merged = [...first.menu.championships];
  const complete = (): boolean => series.every((s) => pickSeriesChampionships(s, merged).length > 0);
  const queue = [...first.linkIds].sort((a, b) => b - a);
  let pages = 1;
  for (let id = queue.shift(); id !== undefined && pages < maxPages && !complete(); id = queue.shift()) {
    if (merged.some((c) => c.externalId === id)) continue;
    pages++;
    let page: CatalogPage;
    try {
      page = await read(id);
    } catch (err) {
      // A page that changed does not stop the discovery: the others are read; a series still missing fails later.
      if (!(err instanceof LeagueFormatError)) throw err;
      onSkip(id, err);
      continue;
    }
    for (const c of page.menu.championships) if (!merged.some((m) => m.externalId === c.externalId)) merged.push(c);
  }
  return { season: first.menu.season, championships: merged };
}

/**
 * Championships of the season in course as found on the official site, kept in memory: one reading serves every club.
 * A page that changed is a LeagueFormatError with a clear text.
 */
export class LeagueCatalog {
  private menu: { at: Date; data: ParsedChampionshipMenu } | null = null;
  private loading: Promise<ParsedChampionshipMenu> | null = null;

  constructor(private readonly o: { fetcher: LeagueFetcher; now: () => Date; log: FastifyBaseLogger }) {}

  /** Reads the catalog from the site (one reading at a time). */
  refresh(): Promise<ParsedChampionshipMenu> {
    this.loading ??= this.read().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async page(id: number | null): Promise<CatalogPage> {
    const res = await this.o.fetcher.get(id === null ? calendarMenuUrl() : championshipPageUrl(id), 'page');
    if (res.status === 'not-modified') throw new LeagueFormatError('Risposta inattesa del sito');
    const html = decodePage(res.body, res.contentType);
    return { menu: parseChampionshipMenu(html), linkIds: parseChampionshipLinkIds(html) };
  }

  private async read(): Promise<ParsedChampionshipMenu> {
    const data = await discoverChampionships(
      (id) => this.page(id),
      LEAGUE_SERIES,
      CATALOG_MAX_PAGES,
      (id, err) => this.o.log.warn({ championshipId: id, reason: err.message }, 'pagina del catalogo saltata'),
    );
    this.menu = { at: this.o.now(), data };
    this.o.log.info({ season: data.season, championships: data.championships.length }, 'catalogo dei campionati letto');
    return data;
  }

  /** The catalog, read from the site when never read or older than `maxAgeMs`. */
  async current(maxAgeMs = CATALOG_MAX_AGE_MS): Promise<ParsedChampionshipMenu> {
    const menu = this.menu;
    if (menu && this.o.now().getTime() - menu.at.getTime() < maxAgeMs) return menu.data;
    return this.refresh();
  }

  /** The championships of a series in the season in course (A3: both groups); throws LeagueFormatError when none. */
  async resolve(series: LeagueSeries): Promise<CatalogChampionship[]> {
    const menu = await this.current();
    const found = pickSeriesChampionships(series, menu.championships);
    if (found.length === 0)
      throw new LeagueFormatError(
        `Il sito della Lega non ha ancora il campionato «${series.label}» nella stagione ${menu.season}/${menu.season + 1}`,
      );
    return found.map((c) => ({ ...c, season: menu.season }));
  }

  /** True when the catalog was never read or its reading is old: the nightly update reads it again. */
  stale(): boolean {
    return this.menu === null || this.o.now().getTime() - this.menu.at.getTime() >= CATALOG_NIGHTLY_AGE_MS;
  }
}
