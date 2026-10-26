import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { TENANT_CONFIG_VERSION } from './configVersion.js';
import type { LayoutDevice } from './layout.js';
import { BLOCK_OPTIONS, BlockIdSchema } from './layout.js';
import { OVERLAY_BACKGROUND_KINDS, OverlayBackgroundSchema } from './overlays.js';
import type { OverlayBackgroundKind } from './overlays.js';

/**
 * Pauses of the public page chosen by a client (jsonb `tenants.intermissions`): what the portal shows during a
 * time-out, at the end of a set and at the end of the match (`phase` of the match state, computed by
 * `@arenalive/volley-stats` from the scout lines only). For every pause: on/off, full screen or banner for every device, a
 * delay before it shows and an ordered list of slides shown in turn, each for its seconds. A pause always ends by
 * itself when the play starts again (first action or point after it: the phase goes back to `rally`); the end of the
 * match stays until the viewer goes back to the page. The end of set can be different for every set (1st-4th: the
 * 5th set ends the match); a set without its own pause uses the generic one, as a whole.
 * `milestone` («ogni N punti») is not a phase: a short pause during the set every `every` points (sum of the two
 * scores, `pointMilestone` of @arenalive/volley-stats), never in the last `stopBeforeEnd` points of the set; it shows its slides once.
 */

/** Pauses of the match: the kinds of `MatchPhase` with a pause, and the «ogni N punti» during the set. */
export const INTERMISSION_KINDS = ['timeout', 'setBreak', 'matchEnd', 'milestone'] as const;
export type IntermissionKind = (typeof INTERMISSION_KINDS)[number];

/** `fullscreen`: over the page, with a button to go back; `banner`: fixed at the bottom, the page stays usable. */
export const INTERMISSION_MODES = ['fullscreen', 'banner'] as const;
export type IntermissionMode = (typeof INTERMISSION_MODES)[number];

/**
 * Size of the slides of a pause on full screen: `normal` as designed (centred, the slide scrolls when taller than
 * the screen); `large` bigger, up to 1.5 times, only as far as it stays on the screen without scrolling; `fill` as
 * big (or as small) as the space of the screen allows, never scrolling. Missing in a saved document: `normal`.
 */
export const INTERMISSION_FULLSCREEN_SIZES = ['normal', 'large', 'fill'] as const;
export type IntermissionFullscreenSize = (typeof INTERMISSION_FULLSCREEN_SIZES)[number];

/** Sets that can have their own end-of-set pause (the 5th set ends the match). */
export const SET_BREAK_SETS = ['1', '2', '3', '4'] as const;
export type SetBreakSet = (typeof SET_BREAK_SETS)[number];

/**
 * Types of slide, closed list. `setSummary`: statistics of the set just closed (of the set in progress during a
 * time-out); `finalResult`: sets won and partials; `mvp`: best player of the match; `setScores`: partials of the sets;
 * `setScorers` (partial and scorers), `aces`, `blocks`, `attack`, `roleDuel` (player against player of a role),
 * `teamDuel` (team against team): statistics of a period, the set of the pause or the match (`period`), as the blocks
 * of the page with the same name; `nextMatch` (next match of the club) and `standings` (standings of its championship),
 * skipped when the client has no club; `sponsor`, `message`, `qr`, `logo`: as the blocks of the page with the same name
 * (same options); `media` («Foto o video»): an image or a video of the library of the client (MediaSlideOptionsSchema).
 */
export const SLIDE_TYPES = [
  'setSummary',
  'finalResult',
  'mvp',
  'setScores',
  'setScorers',
  'aces',
  'blocks',
  'attack',
  'roleDuel',
  'teamDuel',
  'nextMatch',
  'standings',
  'sponsor',
  'message',
  'qr',
  'logo',
  'media',
] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];

/** Seconds a slide stays on screen: limits and default. */
export const SLIDE_MIN_SECONDS = 3;
export const SLIDE_MAX_SECONDS = 60;
export const SLIDE_DEFAULT_SECONDS = 8;
/** Most slides of one pause. */
export const INTERMISSION_MAX_SLIDES = 12;
/** Longest wait (seconds) between the start of a pause and its screen. */
export const INTERMISSION_MAX_DELAY_SECONDS = 60;
/** Longest own title of a pause. */
export const PAUSE_TITLE_MAX_LENGTH = 60;
/** Default text of the end of the match. */
export const THANKS_MESSAGE = 'Grazie per aver seguito la partita';

