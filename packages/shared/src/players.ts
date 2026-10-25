import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { LeagueSeasonSchema } from './leagues.js';
import type { OverlayPlayerKind } from './overlays.js';
import { OVERLAY_PLAYER_KINDS, OverlayPlayerKindSchema } from './overlays.js';
import { plainText } from './strings.js';

/**
 * «Squadra»: the roster of the team of the client in a season (`players`), imported from the site of the league and then
 * edited by hand, with a main photo and other photos and videos of the library for each player (`player_media`), and
 * among them the photo and the video of each overlay of an action of the player (ACE!, Muro, Cambio:
 * OVERLAY_PLAYER_KINDS). The players of the roster are matched to the ones of the scout file by shirt number.
 */

/** Id of a player of the roster (row of `players`). */
export const PlayerIdSchema = z.uuid();

export const PLAYER_ROLES = ['setter', 'outside', 'middle', 'opposite', 'libero'] as const;
export const PlayerRoleSchema = z.enum(PLAYER_ROLES);
export type PlayerRole = z.infer<typeof PlayerRoleSchema>;

/** Italian names of the roles, as on the site of the league. */
export const PLAYER_ROLE_LABELS: Record<PlayerRole, string> = {
  outside: 'Schiacciatore',
  setter: 'Palleggiatore',
  middle: 'Centrale',
  opposite: 'Opposto',
  libero: 'Libero',
};

const ROLE_WORDS: readonly [string, PlayerRole][] = [
  ['palleggiatore', 'setter'],
  ['alzatore', 'setter'],
  ['schiacciatore', 'outside'],
  ['banda', 'outside'],
  ['centrale', 'middle'],
  ['opposto', 'opposite'],
  ['libero', 'libero'],
];

/** Pure: the role from the text of the site of the league («Schiacciatore»); null when not recognized. */
export function roleFromLeague(text: string): PlayerRole | null {
  const t = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return ROLE_WORDS.find(([word]) => t.includes(word))?.[1] ?? null;
}

/** Most players of a roster (also of an import from the site). */
export const PLAYERS_MAX = 40;
/** Most photos and videos of one player besides the main photo, and of them videos. */
export const PLAYER_MEDIA_MAX = 12;
export const PLAYER_VIDEOS_MAX = 3;

export const PLAYER_NAME_MAX = 60;
export const PLAYER_BIRTHPLACE_MAX = 60;
export const PLAYER_HEIGHT_MIN = 120;
export const PLAYER_HEIGHT_MAX = 250;
export const PLAYER_BIRTH_YEAR_MIN = 1900;
export const PLAYER_BIRTH_YEAR_MAX = 2100;

export const PlayerNumberSchema = z.int().min(0).max(99);
export const PlayerNameSchema = plainText(PLAYER_NAME_MAX);
/** Sports nationality, the code of the site (ITA, FRA, IRI): 1 to 3 capital letters. */
export const PlayerNationalitySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{1,3}$/));

/** Origin of a player: imported from the site of the league, or added by hand. */
export const PLAYER_SOURCES = ['league', 'manual'] as const;
export type PlayerSource = (typeof PLAYER_SOURCES)[number];

/** Fields changed by hand: a new import from the site never overwrites them (`photo`: the main photo). */
export const PLAYER_EDITABLE_FIELDS = [
  'number',
  'firstName',
  'lastName',
  'role',
  'birthYear',
  'heightCm',
  'birthplace',
  'nationality',
  'photo',
] as const;
export type PlayerEditableField = (typeof PLAYER_EDITABLE_FIELDS)[number];
export const PlayerEditableFieldSchema = z.enum(PLAYER_EDITABLE_FIELDS);

/** A photo or video of the library given to a player (`url`: path of the reserved area). */
export const PlayerMediaItemSchema = z.object({
  assetId: AssetIdSchema,
  url: z.string(),
  video: z.boolean(),
  name: z.string().nullable(),
});
export type PlayerMediaItem = z.infer<typeof PlayerMediaItemSchema>;

/**
 * Photo and video of a player for the overlay of one of its actions: files among its other photos and videos (null:
 * none, the overlay uses the main photo and no video).
 */
export const PlayerEventMediaSchema = z.object({
  photoAssetId: AssetIdSchema.nullable(),
  videoAssetId: AssetIdSchema.nullable(),
});
export type PlayerEventMedia = z.infer<typeof PlayerEventMediaSchema>;

