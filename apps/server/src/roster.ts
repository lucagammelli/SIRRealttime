import type { Role, RosterPlayer } from '@arenalive/dvw-simulator';
import type {
  OverlayPlayerKind,
  Player,
  PlayerEditableField,
  PlayerEventMedia,
  PlayerMediaItem,
  PlayerRole,
  PublicPlayerMedia,
  SkippedPlayer,
} from '@arenalive/shared';
import {
  adminAssetPath,
  isOverlayPlayerKind,
  isVideoMime,
  noPlayerEvents,
  normalizeTeamText,
  PLAYER_EDITABLE_FIELDS,
  PLAYERS_MAX,
  publicPlayerEvents,
  resolveClubProfile,
} from '@arenalive/shared';
import { asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { assets, leagues, leagueTeams, playerMedia, players, tenantLeagues, tenants } from './db/index.js';
import { seriesLeagueIds, seriesTeamOf } from './leagues/competitions.js';
import type { ParsedRosterPlayer } from './leagues/legavolley.js';
import type { Tx } from './matchLock.js';
import { tenantScope } from './tenancy.js';

/**
 * «Squadra» of a client: the roster of its team in a season (`players`) and the photos and videos of each player
 * (`player_media`, files of the library). What the admin routes, the import from the site of the league and the public
 * graphics share.
 */

export type PlayerRow = typeof players.$inferSelect;

/** Order of the roster: its position, then the shirt number. */
const ORDER = [asc(players.position), asc(players.number), asc(players.lastName)] as const;

const isEditable = (f: string): f is PlayerEditableField => (PLAYER_EDITABLE_FIELDS as readonly string[]).includes(f);

/** The team of the club on the site of the league and the season of its roster. */
export interface RosterContext {
  /** Season of the championship of the series of the club (without a series: of the championship of its team). */
  season: number | null;
  /** Team of the club in its series (without a series: the first one chosen in «Club»); null when none. */
  team: { id: string; externalId: number; name: string } | null;
}

export async function rosterContext(db: Db | Tx, tenantId: string): Promise<RosterContext> {
  const [tenant] = await db.select({ clubProfile: tenants.clubProfile }).from(tenants).where(eq(tenants.id, tenantId));
  const ids = seriesLeagueIds(resolveClubProfile(tenant?.clubProfile));
  if (ids.length > 0) {
    // The series of the club: its season, and its team there (never the one of a cup or of an old season).
    const series = await db.select({ season: leagues.season }).from(leagues).where(inArray(leagues.id, ids));
    const team = await seriesTeamOf(db, tenantId, ids);
    return {
      season: series.length ? Math.max(...series.map((r) => r.season)) : null,
      team: team ? { id: team.id, externalId: team.externalId, name: team.name } : null,
    };
  }
  // No series: the first championship chosen in «Club» with a team.
  const [team] = await db
    .select({ id: leagueTeams.id, externalId: leagueTeams.externalId, name: leagueTeams.name, season: leagues.season })
    .from(tenantLeagues)
    .innerJoin(leagueTeams, eq(leagueTeams.id, tenantLeagues.leagueTeamId))
    .innerJoin(leagues, eq(leagues.id, tenantLeagues.leagueId))
    .where(tenantScope(tenantLeagues, tenantId))
    .orderBy(asc(tenantLeagues.createdAt))
    .limit(1);
  return {
    season: team?.season ?? null,
    team: team ? { id: team.id, externalId: team.externalId, name: team.name } : null,
  };
}

/** Seasons with a roster (newest first). */
export async function rosterSeasons(db: Db | Tx, tenantId: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ season: players.season })
    .from(players)
    .where(tenantScope(players, tenantId))
    .orderBy(desc(players.season));
  return rows.map((r) => r.season);
}

type AssetLite = { id: string; mime: string; name: string | null };
/** A file of a player with the overlays that show it (`player_media.events`). */
type MediaLite = AssetLite & { events: unknown };

/** Pure: the overlays of a file from the jsonb `player_media.events`; a malformed value reads as none. */
export const overlayKindsOf = (events: unknown): OverlayPlayerKind[] =>
  Array.isArray(events)
    ? events.filter((k): k is OverlayPlayerKind => typeof k === 'string' && isOverlayPlayerKind(k))
    : [];

/**
 * Pure: the photo and video of each overlay of a player from its files (`events` of each file: an image is the photo,
 * a video the video; the first file in order wins, the routes never write two).
 */
export function eventMediaOf(files: readonly MediaLite[]): Record<OverlayPlayerKind, PlayerEventMedia> {
  const out = noPlayerEvents();
  for (const f of files)
    for (const kind of overlayKindsOf(f.events)) {
      const field = isVideoMime(f.mime) ? 'videoAssetId' : 'photoAssetId';
      out[kind][field] ??= f.id;
    }
  return out;
}