const NoSlideOptionsSchema = z.strictObject({});

/**
 * How the image or video of a «Foto o video» slide uses its space: `contain` («Intero») the whole picture, never cut,
 * the sides filled (a blurred copy of the image, the page colour for a video); `cover` («Riempi») the whole space,
 * cutting the edges that do not fit.
 */
export const SLIDE_MEDIA_FITS = ['contain', 'cover'] as const;
export type SlideMediaFit = (typeof SLIDE_MEDIA_FITS)[number];
/**
 * Longest a «Foto o video» slide stays when it follows its video (`duration` `video`): the longest any slide stays
 * (SLIDE_MAX_SECONDS), so a video never holds a pause longer than another slide could (a time-out lasts about 30 s).
 */
export const SLIDE_VIDEO_MAX_SECONDS = SLIDE_MAX_SECONDS;

/**
 * Options of a «Foto o video» slide: a file of the library of the client (`assetId`, any use; the server checks that it
 * is of the client and an image for `image`, a video for `video`; null: none chosen yet, or dropped by an export of
 * the graphics: the slide is skipped), `fit`, and for a video the options of a video background of the overlays:
 * `audio` (muted by default) and `duration` (`seconds`: the seconds of the slide, the video loops; `video`: until the
 * video ends, at most SLIDE_VIDEO_MAX_SECONDS, the seconds of the slide when its length cannot be read).
 */
export const MediaSlideOptionsSchema = OverlayBackgroundSchema.pick({ audio: true, duration: true }).extend({
  kind: z.enum(OVERLAY_BACKGROUND_KINDS).default('image'),
  assetId: AssetIdSchema.nullable().default(null),
  fit: z.enum(SLIDE_MEDIA_FITS).default('contain'),
});

/** Options of every type of slide: the ones of the blocks for sponsor, message, QR and logo. */
export const SLIDE_OPTIONS = {
  setSummary: NoSlideOptionsSchema,
  finalResult: NoSlideOptionsSchema,
  mvp: NoSlideOptionsSchema,
  setScores: NoSlideOptionsSchema,
  setScorers: BLOCK_OPTIONS.setScorers,
  aces: BLOCK_OPTIONS.aces,
  blocks: BLOCK_OPTIONS.blocks,
  attack: BLOCK_OPTIONS.attack,
  roleDuel: BLOCK_OPTIONS.roleDuel,
  teamDuel: BLOCK_OPTIONS.teamDuel,
  nextMatch: BLOCK_OPTIONS.nextMatch,
  standings: BLOCK_OPTIONS.standings,
  sponsor: BLOCK_OPTIONS.sponsor,
  message: BLOCK_OPTIONS.message,
  qr: BLOCK_OPTIONS.qr,
  logo: BLOCK_OPTIONS.logo,
  media: MediaSlideOptionsSchema,
} as const satisfies Record<SlideType, z.ZodType>;

const slideOf = <T extends SlideType, O extends z.ZodType>(type: T, options: O) =>
  z.strictObject({
    id: BlockIdSchema,
    type: z.literal(type),
    seconds: z.int().min(SLIDE_MIN_SECONDS).max(SLIDE_MAX_SECONDS).default(SLIDE_DEFAULT_SECONDS),
    /** Off: the slide stays in the list with its options but is never shown (missing in a saved document: on). */
    enabled: z.boolean().default(true),
    /**
     * The title of the pause shows while this slide is on screen (missing in a saved document: yes). Hidden: it stays
     * for screen readers, the slide takes its space.
     */
    showTitle: z.boolean().default(true),
    /** Missing: the defaults of the type. */
    options,
  });

