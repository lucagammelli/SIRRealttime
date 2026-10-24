import type { MatchEvent, MatchEventKind, Side } from '@arenalive/volley-stats';
import { MATCH_EVENT_KINDS, MATCH_EVENT_PRIORITY } from '@arenalive/volley-stats';
import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { TENANT_CONFIG_VERSION } from './configVersion.js';
import type { LayoutDevice } from './layout.js';
import type { PublicPlayerMedia } from './players.js';
import { plainText } from './strings.js';

/**
 * Overlays of the public page chosen by a client (jsonb `tenants.overlays`): short messages shown over the page for a
 * few seconds when an event of the match happens (`MatchState.events`, detected by `@arenalive/volley-stats` from the scout
 * lines only). For every kind of event: on/off, a plain text with controlled placeholders (never HTML), how many
 * seconds it stays, the devices that show it and its priority (the higher one is shown first).
 */

/** Kinds of event that can have an overlay: the events of `@arenalive/volley-stats`. */
export const OVERLAY_KINDS = MATCH_EVENT_KINDS;
export type OverlayKind = MatchEventKind;

/**
 * Placeholders of an overlay text, closed list (anything else between braces is refused):
 * `{giocatore}` name of the player, `{numero}` shirt number, `{squadra}` team of the event, `{punteggio}` score of the
 * set (home-away), `{set}` number of the set, `{serie}` points in a row (run), `{attacchi}` attacks of a long rally.
 * A placeholder without a value for the event (no player, no run) becomes empty.
 */
export const OVERLAY_PLACEHOLDERS = [
  'giocatore',
  'numero',
  'squadra',
  'punteggio',
  'set',
  'serie',
  'attacchi',
] as const;
export type OverlayPlaceholder = (typeof OVERLAY_PLACEHOLDERS)[number];

/** Seconds an overlay stays on screen: limits and default. */
export const OVERLAY_MIN_SECONDS = 2;
export const OVERLAY_MAX_SECONDS = 8;
export const OVERLAY_DEFAULT_SECONDS = 4;
/** Priority of an overlay: 1 (least important) to 10. */
export const OVERLAY_MIN_PRIORITY = 1;
export const OVERLAY_MAX_PRIORITY = 10;
/** Longest overlay text (placeholders included). */
export const OVERLAY_TEXT_MAX = 80;

/** Where an overlay appears on the page and how big it is (general setting, optional override for each overlay). */
export const OVERLAY_POSITIONS = ['top', 'center', 'bottom'] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];
export const OVERLAY_SIZES = ['small', 'medium', 'large'] as const;
export type OverlaySize = (typeof OVERLAY_SIZES)[number];
/** Defaults: the look before the setting existed (near the top, medium). */
export const OVERLAY_DEFAULT_POSITION: OverlayPosition = 'top';
export const OVERLAY_DEFAULT_SIZE: OverlaySize = 'medium';

const PLACEHOLDER = /\{([^{}]*)\}/g;

/**
 * Pure: the problem of an overlay text, null when it is fine. Refused: a placeholder not in OVERLAY_PLACEHOLDERS, a
 * brace outside a placeholder, the characters `<` and `>` (no HTML, not even as text).
 */
export function overlayTextProblem(text: string): string | null {
  if (/[<>]/.test(text)) return 'i caratteri < e > non sono ammessi';
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    if (!(OVERLAY_PLACEHOLDERS as readonly string[]).includes(name)) return `segnaposto sconosciuto: {${name}}`;
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) return 'parentesi graffa senza segnaposto';
  return null;
}

