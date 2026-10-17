import type { StatsCurve, StatsDayRow, StatsLinkRow, StatsMatchRow, StatsOverview, StatsTotals } from '@sir/shared';
import { asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { clientFixtures, matches, pageViews, shareTokens, viewDaily, viewerPeaks } from '../db/index.js';
import { tenantScope } from '../tenancy.js';
import { addDays } from './days.js';
import type { PeakRow, VisitRow } from './tracker.js';

/** Rows per INSERT (a batch of thousands of visits is written in a few statements). */
export const INSERT_CHUNK = 500;
/** Days of detail kept in `page_views` and `viewer_peaks`. */
export const DETAIL_DAYS = 90;
/** Most rows of the tables of the dashboard. */
export const TABLE_LIMIT = 100;

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Ids of `table` among `ids` that belong to the client (the others were deleted since, or are not its own). */
async function ownedIds(
  db: Pick<Db, 'select'>,
  table: typeof matches | typeof shareTokens | typeof clientFixtures,
  tenantId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(tenantScope(table, tenantId, inArray(table.id, ids)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Writes a batch of visits and peaks. References to a match, a link or a match of the calendar that no longer exist
 * (or are not of the client of the row) are dropped from the row, so one deleted match cannot make the batch fail.
 */
export async function writeBatch(root: Db, batch: { visits: VisitRow[]; peaks: PeakRow[] }): Promise<void> {
  // One transaction: a failure leaves nothing written; the ids come from the tracker and a repeated insert is ignored.
  await root.transaction(async (db) => {
    const tenantIds = [...new Set([...batch.visits.map((v) => v.tenantId), ...batch.peaks.map((p) => p.tenantId)])];
    for (const tenantId of tenantIds) {
      const visits = batch.visits.filter((v) => v.tenantId === tenantId);
      const peaks = batch.peaks.filter((p) => p.tenantId === tenantId);
      const [matchIds, linkIds, fixtureIds] = await Promise.all([
        ownedIds(db, matches, tenantId, [
          ...new Set([...visits.flatMap((v) => (v.matchId ? [v.matchId] : [])), ...peaks.map((p) => p.matchId)]),
        ]),
        ownedIds(db, shareTokens, tenantId, [...new Set(visits.map((v) => v.shareTokenId))]),
        ownedIds(db, clientFixtures, tenantId, [
          ...new Set(visits.flatMap((v) => (v.clientFixtureId ? [v.clientFixtureId] : []))),
        ]),
      ]);
      const visitRows = visits.map((v) => ({
        tenantId,
        id: v.id,
        shareTokenId: linkIds.has(v.shareTokenId) ? v.shareTokenId : null,
        clientFixtureId: v.clientFixtureId && fixtureIds.has(v.clientFixtureId) ? v.clientFixtureId : null,
        matchId: v.matchId && matchIds.has(v.matchId) ? v.matchId : null,
        startedAt: v.startedAt,
        endedAt: v.endedAt,
        seconds: v.seconds,
        device: v.device,
        source: v.source,
        app: v.app,
        day: v.day,
      }));
      for (const part of chunks(visitRows, INSERT_CHUNK)) await db.insert(pageViews).values(part).onConflictDoNothing();
      const peakRows = peaks
        .filter((p) => matchIds.has(p.matchId))
        .map((p) => ({ tenantId, matchId: p.matchId, minute: p.minute, viewers: p.viewers, day: p.day }));
      for (const part of chunks(peakRows, INSERT_CHUNK)) {
        await db
          .insert(viewerPeaks)
          .values(part)
          .onConflictDoUpdate({
            target: [viewerPeaks.matchId, viewerPeaks.minute],
            set: { viewers: sql`greatest(${viewerPeaks.viewers}, excluded.viewers)` },
          });
      }
    }
  });
}

/**
 * Keeps 90 days of detail: the days before `today - 90` become rows of `view_daily` (per link and match; the peaks
 * of a match in its own rows without a link) and their detail is deleted, in one transaction. Returns the day it
 * kept from.
 */
export async function purgeOld(db: Db, today: string): Promise<string> {
  const cutoff = addDays(today, -DETAIL_DAYS);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into view_daily (tenant_id, day, share_token_id, match_id, visits, qr_visits, app_visits, tv_visits,
        tablet_visits, phone_visits, seconds, peak)
      select tenant_id, day, share_token_id, match_id, count(*), count(*) filter (where source = 'qr'),
        count(*) filter (where app), count(*) filter (where device = 'tv'), count(*) filter (where device = 'tablet'),
        count(*) filter (where device = 'phone'), sum(seconds), 0
      from page_views where day < ${cutoff}
      group by tenant_id, day, share_token_id, match_id`);
    await tx.execute(sql`
      insert into view_daily (tenant_id, day, share_token_id, match_id, visits, qr_visits, app_visits, tv_visits,
        tablet_visits, phone_visits, seconds, peak)
      select tenant_id, day, null, match_id, 0, 0, 0, 0, 0, 0, 0, max(viewers)
      from viewer_peaks where day < ${cutoff}
      group by tenant_id, day, match_id`);
    await tx.delete(pageViews).where(lt(pageViews.day, cutoff));
    await tx.delete(viewerPeaks).where(lt(viewerPeaks.day, cutoff));
  });
  return cutoff;
}

/** Counts of a group of visits, as summed from the detail and from the daily totals. */
interface Group {
  day: string;
  shareTokenId: string | null;
  matchId: string | null;
  visits: number;
  qr: number;
  app: number;
  tv: number;
  tablet: number;
  phone: number;
  seconds: number;
  peak: number;
}

interface PeakPoint {
  matchId: string;
  day: string;
  viewers: number;
  at: Date;
}

export interface StatsData {
  groups: Group[];
  peaks: PeakPoint[];
  links: Map<string, { label: string; kind: StatsLinkRow['kind'] }>;
  matchLabels: Map<string, string>;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

/** Reads, for one client and a period of days, the detail, the daily totals and the peaks (always `tenantScope`). */
export async function readStats(db: Db, tenantId: string, from: string, to: string): Promise<StatsData> {
  const detail = await db
    .select({
      day: pageViews.day,
      shareTokenId: pageViews.shareTokenId,
      matchId: pageViews.matchId,
      visits: sql<number>`count(*)`,
      qr: sql<number>`count(*) filter (where ${pageViews.source} = 'qr')`,
      app: sql<number>`count(*) filter (where ${pageViews.app})`,
      tv: sql<number>`count(*) filter (where ${pageViews.device} = 'tv')`,
      tablet: sql<number>`count(*) filter (where ${pageViews.device} = 'tablet')`,
      phone: sql<number>`count(*) filter (where ${pageViews.device} = 'phone')`,
      seconds: sql<number>`coalesce(sum(${pageViews.seconds}), 0)`,
    })
    .from(pageViews)
    .where(tenantScope(pageViews, tenantId, gte(pageViews.day, from), lte(pageViews.day, to)))
    .groupBy(pageViews.day, pageViews.shareTokenId, pageViews.matchId);
  const old = await db
    .select({
      day: viewDaily.day,
      shareTokenId: viewDaily.shareTokenId,
      matchId: viewDaily.matchId,
      visits: sql<number>`sum(${viewDaily.visits})`,
      qr: sql<number>`sum(${viewDaily.qrVisits})`,
      app: sql<number>`sum(${viewDaily.appVisits})`,
      tv: sql<number>`sum(${viewDaily.tvVisits})`,
      tablet: sql<number>`sum(${viewDaily.tabletVisits})`,
      phone: sql<number>`sum(${viewDaily.phoneVisits})`,
      seconds: sql<number>`sum(${viewDaily.seconds})`,
      peak: sql<number>`max(${viewDaily.peak})`,
    })
    .from(viewDaily)
    .where(tenantScope(viewDaily, tenantId, gte(viewDaily.day, from), lte(viewDaily.day, to)))
    .groupBy(viewDaily.day, viewDaily.shareTokenId, viewDaily.matchId);
  const peakRows = await db
    .selectDistinctOn([viewerPeaks.matchId, viewerPeaks.day], {
      matchId: viewerPeaks.matchId,
      day: viewerPeaks.day,
      viewers: viewerPeaks.viewers,
      at: viewerPeaks.minute,
    })
    .from(viewerPeaks)
    .where(tenantScope(viewerPeaks, tenantId, gte(viewerPeaks.day, from), lte(viewerPeaks.day, to)))
    .orderBy(viewerPeaks.matchId, viewerPeaks.day, desc(viewerPeaks.viewers), asc(viewerPeaks.minute));

  const groups: Group[] = [
    ...detail.map((r) => ({
      day: r.day,
      shareTokenId: r.shareTokenId,
      matchId: r.matchId,
      visits: num(r.visits),
      qr: num(r.qr),
      app: num(r.app),
      tv: num(r.tv),
      tablet: num(r.tablet),
      phone: num(r.phone),
      seconds: num(r.seconds),
      peak: 0,
    })),
    ...old.map((r) => ({
      day: r.day,
      shareTokenId: r.shareTokenId,
      matchId: r.matchId,
      visits: num(r.visits),
      qr: num(r.qr),
      app: num(r.app),
      tv: num(r.tv),
      tablet: num(r.tablet),
      phone: num(r.phone),
      seconds: num(r.seconds),
      peak: num(r.peak),
    })),
  ];
  const peaks: PeakPoint[] = peakRows.map((r) => ({ matchId: r.matchId, day: r.day, viewers: r.viewers, at: r.at }));

  const linkIds = [...new Set(groups.flatMap((g) => (g.shareTokenId ? [g.shareTokenId] : [])))];
  const matchIds = [
    ...new Set([...groups.flatMap((g) => (g.matchId ? [g.matchId] : [])), ...peaks.map((p) => p.matchId)]),
  ];
  const links = new Map<string, { label: string; kind: StatsLinkRow['kind'] }>();
  if (linkIds.length > 0) {
    const rows = await db
      .select({
        id: shareTokens.id,
        label: shareTokens.label,
        matchId: shareTokens.matchId,
        clientFixtureId: shareTokens.clientFixtureId,
      })
      .from(shareTokens)
      .where(tenantScope(shareTokens, tenantId, inArray(shareTokens.id, linkIds)));
    for (const r of rows)
      links.set(r.id, { label: r.label, kind: r.clientFixtureId ? 'fixture' : r.matchId ? 'match' : 'channel' });
  }
  const matchLabels = await matchLabelsOf(db, tenantId, matchIds);
  return { groups, peaks, links, matchLabels };
}

/** «Casa – Ospiti» of matches of the client (the match key when the file has no team names). */
export async function matchLabelsOf(db: Db, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: matches.id,
      key: matches.matchKey,
      home: sql<string | null>`${matches.state}->'teams'->'home'->>'name'`,
      away: sql<string | null>`${matches.state}->'teams'->'away'->>'name'`,
    })
    .from(matches)
    .where(tenantScope(matches, tenantId, inArray(matches.id, ids)));
  for (const r of rows) out.set(r.id, r.home || r.away ? `${r.home ?? 'Casa'} – ${r.away ?? 'Ospiti'}` : r.key);
  return out;
}

const avg = (seconds: number, visits: number): number => (visits > 0 ? Math.round(seconds / visits) : 0);

/** Pure: the overview of the dashboard from what `readStats` read. */
export function buildOverview(data: StatsData, from: string, to: string): StatsOverview {
  const devices = { tv: 0, tablet: 0, phone: 0 };
  const total = { visits: 0, qr: 0, app: 0, seconds: 0 };
  const byMatch = new Map<string | null, StatsMatchRow>();
  const byLink = new Map<string | null, StatsLinkRow>();
  const byDay = new Map<string, StatsDayRow>();
  const ensureMatch = (id: string | null): StatsMatchRow => {
    let row = byMatch.get(id);
    if (!row) {
      row = {
        matchId: id,
        label: id ? (data.matchLabels.get(id) ?? 'Partita eliminata') : 'Prima dell’inizio della partita',
        visits: 0,
        qrVisits: 0,
        totalSeconds: 0,
        avgSeconds: 0,
        peak: 0,
        peakAt: null,
      };
      byMatch.set(id, row);
    }
    return row;
  };
  const ensureDay = (day: string): StatsDayRow => {
    let row = byDay.get(day);
    if (!row) {
      row = { day, visits: 0, totalSeconds: 0, peak: 0 };
      byDay.set(day, row);
    }
    return row;
  };
  for (const g of data.groups) {
    // Peak-only totals of a match deleted since (no match left, no visits): in no row, so not in «Prima dell’inizio».
    if (g.visits === 0 && g.matchId === null) continue;
    devices.tv += g.tv;
    devices.tablet += g.tablet;
    devices.phone += g.phone;
    total.visits += g.visits;
    total.qr += g.qr;
    total.app += g.app;
    total.seconds += g.seconds;
    const m = ensureMatch(g.matchId);
    m.visits += g.visits;
    m.qrVisits += g.qr;
    m.totalSeconds += g.seconds;
    m.peak = Math.max(m.peak, g.peak);
    const d = ensureDay(g.day);
    d.visits += g.visits;
    d.totalSeconds += g.seconds;
    d.peak = Math.max(d.peak, g.peak);
    if (g.visits === 0) continue;
    const link = g.shareTokenId ? data.links.get(g.shareTokenId) : undefined;
    let l = byLink.get(g.shareTokenId);
    if (!l) {
      l = {
        shareTokenId: link ? g.shareTokenId : null,
        label: link?.label ?? 'Link eliminato',
        kind: link?.kind ?? 'deleted',
        visits: 0,
        qrVisits: 0,
        avgSeconds: 0,
      };
      byLink.set(g.shareTokenId, l);
    }
    l.visits += g.visits;
    l.qrVisits += g.qr;
    // Seconds of the link are summed in `avgSeconds` until the end of the loop (then divided by its visits).
    l.avgSeconds += g.seconds;
  }
  let best: { viewers: number; at: Date | null } = { viewers: 0, at: null };
  for (const p of data.peaks) {
    const m = ensureMatch(p.matchId);
    if (p.viewers > m.peak || (p.viewers === m.peak && m.peakAt === null)) {
      m.peak = p.viewers;
      m.peakAt = p.at.toISOString();
    }
    const d = ensureDay(p.day);
    d.peak = Math.max(d.peak, p.viewers);
  }
  for (const m of byMatch.values()) {
    m.avgSeconds = avg(m.totalSeconds, m.visits);
    if (m.peak > best.viewers || (m.peak === best.viewers && best.at === null && m.peakAt)) {
      best = { viewers: m.peak, at: m.peakAt ? new Date(m.peakAt) : null };
    }
  }
  for (const l of byLink.values()) l.avgSeconds = avg(l.avgSeconds, l.visits);
  const totals: StatsTotals = {
    visits: total.visits,
    qrVisits: total.qr,
    appVisits: total.app,
    totalSeconds: total.seconds,
    avgSeconds: avg(total.seconds, total.visits),
    peak: best.viewers,
    peakAt: best.at ? best.at.toISOString() : null,
  };
  return {
    from,
    to,
    totals,
    devices,
    matches: [...byMatch.values()]
      .filter((m) => m.visits > 0 || m.peak > 0)
      .sort((a, b) => b.visits - a.visits || b.peak - a.peak)
      .slice(0, TABLE_LIMIT),
    links: [...byLink.values()].sort((a, b) => b.visits - a.visits).slice(0, TABLE_LIMIT),
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** Spectators minute by minute during a match of the client (null: not a match of the client). */
export async function readCurve(db: Db, tenantId: string, matchId: string): Promise<StatsCurve | null> {
  const [m] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(tenantScope(matches, tenantId, eq(matches.id, matchId), eq(matches.simulated, false)))
    .limit(1);
  if (!m) return null;
  const rows = await db
    .select({ at: viewerPeaks.minute, viewers: viewerPeaks.viewers })
    .from(viewerPeaks)
    .where(tenantScope(viewerPeaks, tenantId, eq(viewerPeaks.matchId, matchId)))
    .orderBy(asc(viewerPeaks.minute))
    .limit(2000);
  return { matchId, points: rows.map((r) => ({ at: r.at.toISOString(), viewers: r.viewers })) };
}