export const IntermissionSlideSchema = z.discriminatedUnion('type', [
  slideOf('setSummary', SLIDE_OPTIONS.setSummary.prefault({})),
  slideOf('finalResult', SLIDE_OPTIONS.finalResult.prefault({})),
  slideOf('mvp', SLIDE_OPTIONS.mvp.prefault({})),
  slideOf('setScores', SLIDE_OPTIONS.setScores.prefault({})),
  slideOf('setScorers', SLIDE_OPTIONS.setScorers.prefault({})),
  slideOf('aces', SLIDE_OPTIONS.aces.prefault({})),
  slideOf('blocks', SLIDE_OPTIONS.blocks.prefault({})),
  slideOf('attack', SLIDE_OPTIONS.attack.prefault({})),
  slideOf('roleDuel', SLIDE_OPTIONS.roleDuel.prefault({})),
  slideOf('teamDuel', SLIDE_OPTIONS.teamDuel.prefault({})),
  slideOf('nextMatch', SLIDE_OPTIONS.nextMatch.prefault({})),
  slideOf('standings', SLIDE_OPTIONS.standings.prefault({})),
  slideOf('sponsor', SLIDE_OPTIONS.sponsor.prefault({})),
  slideOf('message', SLIDE_OPTIONS.message.prefault({})),
  slideOf('qr', SLIDE_OPTIONS.qr.prefault({})),
  slideOf('logo', SLIDE_OPTIONS.logo.prefault({})),
  slideOf('media', SLIDE_OPTIONS.media.prefault({})),
]);
export type IntermissionSlide = z.output<typeof IntermissionSlideSchema>;
export type IntermissionSlideInput = z.input<typeof IntermissionSlideSchema>;
/** Options of the slide of type `T`. */
export type SlideOptions<T extends SlideType> = z.output<(typeof SLIDE_OPTIONS)[T]>;

/** Slides of a pause: unique ids, at most INTERMISSION_MAX_SLIDES. */
export const IntermissionSlidesSchema = z
  .array(IntermissionSlideSchema)
  .max(INTERMISSION_MAX_SLIDES)
  .superRefine((slides, ctx) => {
    const ids = new Set<string>();
    slides.forEach((slide, index) => {
      if (ids.has(slide.id)) ctx.addIssue({ code: 'custom', message: 'id ripetuto', path: [index, 'id'] });
      ids.add(slide.id);
    });
  });

const ModeSchema = z.enum(INTERMISSION_MODES);

interface PauseDefaults {
  enabled: boolean;
  modes: Record<LayoutDevice, IntermissionMode>;
  delaySeconds: number;
  slides: IntermissionSlideInput[];
}

/** «Ogni N punti»: points between two pauses (sum of the two scores), limits and default. */
export const MILESTONE_MIN_EVERY = 4;
export const MILESTONE_MAX_EVERY = 25;
export const MILESTONE_DEFAULT_EVERY = 8;
/**
 * «Non negli ultimi K punti»: no «ogni N punti» once the leading team is K points or less from the end of the set
 * (`toTarget` of `pointMilestone`: 25, 15 at the tie-break), e.g. K = 5: none from 20 points, from 10 at the tie-break.
 */
export const MILESTONE_MIN_STOP_BEFORE_END = 1;
export const MILESTONE_MAX_STOP_BEFORE_END = 15;
export const MILESTONE_DEFAULT_STOP_BEFORE_END = 5;

/**
 * Defaults: time-out as a compact banner with the sponsors; end of set full screen on TV and tablet, banner on the
 * phone, 5 s after the set closes, with the summary of the set, partial and scorers, aces, blocks, the player duels
 * of every role in turn, the team comparison, the standings, the next match and the sponsors; end of match full screen with the result, the MVP,
 * the statistics of the whole match, the standings, the next match, the thanks and the sponsors; «ogni N punti» every 8 points but the last 5 of the set, banner
 * (full screen on TV) with partial and scorers and the team comparison of the set in progress.
 */