const itemOf = (a: AssetLite): PlayerMediaItem => ({
  assetId: a.id,
  url: adminAssetPath(a.id),
  video: isVideoMime(a.mime),
  name: a.name,
});

/** Photos and videos of the players `ids`, in their order, by player. */
async function mediaOf(db: Db | Tx, tenantId: string, ids: string[]): Promise<Map<string, MediaLite[]>> {
  const out = new Map<string, MediaLite[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      playerId: playerMedia.playerId,
      id: assets.id,
      mime: assets.mime,
      name: assets.name,
      events: playerMedia.events,
    })
    .from(playerMedia)
    .innerJoin(assets, eq(assets.id, playerMedia.assetId))
    .where(tenantScope(playerMedia, tenantId, inArray(playerMedia.playerId, ids)))
    .orderBy(asc(playerMedia.position));
  for (const r of rows) out.set(r.playerId, [...(out.get(r.playerId) ?? []), r]);
  return out;
}

async function photosOf(db: Db | Tx, tenantId: string, rows: PlayerRow[]): Promise<Map<string, AssetLite>> {
  const ids = rows.flatMap((r) => (r.photoAssetId ? [r.photoAssetId] : []));
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: assets.id, mime: assets.mime, name: assets.name })
    .from(assets)
    .where(tenantScope(assets, tenantId, inArray(assets.id, ids)));
  return new Map(found.map((a) => [a.id, a]));
}

const playerOf = (r: PlayerRow, photo: AssetLite | undefined, media: MediaLite[]): Player => ({
  id: r.id,
  season: r.season,
  number: r.number,
  firstName: r.firstName,
  lastName: r.lastName,
  role: r.role,
  birthYear: r.birthYear,
  heightCm: r.heightCm,
  birthplace: r.birthplace,
  nationality: r.nationality,
  source: r.source,
  externalKey: r.externalKey,
  editedFields: r.editedFields.filter(isEditable),
  photo: photo ? itemOf(photo) : null,
  media: media.map(itemOf),
  events: eventMediaOf(media),
  removed: r.removedAt !== null,
  position: r.position,
});