/** Pure: no photo nor video chosen for any overlay. */
export const noPlayerEvents = (): Record<OverlayPlayerKind, PlayerEventMedia> =>
  Object.fromEntries(OVERLAY_PLAYER_KINDS.map((k) => [k, { photoAssetId: null, videoAssetId: null }])) as Record<
    OverlayPlayerKind,
    PlayerEventMedia
  >;

export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  season: LeagueSeasonSchema,
  number: PlayerNumberSchema,
  firstName: z.string(),
  lastName: z.string(),
  role: PlayerRoleSchema.nullable(),
  birthYear: z.int().nullable(),
  heightCm: z.int().nullable(),
  birthplace: z.string().nullable(),
  nationality: z.string().nullable(),
  source: z.enum(PLAYER_SOURCES),
  /** Key of the player on the site of the league (`HEN-MAT-05`), null for the ones added by hand. */
  externalKey: z.string().nullable(),
  editedFields: z.array(PlayerEditableFieldSchema),
  /** Main photo, null when none. */
  photo: PlayerMediaItemSchema.nullable(),
  /** Other photos and videos, in their order. */
  media: z.array(PlayerMediaItemSchema),
  /** Photo and video of each overlay of an action of the player, among `media`. */
  events: z.record(OverlayPlayerKindSchema, PlayerEventMediaSchema),
  /** Taken out of the roster (only the imported ones: the ones added by hand are deleted). */
  removed: z.boolean(),
  position: z.int(),
});
export type Player = z.infer<typeof PlayerSchema>;

/** State of the download of the photos of the last import (one at a time per client, in the background). */
export const RosterImportStateSchema = z.object({
  running: z.boolean(),
  photosDone: z.int().nonnegative(),
  photosTotal: z.int().nonnegative(),
  /** End of the last import; null when none since the server started. */
  lastAt: z.iso.datetime().nullable(),
  /** Why the last import or its photos stopped; null when fine. */
  lastError: z.string().nullable(),
});
export type RosterImportState = z.infer<typeof RosterImportStateSchema>;

/** `GET /api/admin/roster?season=`: the roster of a season (default: the one of the series of the club). */
export const RosterResponseSchema = z.object({
  /** Season shown; null when the club has no series yet and no roster. */
  season: LeagueSeasonSchema.nullable(),
  /** Seasons with a roster, the current one included, newest first. */
  seasons: z.array(LeagueSeasonSchema),
  /** Team of the club on the site of the league (the import reads its page); null when not chosen in «Club». */
  team: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  players: z.array(PlayerSchema),
  import: RosterImportStateSchema,
});
export type RosterResponse = z.infer<typeof RosterResponseSchema>;

export const RosterQuerySchema = z.strictObject({ season: z.coerce.number().pipe(LeagueSeasonSchema).optional() });

const playerFields = {
  number: PlayerNumberSchema,
  firstName: PlayerNameSchema,
  lastName: PlayerNameSchema,
  role: PlayerRoleSchema.nullable(),
  birthYear: z.int().min(PLAYER_BIRTH_YEAR_MIN).max(PLAYER_BIRTH_YEAR_MAX).nullable(),
  heightCm: z.int().min(PLAYER_HEIGHT_MIN).max(PLAYER_HEIGHT_MAX).nullable(),
  birthplace: plainText(PLAYER_BIRTHPLACE_MAX).nullable(),
  nationality: PlayerNationalitySchema.nullable(),
};