const DEFAULTS: Record<IntermissionKind, PauseDefaults> = {
  timeout: {
    enabled: true,
    modes: { tv: 'banner', tablet: 'banner', phone: 'banner' },
    delaySeconds: 0,
    slides: [{ id: 'sponsor', type: 'sponsor', seconds: 10 }],
  },
  setBreak: {
    enabled: true,
    modes: { tv: 'fullscreen', tablet: 'fullscreen', phone: 'banner' },
    delaySeconds: 5,
    slides: [
      { id: 'setSummary', type: 'setSummary', seconds: 12 },
      { id: 'setScorers', type: 'setScorers', seconds: 10 },
      { id: 'aces', type: 'aces', seconds: 8 },
      { id: 'blocks', type: 'blocks', seconds: 8 },
      { id: 'roleDuel', type: 'roleDuel', seconds: 8 },
      { id: 'teamDuel', type: 'teamDuel', seconds: 10 },
      { id: 'standings', type: 'standings', seconds: 10 },
      { id: 'nextMatch', type: 'nextMatch', seconds: 10 },
      { id: 'sponsor', type: 'sponsor', seconds: 8 },
    ],
  },
  matchEnd: {
    enabled: true,
    modes: { tv: 'fullscreen', tablet: 'fullscreen', phone: 'fullscreen' },
    delaySeconds: 5,
    slides: [
      { id: 'finalResult', type: 'finalResult', seconds: 10 },
      { id: 'mvp', type: 'mvp', seconds: 10 },
      { id: 'setScorers', type: 'setScorers', seconds: 10, options: { period: 'match' } },
      { id: 'roleDuel', type: 'roleDuel', seconds: 8, options: { period: 'match' } },
      { id: 'teamDuel', type: 'teamDuel', seconds: 10, options: { period: 'match' } },
      { id: 'standings', type: 'standings', seconds: 10 },
      { id: 'nextMatch', type: 'nextMatch', seconds: 10 },
      { id: 'thanks', type: 'message', seconds: 8, options: { text: THANKS_MESSAGE, size: 'large' } },
      { id: 'sponsor', type: 'sponsor', seconds: 8 },
    ],
  },
  milestone: {
    enabled: true,
    modes: { tv: 'fullscreen', tablet: 'banner', phone: 'banner' },
    delaySeconds: 3,
    slides: [
      { id: 'setScorers', type: 'setScorers', seconds: 8 },
      {
        id: 'teamDuel',
        type: 'teamDuel',
        seconds: 8,
        options: { rows: ['points', 'aces', 'killPct', 'blocks', 'errors'] },
      },
    ],
  },
};

/** Fields of one pause of `kind`: every missing field takes the default of that kind. */
const pauseShape = (kind: IntermissionKind) => {
  const d = DEFAULTS[kind];
  return {
    enabled: z.boolean().default(d.enabled),
    modes: z
      .strictObject({
        tv: ModeSchema.default(d.modes.tv),
        tablet: ModeSchema.default(d.modes.tablet),
        phone: ModeSchema.default(d.modes.phone),
      })
      .prefault({}),
    /** Seconds between the start of the pause and its screen (the scoreboard shows the end of the set first). */
    delaySeconds: z.int().min(0).max(INTERMISSION_MAX_DELAY_SECONDS).default(d.delaySeconds),
    /**
     * Title of the pause on full screen and in the banner; empty (also missing in a saved document): the automatic one
     * of the portal («Time-out <squadra>», «Fine 2° set», «Fine partita», «Statistiche del set · 2° set 16-16»).
     */
    title: z.string().trim().max(PAUSE_TITLE_MAX_LENGTH).default(''),
    /** Size of the slides on full screen (the banner does not change). */
    fullscreenSize: z.enum(INTERMISSION_FULLSCREEN_SIZES).default('normal'),
    slides: IntermissionSlidesSchema.default(() => IntermissionSlidesSchema.parse(d.slides)),
  };
};

const ACTIVE_HAS_SLIDES = {
  check: (p: { enabled: boolean; slides: readonly unknown[] }) => !p.enabled || p.slides.length > 0,
  params: { message: 'una pausa attiva ha almeno una diapositiva', path: ['slides'] },
};

const pauseSchema = (kind: IntermissionKind) =>
  z.strictObject(pauseShape(kind)).refine(ACTIVE_HAS_SLIDES.check, ACTIVE_HAS_SLIDES.params);

export const TimeoutIntermissionSchema = pauseSchema('timeout');
export const SetBreakIntermissionSchema = pauseSchema('setBreak');
export const MatchEndIntermissionSchema = pauseSchema('matchEnd');
export type Intermission = z.output<typeof SetBreakIntermissionSchema>;
export type IntermissionInput = z.input<typeof SetBreakIntermissionSchema>;