/** The roster of a season of a client (the removed players too, marked), in order. */
export async function listPlayers(db: Db | Tx, tenantId: string, season: number): Promise<Player[]> {
  const rows = await db
    .select()
    .from(players)
    .where(tenantScope(players, tenantId, eq(players.season, season)))
    .orderBy(...ORDER);
  const [photos, media] = await Promise.all([
    photosOf(db, tenantId, rows),
    mediaOf(
      db,
      tenantId,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) => playerOf(r, r.photoAssetId ? photos.get(r.photoAssetId) : undefined, media.get(r.id) ?? []));
}

/** One player of a client; null when it is not one of the client. */
export async function findPlayer(db: Db | Tx, tenantId: string, id: string): Promise<Player | null> {
  const [row] = await db
    .select()
    .from(players)
    .where(tenantScope(players, tenantId, eq(players.id, id)))
    .limit(1);
  if (!row) return null;
  const [photos, media] = await Promise.all([photosOf(db, tenantId, [row]), mediaOf(db, tenantId, [row.id])]);
  return playerOf(row, row.photoAssetId ? photos.get(row.photoAssetId) : undefined, media.get(row.id) ?? []);
}

/**
 * Photos and videos of the players of the current season of a client for the public pages, by shirt number: only the
 * players in the roster (not removed) with a main photo or a file chosen for an overlay; of the others files only the
 * ones chosen for an overlay (the public pages need nothing else).
 */
export async function publicPlayerMedia(db: Db, tenantId: string): Promise<PublicPlayerMedia[]> {
  const { season } = await rosterContext(db, tenantId);
  if (season === null) return [];
  const rows = await db
    .select()
    .from(players)
    .where(tenantScope(players, tenantId, eq(players.season, season), isNull(players.removedAt)))
    .orderBy(asc(players.number));
  const [photos, media] = await Promise.all([
    photosOf(db, tenantId, rows),
    mediaOf(
      db,
      tenantId,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.flatMap((r) => {
    const photo = r.photoAssetId ? photos.get(r.photoAssetId) : undefined;
    const events = publicPlayerEvents(eventMediaOf(media.get(r.id) ?? []));
    const main = photo && !isVideoMime(photo.mime) ? photo.id : null;
    if (!main && Object.keys(events).length === 0) return [];
    // For the pages opened before the media of each overlay (old schema, `images` and `videos` required).
    const chosen = Object.values(events);
    const once = (ids: (string | null)[]): string[] => [...new Set(ids.filter((id): id is string => id !== null))];
    return [
      {
        number: r.number,
        photo: main,
        events,
        images: once(chosen.map((e) => e.photo)),
        videos: once(chosen.map((e) => e.video)),
      },
    ];
  });
}

/** Role of the simulator (`tools/dvw-simulator`) of each role of the roster. */
const SIMULATOR_ROLE: Record<PlayerRole, Role> = {
  setter: 'S',
  opposite: 'O',
  outside: 'H',
  middle: 'M',
  libero: 'L',
};

/**
 * The roster of the current season of a client for a generated match of the simulation: the players not removed, in
 * the order of «Squadra», with number, names and role (null: not known, the simulator chooses it).
 */
export async function simulationRoster(db: Db | Tx, tenantId: string): Promise<RosterPlayer[]> {
  const { season } = await rosterContext(db, tenantId);
  if (season === null) return [];
  const rows = await db
    .select({ number: players.number, lastName: players.lastName, firstName: players.firstName, role: players.role })
    .from(players)
    .where(tenantScope(players, tenantId, eq(players.season, season), isNull(players.removedAt)))
    .orderBy(...ORDER);
  return rows.map((r) => ({ ...r, role: r.role ? SIMULATOR_ROLE[r.role] : null }));
}

/**
 * The players of a client that use a file (main photo or other media); `events`: the overlays of the player that show
 * it (empty: not chosen for an overlay).
 */
export async function playersUsingAsset(
  db: Db | Tx,
  tenantId: string,
  assetId: string,
): Promise<(PlayerRow & { events: OverlayPlayerKind[] })[]> {
  const byMedia = await db
    .select({ p: players, events: playerMedia.events })
    .from(playerMedia)
    .innerJoin(players, eq(players.id, playerMedia.playerId))
    .where(tenantScope(playerMedia, tenantId, eq(playerMedia.assetId, assetId)));
  const byPhoto = await db
    .select()
    .from(players)
    .where(tenantScope(players, tenantId, eq(players.photoAssetId, assetId)));
  // The ones that show it in an overlay first: their reason is the most precise.
  const all = [
    ...byMedia
      .map((m) => ({ ...m.p, events: overlayKindsOf(m.events) }))
      .sort((a, b) => b.events.length - a.events.length),
    ...byPhoto.map((p) => ({ ...p, events: [] })),
  ];
  return all.filter((p, i) => all.findIndex((q) => q.id === p.id) === i);
}

// --- Import from the site of the league ---------------------------------------------------------------------

/** A player of the roster as `mergeRoster` sees it. */
export type ExistingPlayer = Pick<
  PlayerRow,
  | 'id'
  | 'number'
  | 'firstName'
  | 'lastName'
  | 'role'
  | 'birthYear'
  | 'heightCm'
  | 'birthplace'
  | 'nationality'
  | 'externalKey'
  | 'source'
  | 'editedFields'
  | 'removedAt'
>;

/** Data fields of a player that an import may update (never the ones in `edited_fields`). */
const DATA_FIELDS = [
  'number',
  'firstName',
  'lastName',
  'role',
  'birthYear',
  'heightCm',
  'birthplace',
  'nationality',
] as const satisfies readonly PlayerEditableField[];

export interface PlayerChanges {
  number?: number;
  firstName?: string;
  lastName?: string;
  role?: PlayerRole | null;
  birthYear?: number | null;
  heightCm?: number | null;
  birthplace?: string | null;
  nationality?: string | null;
  externalKey?: string;
  source?: 'league';
  editedFields?: PlayerEditableField[];
}

export interface RosterMerge {
  inserts: ParsedRosterPlayer[];
  /** In this order; `renumbered`: the number changes (written after all the numbers changed are freed). */
  updates: { id: string; set: PlayerChanges; renumbered: boolean }[];
  unchanged: number;
  skipped: SkippedPlayer[];
  notOnSite: { id: string; number: number; name: string }[];
}

const fullName = (p: { firstName: string; lastName: string }): string => `${p.lastName} ${p.firstName}`;

/**
 * Pure: how the players of the site enter the roster. A player is the same by its key on the site; otherwise a player
 * added by hand with the same number and surname (case and accents ignored) is adopted (it takes the key: its data
 * stay as they are, as changed by hand). Only the fields not changed by hand are updated; a removed player stays
 * removed. Numbers: the changes of the site are applied together (two players may swap their numbers); a change to a
 * number that another player keeps, and a new player with a number in use, are skipped with the reason. The players no
 * longer on the site are never deleted (`notOnSite`); at most PLAYERS_MAX players in the roster. The updates with a
 * new number are `renumbered`: the route frees their numbers before writing them.
 */
export function mergeRoster(existing: readonly ExistingPlayer[], site: readonly ParsedRosterPlayer[]): RosterMerge {
  const out: RosterMerge = { inserts: [], updates: [], unchanged: 0, skipped: [], notOnSite: [] };
  const matched = new Map<string, ParsedRosterPlayer>();
  const changes: { ex: ExistingPlayer; sp: ParsedRosterPlayer; set: PlayerChanges }[] = [];
  const fresh: ParsedRosterPlayer[] = [];
  const taken = new Set<string>();
  for (const sp of site) {
    let ex = existing.find((e) => e.externalKey === sp.key);
    let adopted = false;
    if (!ex) {
      ex = existing.find(
        (e) =>
          e.externalKey === null &&
          e.removedAt === null &&
          !taken.has(e.id) &&
          e.number === sp.number &&
          normalizeTeamText(e.lastName) === normalizeTeamText(sp.lastName),
      );
      adopted = ex !== undefined;
    }
    if (!ex) {
      fresh.push(sp);
      continue;
    }
    taken.add(ex.id);
    matched.set(ex.id, sp);
    if (ex.removedAt !== null) {
      out.unchanged++;
      continue;
    }
    const set: PlayerChanges = {};
    if (adopted) {
      // Its data were written by hand: they stay, the empty ones are filled from the site.
      const kept = DATA_FIELDS.filter((f) => ex[f] !== null);
      set.externalKey = sp.key;
      set.source = 'league';
      set.editedFields = [...new Set([...ex.editedFields.filter(isEditable), ...kept])];
      for (const f of DATA_FIELDS) if (ex[f] === null && sp[f] !== null) Object.assign(set, { [f]: sp[f] });
    } else {
      const edited = new Set<string>(ex.editedFields);
      for (const f of DATA_FIELDS) if (!edited.has(f) && ex[f] !== sp[f]) Object.assign(set, { [f]: sp[f] });
    }
    changes.push({ ex, sp, set });
  }
  // Final numbers of the active players: a change is kept only if nobody else ends with the same number.
  const active = existing.filter((e) => e.removedAt === null);
  const target = new Map<string, number>();
  for (const c of changes) if (c.set.number !== undefined) target.set(c.ex.id, c.set.number);
  for (let changed = true; changed;) {
    changed = false;
    const holders = new Map<number, ExistingPlayer[]>();
    for (const e of active) {
      const n = target.get(e.id) ?? e.number;
      holders.set(n, [...(holders.get(n) ?? []), e]);
    }
    for (const [n, list] of holders) {
      if (list.length < 2) continue;
      for (const e of list) {
        if (!target.has(e.id)) continue;
        target.delete(e.id);
        changed = true;
        const keeper = list.find((o) => o.id !== e.id);
        const sp = matched.get(e.id);
        out.skipped.push({
          number: n,
          name: sp ? fullName(sp) : fullName(e),
          reason: `numero ${n} già usato da ${keeper ? fullName(keeper) : 'un altro giocatore'}: il numero non è cambiato`,
        });
      }
    }
  }
  const finalOwner = new Map<number, string>();
  for (const e of active) finalOwner.set(target.get(e.id) ?? e.number, fullName(e));
  for (const c of changes) {
    if (c.set.number !== undefined && !target.has(c.ex.id)) delete c.set.number;
    if (Object.keys(c.set).length > 0)
      out.updates.push({ id: c.ex.id, set: c.set, renumbered: c.set.number !== undefined });
    else out.unchanged++;
  }
  let count = active.length;
  for (const sp of fresh) {
    const owner = finalOwner.get(sp.number);
    if (owner) {
      out.skipped.push({ number: sp.number, name: fullName(sp), reason: `numero ${sp.number} già usato da ${owner}` });
      continue;
    }
    if (count >= PLAYERS_MAX) {
      out.skipped.push({ number: sp.number, name: fullName(sp), reason: `rosa piena (al massimo ${PLAYERS_MAX})` });
      continue;
    }
    out.inserts.push(sp);
    finalOwner.set(sp.number, fullName(sp));
    count++;
  }
  const keys = new Set(site.map((s) => s.key));
  for (const e of existing)
    if (e.externalKey !== null && e.removedAt === null && !keys.has(e.externalKey))
      out.notOnSite.push({ id: e.id, number: e.number, name: fullName(e) });
  return out;
}

/** The fields of a change of a player taken by hand from now on (`photo` for the main photo). */
export const editedAfter = (
  current: readonly string[],
  fields: readonly PlayerEditableField[],
): PlayerEditableField[] => [...new Set([...current.filter(isEditable), ...fields])];