/** `POST /api/admin/roster/players`: a player added by hand to the roster of the current season. */
export const CreatePlayerRequestSchema = z.strictObject({
  number: playerFields.number,
  firstName: playerFields.firstName,
  lastName: playerFields.lastName,
  role: playerFields.role.default(null),
  birthYear: playerFields.birthYear.default(null),
  heightCm: playerFields.heightCm.default(null),
  birthplace: playerFields.birthplace.default(null),
  nationality: playerFields.nationality.default(null),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

/**
 * `PATCH /api/admin/roster/players/:id`: only the fields sent change (and become «changed by hand»); `removed: false`
 * puts a removed player back in the roster. At least one field.
 */
export const UpdatePlayerRequestSchema = z
  .strictObject({
    number: playerFields.number.optional(),
    firstName: playerFields.firstName.optional(),
    lastName: playerFields.lastName.optional(),
    role: playerFields.role.optional(),
    birthYear: playerFields.birthYear.optional(),
    heightCm: playerFields.heightCm.optional(),
    birthplace: playerFields.birthplace.optional(),
    nationality: playerFields.nationality.optional(),
    removed: z.literal(false).optional(),
  })
  .refine((r) => Object.values(r).some((v) => v !== undefined), { message: 'niente da cambiare' });
export type UpdatePlayerRequest = z.infer<typeof UpdatePlayerRequestSchema>;

/**
 * `PUT /api/admin/roster/players/:id/media`: the main photo (an image of the library, null: none) and the other photos
 * and videos (files of the library of kind `player`, each once, at most PLAYER_MEDIA_MAX, of them PLAYER_VIDEOS_MAX
 * videos), in order; `events`: the photo (an image) and the video (a video) of each overlay of an action of the player,
 * only among `mediaIds` (a missing overlay: none). Without `events` the choices of the files that stay are kept.
 */
export const PlayerMediaRequestSchema = z
  .strictObject({
    photoAssetId: AssetIdSchema.nullable(),
    mediaIds: z
      .array(AssetIdSchema)
      .max(PLAYER_MEDIA_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'file ripetuto' }),
    events: z
      .partialRecord(
        OverlayPlayerKindSchema,
        z.strictObject({
          photoAssetId: AssetIdSchema.nullable().default(null),
          videoAssetId: AssetIdSchema.nullable().default(null),
        }),
      )
      .optional(),
  })
  .superRefine((r, ctx) => {
    const ids = new Set(r.mediaIds);
    for (const [kind, choice] of Object.entries(r.events ?? {}))
      for (const field of ['photoAssetId', 'videoAssetId'] as const) {
        const id = choice[field];
        if (id !== null && !ids.has(id))
          ctx.addIssue({ code: 'custom', path: ['events', kind, field], message: 'file non abbinato al giocatore' });
      }
  });
export type PlayerMediaRequest = z.infer<typeof PlayerMediaRequestSchema>;
export type PlayerMediaRequestInput = z.input<typeof PlayerMediaRequestSchema>;

/** A player of the site not added by the import, and why. */
export const SkippedPlayerSchema = z.object({ number: z.int(), name: z.string(), reason: z.string() });
export type SkippedPlayer = z.infer<typeof SkippedPlayerSchema>;

/** `POST /api/admin/roster/import`: what the import from the site of the league did (the photos come later). */
export const ImportRosterResponseSchema = z.object({
  season: LeagueSeasonSchema,
  added: z.int().nonnegative(),
  updated: z.int().nonnegative(),
  unchanged: z.int().nonnegative(),
  skipped: z.array(SkippedPlayerSchema),
  /** Players of the roster no longer on the site: never deleted, the club decides. */
  notOnSite: z.array(z.object({ id: PlayerIdSchema, number: z.int(), name: z.string() })),
  /** Photos to download in the background. */
  photosQueued: z.int().nonnegative(),
});
export type ImportRosterResponse = z.infer<typeof ImportRosterResponseSchema>;

/**
 * Photos and videos of a player of the roster for the public pages (only the players with at least one, of the current
 * season), by shirt number: the main photo and the photo and video chosen for each overlay of an action of the player
 * (missing overlay: none). The overlays of an action of our team show them (see `playerBackground`).
 */
export const PublicPlayerMediaSchema = z.object({
  number: PlayerNumberSchema,
  photo: AssetIdSchema.nullable(),
  events: z
    .partialRecord(
      OverlayPlayerKindSchema,
      z.object({ photo: AssetIdSchema.nullable(), video: AssetIdSchema.nullable() }),
    )
    .default({}),
  /**
   * Old fields, only for the public pages opened before the media of each overlay (they show the first one): the photos
   * and the videos chosen for an overlay, each once. To be removed in a later release.
   */
  images: z.array(AssetIdSchema).optional(),
  videos: z.array(AssetIdSchema).optional(),
});
export type PublicPlayerMedia = z.infer<typeof PublicPlayerMediaSchema>;

/** Pure: the photo and video of each overlay of a player as the public pages have them (only the overlays with one). */
export function publicPlayerEvents(events: Record<OverlayPlayerKind, PlayerEventMedia>): PublicPlayerMedia['events'] {
  const out: PublicPlayerMedia['events'] = {};
  for (const kind of OVERLAY_PLAYER_KINDS) {
    const { photoAssetId, videoAssetId } = events[kind];
    if (photoAssetId || videoAssetId) out[kind] = { photo: photoAssetId, video: videoAssetId };
  }
  return out;
}