/** «Ogni N punti»: a pause with its rule (every how many points, not after which score). */
export const MilestoneIntermissionSchema = z
  .strictObject({
    ...pauseShape('milestone'),
    /** Points between two pauses: sum of the two scores of the set (8: at 8, 16, 24, ... points played). */
    every: z.int().min(MILESTONE_MIN_EVERY).max(MILESTONE_MAX_EVERY).default(MILESTONE_DEFAULT_EVERY),
    /** «Non negli ultimi K punti»: none once max(home, away) ≥ points to win the set − K. */
    stopBeforeEnd: z
      .int()
      .min(MILESTONE_MIN_STOP_BEFORE_END)
      .max(MILESTONE_MAX_STOP_BEFORE_END)
      .default(MILESTONE_DEFAULT_STOP_BEFORE_END),
  })
  .refine(ACTIVE_HAS_SLIDES.check, ACTIVE_HAS_SLIDES.params);
export type MilestoneIntermission = z.output<typeof MilestoneIntermissionSchema>;

/** Own end-of-set pause of the sets 1-4 (missing: the generic `setBreak`). */
export const SetBreakBySetSchema = z.strictObject({
  '1': SetBreakIntermissionSchema.optional(),
  '2': SetBreakIntermissionSchema.optional(),
  '3': SetBreakIntermissionSchema.optional(),
  '4': SetBreakIntermissionSchema.optional(),
});

/** Minutes between the end of the match and the «Dopo la partita» screen: limits and default. */
export const AFTER_MATCH_MAX_DELAY_MINUTES = 240;
export const AFTER_MATCH_DEFAULT_DELAY_MINUTES = 30;

/**
 * «Dopo la partita»: `delayMinutes` after the end of the match (`finishedAt` of the state message) the public page
 * shows `image` (the file: an image, or a video for `kind` `video`, of the library of the client) full screen, with the
 * countdown to the next match of the club over it; it replaces the end-of-match pause. Off, or on without a file:
 * nothing changes. A video loops while the screen is on, muted unless `audio`; `fit` as for a «Foto o video» slide.
 * Missing in a document saved before the video (the photo only): an image, muted, filling the screen (`cover`, as the
 * photo always did).
 */
export const AfterMatchSchema = z.strictObject({
  enabled: z.boolean().default(false),
  image: AssetIdSchema.nullable().default(null),
  kind: z.enum(OVERLAY_BACKGROUND_KINDS).default('image'),
  audio: z.boolean().default(false),
  fit: z.enum(SLIDE_MEDIA_FITS).default('cover'),
  delayMinutes: z.int().min(0).max(AFTER_MATCH_MAX_DELAY_MINUTES).default(AFTER_MATCH_DEFAULT_DELAY_MINUTES),
});
export type AfterMatch = z.output<typeof AfterMatchSchema>;

/** Pure: the file (image or video) of «Dopo la partita» when the screen is on and has one, otherwise null. */
export const afterMatchImage = (config: AfterMatch): string | null => (config.enabled ? config.image : null);

/** Pauses document of a client: `{}` (the database default) reads as the defaults of every pause. */
export const TenantIntermissionsSchema = z.strictObject({
  version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION),
  timeout: TimeoutIntermissionSchema.prefault({}),
  setBreak: SetBreakIntermissionSchema.prefault({}),
  setBreakBySet: SetBreakBySetSchema.prefault({}),
  matchEnd: MatchEndIntermissionSchema.prefault({}),
  milestone: MilestoneIntermissionSchema.prefault({}),
  afterMatch: AfterMatchSchema.prefault({}),
});
export type TenantIntermissions = z.output<typeof TenantIntermissionsSchema>;
export type TenantIntermissionsInput = z.input<typeof TenantIntermissionsSchema>;

/** Pure: the default pauses. */
export function defaultIntermissions(): TenantIntermissions {
  return TenantIntermissionsSchema.parse({});
}

/** Pure: the default pause of `kind` (a new object at every call; for `milestone` with its rule). */
export function defaultIntermission(kind: IntermissionKind): Intermission {
  return kind === 'milestone' ? MilestoneIntermissionSchema.parse({}) : pauseSchema(kind).parse({});
}