/** Text of an overlay: single line plain text with only the placeholders of the list. */
export const OverlayTextSchema = plainText(OVERLAY_TEXT_MAX).superRefine((text, ctx) => {
  const problem = overlayTextProblem(text);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/**
 * Pure: `template` with every placeholder replaced by its value (missing value: empty), spaces collapsed and trimmed.
 * The result is plain text: the portal shows it as text, never as HTML.
 */
export function fillOverlayText(template: string, values: Partial<Record<OverlayPlaceholder, string>>): string {
  return template
    .replace(PLACEHOLDER, (_, name: string) =>
      Object.hasOwn(values, name) ? (values[name as OverlayPlaceholder] ?? '') : '',
    )
    .replace(/\s+/g, ' ')
    .replace(/\s+([!?.,:;])/g, '$1')
    .trim();
}

/** Kinds of background of an overlay: an image or a video of the client (asset of kind `overlay`). */
export const OVERLAY_BACKGROUND_KINDS = ['image', 'video'] as const;
export type OverlayBackgroundKind = (typeof OVERLAY_BACKGROUND_KINDS)[number];

/** Where a video background plays: in the box of the overlay (as before the setting existed) or on the whole screen. */
export const OVERLAY_VIDEO_FITS = ['center', 'fullscreen'] as const;
export type OverlayVideoFit = (typeof OVERLAY_VIDEO_FITS)[number];

/**
 * How long an overlay with a video lasts: `seconds` (the seconds of the overlay, the video loops: as before the setting
 * existed) or `video` (until the video ends, played once, at most OVERLAY_VIDEO_MAX_SECONDS; the seconds of the overlay
 * when the length of the video cannot be read, the video does not start, on the phone and with reduced motion).
 */
export const OVERLAY_VIDEO_DURATIONS = ['seconds', 'video'] as const;
export type OverlayVideoDuration = (typeof OVERLAY_VIDEO_DURATIONS)[number];
/** Longest an overlay lasts when it follows its video. */
export const OVERLAY_VIDEO_MAX_SECONDS = 30;

/**
 * Events whose overlay shows the video: only those of our team (the team of the client, at home or away; also the
 * ones of no team, as a tie), or those of both teams. For an event of the opponent with `ours` the overlay comes out
 * without the video (text only).
 */
export const OVERLAY_VIDEO_TEAMS = ['ours', 'both'] as const;
export type OverlayVideoTeams = (typeof OVERLAY_VIDEO_TEAMS)[number];

/**
 * Background of an overlay, shown behind its text: an uploaded image or video of the client (the server checks that
 * the asset is of the client and that its type is the one of `kind`). `audio`, `fit`, `teams` and `duration` are the
 * options of a video (an image ignores them); missing in a document saved before them: muted, in the box, our team only,
 * for the seconds of the overlay.
 */
export const OverlayBackgroundSchema = z.strictObject({
  kind: z.enum(OVERLAY_BACKGROUND_KINDS),
  assetId: AssetIdSchema,
  /** The video plays with its sound (a browser that refuses plays it muted). */
  audio: z.boolean().default(false),
  fit: z.enum(OVERLAY_VIDEO_FITS).default('center'),
  teams: z.enum(OVERLAY_VIDEO_TEAMS).default('ours'),
  duration: z.enum(OVERLAY_VIDEO_DURATIONS).default('seconds'),
});
export type OverlayBackground = z.output<typeof OverlayBackgroundSchema>;
export type OverlayBackgroundInput = z.input<typeof OverlayBackgroundSchema>;

/**
 * Pure: the background of an overlay for an event of `team` (null: of no team) when our team plays on `ourSide`: a
 * video set for our team only is dropped for an event of the opponent (undefined: text only). With `ourSide` unknown
 * (null: no team of the client in the match) the video stays, as for both teams; an image always stays.
 */
export function backgroundForTeam(
  background: OverlayBackground | undefined,
  team: Side | null,
  ourSide: Side | null,
): OverlayBackground | undefined {
  if (!background) return undefined;
  const opponent = team !== null && ourSide !== null && team !== ourSide;
  if (background.kind === 'video' && background.teams === 'ours' && opponent) return undefined;
  return background;
}

/** Overlays of an action of one player (ace, block, substitution: who comes in): they can show its photo or video. */
export const OVERLAY_PLAYER_KINDS = ['ace', 'block', 'substitution'] as const satisfies readonly MatchEventKind[];
export type OverlayPlayerKind = (typeof OVERLAY_PLAYER_KINDS)[number];
export const isOverlayPlayerKind = (kind: string): kind is OverlayPlayerKind =>
  (OVERLAY_PLAYER_KINDS as readonly string[]).includes(kind);

/** What the overlay of an action of a player of our team shows: its photo or its video. */
export const OVERLAY_PLAYER_SOURCES = ['photo', 'video'] as const;
/** Which one: the main one (main photo, first video) or one at random. */
export const OVERLAY_PLAYER_PICKS = ['default', 'random'] as const;

/**
 * Photo or video of the player of our team behind the overlay of its action (OVERLAY_PLAYER_KINDS), from the roster
 * («Squadra»); `audio`, `fit` and `duration` as for a video background. Missing (the documents saved before): the fixed
 * background of the overlay.
 */
export const OverlayPlayerMediaSchema = z.strictObject({
  source: z.enum(OVERLAY_PLAYER_SOURCES),
  pick: z.enum(OVERLAY_PLAYER_PICKS).default('default'),
  audio: z.boolean().default(false),
  fit: z.enum(OVERLAY_VIDEO_FITS).default('center'),
  duration: z.enum(OVERLAY_VIDEO_DURATIONS).default('seconds'),
});
export type OverlayPlayerMedia = z.output<typeof OverlayPlayerMediaSchema>;

/** Pure: a number 0..n-1 from a text (FNV-1a), the same for the same text: the «random» pick of an event never changes. */
function seededIndex(text: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return n > 0 ? h % n : 0;
}

/**
 * Pure: the photo or video of the player of an event behind its overlay, as a background: only for the overlays of
 * OVERLAY_PLAYER_KINDS with `playerMedia`, an event of a player of our team (`ourSide` known) and a player of the roster
 * with that shirt number. A video only when `videos` (not on the phone nor with reduced motion) and the player has one,
 * otherwise its photo; `random` picks with a seed from the id of the event. undefined when there is nothing: the fixed
 * background of the overlay (or the text only) is used.
 */
export function playerBackground(
  overlay: { playerMedia?: OverlayPlayerMedia | undefined },
  event: Pick<MatchEvent, 'id' | 'kind' | 'team' | 'player'>,
  ourSide: Side | null,
  players: readonly PublicPlayerMedia[],
  options: { videos: boolean },
): OverlayBackground | undefined {
  const pm = overlay.playerMedia;
  if (!pm || !isOverlayPlayerKind(event.kind) || !event.player || ourSide === null || event.team !== ourSide)
    return undefined;
  const number = event.player.number;
  const player = players.find((p) => p.number === number);
  if (!player) return undefined;
  const pick = (ids: readonly string[]): string | undefined =>
    pm.pick === 'random' ? ids[seededIndex(event.id, ids.length)] : ids[0];
  const common = { audio: pm.audio, fit: pm.fit, teams: 'ours' as const };
  if (pm.source === 'video' && options.videos) {
    const video = pick(player.videos);
    if (video) return { kind: 'video', assetId: video, ...common, duration: pm.duration };
  }
  const photos = player.photo ? [player.photo, ...player.images] : player.images;
  const photo = pick(photos);
  return photo ? { kind: 'image', assetId: photo, ...common, duration: 'seconds' } : undefined;
}

interface OverlayDefaults {
  enabled: boolean;
  text: string;
  devices: Record<LayoutDevice, boolean>;
}

const ALL: Record<LayoutDevice, boolean> = { tv: true, tablet: true, phone: true };
const LARGE: Record<LayoutDevice, boolean> = { tv: true, tablet: true, phone: false };

/**
 * Defaults: every event on, on every device, for OVERLAY_DEFAULT_SECONDS, with the priority of `@arenalive/volley-stats`;
 * substitutions and long rallies not on the phone; the time-out off (the time-out pause already says it).
 */
const DEFAULTS: Record<OverlayKind, OverlayDefaults> = {
  ace: { enabled: true, text: 'ACE! {giocatore}', devices: ALL },
  block: { enabled: true, text: 'Muro di {giocatore}', devices: ALL },
  run: { enabled: true, text: 'Break di {serie} punti per {squadra}', devices: ALL },
  longRally: { enabled: true, text: 'Scambio lungo: {attacchi} attacchi', devices: LARGE },
  setPoint: { enabled: true, text: 'SET POINT {squadra}', devices: ALL },
  matchPoint: { enabled: true, text: 'MATCH POINT {squadra}', devices: ALL },
  tie: { enabled: true, text: 'Pareggio {punteggio}', devices: ALL },
  lead: { enabled: true, text: 'Sorpasso {squadra} {punteggio}', devices: ALL },
  timeout: { enabled: false, text: 'Time-out {squadra}', devices: ALL },
  substitution: { enabled: true, text: 'Cambio {squadra}: entra {giocatore}', devices: LARGE },
  setEnd: { enabled: true, text: '{squadra} vince il {set}° set {punteggio}', devices: ALL },
  matchEnd: { enabled: true, text: '{squadra} vince la partita!', devices: ALL },
};

/** Default text of the overlay of `kind`. */
export const defaultOverlayText = (kind: OverlayKind): string => DEFAULTS[kind].text;

/** Schema of the overlay of `kind`: every missing field takes the default of that kind. */
const overlaySchema = (kind: OverlayKind) => {
  const d = DEFAULTS[kind];
  return z.strictObject({
    enabled: z.boolean().default(d.enabled),
    text: OverlayTextSchema.default(d.text),
    seconds: z.int().min(OVERLAY_MIN_SECONDS).max(OVERLAY_MAX_SECONDS).default(OVERLAY_DEFAULT_SECONDS),
    devices: z
      .strictObject({
        tv: z.boolean().default(d.devices.tv),
        tablet: z.boolean().default(d.devices.tablet),
        phone: z.boolean().default(d.devices.phone),
      })
      .prefault({}),
    priority: z.int().min(OVERLAY_MIN_PRIORITY).max(OVERLAY_MAX_PRIORITY).default(MATCH_EVENT_PRIORITY[kind]),
    /** Own position / size of this overlay; missing: the general setting of the document. */
    position: z.enum(OVERLAY_POSITIONS).optional(),
    size: z.enum(OVERLAY_SIZES).optional(),
    /** Image or video behind the text; missing: only the text (the documents saved before stay valid). */
    background: OverlayBackgroundSchema.optional(),
    /**
     * Photo or video of the player of our team (only OVERLAY_PLAYER_KINDS; ignored by the others); missing: the fixed
     * background.
     */
    playerMedia: OverlayPlayerMediaSchema.optional(),
  });
};
export type Overlay = z.output<ReturnType<typeof overlaySchema>>;
export type OverlayInput = z.input<ReturnType<typeof overlaySchema>>;

const overlayShape = Object.fromEntries(OVERLAY_KINDS.map((kind) => [kind, overlaySchema(kind).prefault({})])) as {
  [K in OverlayKind]: z.ZodPrefault<ReturnType<typeof overlaySchema>>;
};

/** Overlays document of a client: `{}` (the database default) reads as the defaults of every event. */
export const TenantOverlaysSchema = z.strictObject({
  version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION),
  /** General position and size of the overlays (an older document without them reads as the defaults). */
  position: z.enum(OVERLAY_POSITIONS).default(OVERLAY_DEFAULT_POSITION),
  size: z.enum(OVERLAY_SIZES).default(OVERLAY_DEFAULT_SIZE),
  ...overlayShape,
});
export type TenantOverlays = z.output<typeof TenantOverlaysSchema>;
export type TenantOverlaysInput = z.input<typeof TenantOverlaysSchema>;

/** Pure: position and size of `overlay`: its own when set, else the general ones of the document. */
export function overlayPlacement(
  config: Pick<TenantOverlays, 'position' | 'size'>,
  overlay: Pick<Overlay, 'position' | 'size'>,
): { position: OverlayPosition; size: OverlaySize } {
  return {
    position: overlay.position ?? config.position ?? OVERLAY_DEFAULT_POSITION,
    size: overlay.size ?? config.size ?? OVERLAY_DEFAULT_SIZE,
  };
}

/** Pure: the backgrounds of the overlays of a document, in the order of OVERLAY_KINDS (an asset may repeat). */
export function overlayBackgrounds(config: TenantOverlays): OverlayBackground[] {
  return OVERLAY_KINDS.flatMap((kind) => {
    const background = config[kind].background;
    return background ? [background] : [];
  });
}

/** Pure: copy of a document without the backgrounds (packages of the graphics carry no videos). */
export function withoutOverlayBackgrounds(config: TenantOverlays): TenantOverlays {
  const out = structuredClone(config);
  for (const kind of OVERLAY_KINDS) delete out[kind].background;
  return out;
}

/** Pure: the default overlays. */
export function defaultOverlays(): TenantOverlays {
  return TenantOverlaysSchema.parse({});
}

/** Pure: the default overlay of `kind` (a new object at every call). */
export function defaultOverlay(kind: OverlayKind): Overlay {
  return overlaySchema(kind).parse({});
}

/** Pure: a stored overlays document with the missing fields filled; an invalid one reads as the defaults. */
export function resolveOverlays(document: unknown): TenantOverlays {
  const parsed = TenantOverlaysSchema.safeParse(document ?? {});
  return parsed.success ? parsed.data : defaultOverlays();
}

/** `GET/PUT /api/admin/overlays`: the overlays of the client of the session (the body of PUT is the document). */
export const OverlaysResponseSchema = z.object({ tenantName: z.string(), overlays: TenantOverlaysSchema });
export type OverlaysResponse = z.infer<typeof OverlaysResponseSchema>;