/** Pure: a stored pauses document with the missing fields filled; an invalid one reads as the defaults. */
export function resolveIntermissions(document: unknown): TenantIntermissions {
  const parsed = TenantIntermissionsSchema.safeParse(document ?? {});
  return parsed.success ? parsed.data : defaultIntermissions();
}

/**
 * Pure: the pause to use for `kind` (for `setBreak`, the own pause of `set` when there is one, otherwise the generic
 * one); null when it is off or has no slide on.
 */
export function intermissionFor(
  config: TenantIntermissions,
  kind: IntermissionKind,
  set?: number,
): Intermission | null {
  let pause: Intermission = config[kind];
  if (kind === 'setBreak' && set !== undefined) {
    const own = (SET_BREAK_SETS as readonly string[]).includes(String(set))
      ? config.setBreakBySet[String(set) as SetBreakSet]
      : undefined;
    if (own) pause = own;
  }
  return pause.enabled && pause.slides.some((s) => s.enabled) ? pause : null;
}

/** Pure: every pause of a document (the generic ones and the own pauses of the sets). */
export function allIntermissions(config: TenantIntermissions): Intermission[] {
  const own = SET_BREAK_SETS.map((s) => config.setBreakBySet[s]).filter((p): p is Intermission => p !== undefined);
  return [config.timeout, config.setBreak, ...own, config.matchEnd, config.milestone];
}

/**
 * Pure: ids of the images used by the sponsor slides of every pause and by «Dopo la partita» when it shows an image
 * (even when off: the choice is kept), each once, in order of appearance.
 */
export function intermissionImageIds(config: TenantIntermissions): string[] {
  const ids = new Set<string>();
  for (const pause of allIntermissions(config))
    for (const slide of pause.slides) if (slide.type === 'sponsor') for (const id of slide.options.images) ids.add(id);
  if (config.afterMatch.image !== null && config.afterMatch.kind === 'image') ids.add(config.afterMatch.image);
  return [...ids];
}

/**
 * Pure: the files of the «Foto o video» slides of every pause (even when off: the choice is kept), with the kind each
 * slide asks for, in order of appearance (a file used by two slides comes twice: each kind is checked), and last the
 * video of «Dopo la partita» (its image is in `intermissionImageIds`).
 */
export function intermissionMedia(config: TenantIntermissions): { kind: OverlayBackgroundKind; assetId: string }[] {
  const out: { kind: OverlayBackgroundKind; assetId: string }[] = [];
  for (const pause of allIntermissions(config))
    for (const slide of pause.slides)
      if (slide.type === 'media' && slide.options.assetId !== null)
        out.push({ kind: slide.options.kind, assetId: slide.options.assetId });
  const after = config.afterMatch;
  if (after.image !== null && after.kind === 'video') out.push({ kind: 'video', assetId: after.image });
  return out;
}

/**
 * Pure: copy of a document with no file in the «Foto o video» slides (they stay, with their options, skipped until a
 * file is chosen again) and no video in «Dopo la partita» (its image stays): the packages of the graphics carry no
 * videos, as for the backgrounds of the overlays.
 */
export function withoutIntermissionMedia(config: TenantIntermissions): TenantIntermissions {
  const out = structuredClone(config);
  for (const pause of allIntermissions(out))
    for (const slide of pause.slides) if (slide.type === 'media') slide.options.assetId = null;
  if (out.afterMatch.kind === 'video') out.afterMatch.image = null;
  return out;
}

/** Pure: ids of the sponsors chosen by the sponsor slides of every pause (each once, in order of appearance). */
export function intermissionSponsorIds(config: TenantIntermissions): string[] {
  const ids = new Set<string>();
  for (const pause of allIntermissions(config))
    for (const slide of pause.slides)
      if (slide.type === 'sponsor') for (const id of slide.options.sponsors) ids.add(id);
  return [...ids];
}

/** `GET/PUT /api/admin/intermissions`: the pauses of the client of the session (the body of PUT is the document). */
export const IntermissionsResponseSchema = z.object({
  tenantName: z.string(),
  intermissions: TenantIntermissionsSchema,
});
export type IntermissionsResponse = z.infer<typeof IntermissionsResponseSchema>;
