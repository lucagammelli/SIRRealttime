import { DUEL_ROLES, TEAM_DUEL_KEYS } from '@arenalive/volley-stats';
import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { STANDINGS_SCOPES } from './club.js';
import { HexColorSchema } from './colors.js';
import { SponsorIdSchema } from './sponsors.js';
import { TENANT_CONFIG_VERSION } from './configVersion.js';
import { plainText } from './strings.js';
import type { TemplateId } from './templates.js';
import { TEMPLATES } from './templates.js';

/**
 * Layout of the public match page chosen by a client (jsonb `tenants.layout`): one ordered list of blocks per device.
 * Every block has a stable id (for the reordering in the editor), a type from a closed list, a width on a 12-column
 * grid (only the widths allowed for its type), a visibility switch and the options of its type.
 */

/** Device classes of the public page (see `deviceFor` of the portal). */
export const LAYOUT_DEVICES = ['tv', 'tablet', 'phone'] as const;
export type LayoutDevice = (typeof LAYOUT_DEVICES)[number];

/** Columns of the grid of the page: a block takes 1-12 of them (on the phone every block is full width). */
export const LAYOUT_COLUMNS = 12;
/** Most blocks in the list of one device. */
export const LAYOUT_MAX_BLOCKS = 24;

/** Types of block, closed list: anything else is refused. */
export const BLOCK_TYPES = [
  'scoreboard',
  'momentum',
  'comparison',
  'players',
  'court',
  'rotations',
  'logo',
  'sponsor',
  'message',
  'qr',
  'lastPoint',
  'setScores',
  'topPlayers',
  'setScorers',
  'aces',
  'blocks',
  'attack',
  'roleDuel',
  'teamDuel',
  'nextMatch',
  'standings',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

const ANY: readonly number[] = [3, 4, 6, 8, 12];
const MEDIUM: readonly number[] = [4, 6, 8, 12];
const WIDE: readonly number[] = [6, 8, 12];

/**
 * Widths (columns of LAYOUT_COLUMNS) allowed for each type: big tables need room. The momentum chart can take a third
 * (three cards in a row on a 16:9 screen, template «SIR VOLLEY»).
 */
export const BLOCK_WIDTHS: Record<BlockType, readonly number[]> = {
  scoreboard: [12],
  momentum: MEDIUM,
  comparison: MEDIUM,
  players: WIDE,
  court: MEDIUM,
  rotations: MEDIUM,
  logo: ANY,
  sponsor: ANY,
  message: ANY,
  qr: ANY,
  lastPoint: ANY,
  setScores: MEDIUM,
  topPlayers: MEDIUM,
  setScorers: MEDIUM,
  aces: MEDIUM,
  blocks: MEDIUM,
  attack: MEDIUM,
  roleDuel: MEDIUM,
  teamDuel: MEDIUM,
  nextMatch: MEDIUM,
  standings: MEDIUM,
};

/** Most images in the rotation of a sponsor block. */
export const SPONSOR_MAX_IMAGES = 12;
/** Most sponsors chosen by a sponsor block (or slide). */
export const SPONSOR_BLOCK_MAX_SPONSORS = 12;
/** Seconds each sponsor image stays on screen: limits and default. */
export const SPONSOR_MIN_SECONDS = 3;
export const SPONSOR_MAX_SECONDS = 60;
export const SPONSOR_DEFAULT_SECONDS = 8;
/** `rotate`: one image at a time, each for `seconds`; `all`: every image together in one page (a grid). */
export const SPONSOR_DISPLAYS = ['rotate', 'all'] as const;
export type SponsorDisplay = (typeof SPONSOR_DISPLAYS)[number];
/** Longest text of a message block. */
export const MESSAGE_MAX_LENGTH = 280;
/** Longest text under the QR code. */
export const QR_CAPTION_MAX_LENGTH = 80;
export const QR_DEFAULT_CAPTION = 'Segui la partita sul telefono';
/** Most players in the «migliori giocatori» block. */
export const TOP_PLAYERS_MAX = 10;

const NoOptionsSchema = z.strictObject({});

export const LogoOptionsSchema = z.strictObject({
  /** `main`: horizontal logo of the branding; `mark`: square logo. */
  variant: z.enum(['main', 'mark']).default('main'),
});

export const RotationsOptionsSchema = z.strictObject({
  /** `horizontal`: the two teams side by side; `vertical`: one chart above the other. */
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
});

export const SponsorOptionsSchema = z.strictObject({
  /**
   * Sponsors of the client (ids of `sponsors`, checked by the server): all their images in turn, in the order of the
   * list of the sponsors. Missing in a layout saved before the sponsors: none.
   */
  sponsors: z
    .array(SponsorIdSchema)
    .max(SPONSOR_BLOCK_MAX_SPONSORS)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'sponsor ripetuto' })
    .default([]),
  /** Single images of the client chosen before the sponsors (ids of `assets`, checked by the server), after them. */
  images: z
    .array(AssetIdSchema)
    .max(SPONSOR_MAX_IMAGES)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'immagine ripetuta' })
    .default([]),
  seconds: z.int().min(SPONSOR_MIN_SECONDS).max(SPONSOR_MAX_SECONDS).default(SPONSOR_DEFAULT_SECONDS),
  /** One at a time or all together (missing in a layout saved before: one at a time). */
  display: z.enum(SPONSOR_DISPLAYS).default('rotate'),
});

export const MessageOptionsSchema = z.strictObject({
  /** Plain text of the client (no HTML: shown as text). */
  text: plainText(MESSAGE_MAX_LENGTH).default('Benvenuti al palazzetto!'),
  size: z.enum(['normal', 'large']).default('normal'),
});

export const QrOptionsSchema = z.strictObject({
  caption: plainText(QR_CAPTION_MAX_LENGTH).default(QR_DEFAULT_CAPTION),
});

export const TopPlayersOptionsSchema = z.strictObject({
  count: z.int().min(1).max(TOP_PLAYERS_MAX).default(5),
  team: z.enum(['both', 'home', 'away']).default('both'),
});

/**
 * Period of the statistics of a block or a slide (`Period` of @arenalive/volley-stats): `set` the set of the pause (just
 * closed, or in progress during a time-out or an «ogni N punti»; for a block of the page the set in progress), `match`
 * the whole match.
 */
export const STAT_PERIODS = ['set', 'match'] as const;
export type StatPeriod = (typeof STAT_PERIODS)[number];
const PeriodSchema = z.enum(STAT_PERIODS).default('set');

/** Scorers of each team in «Parziale e marcatori»: limits and default. */
export const SCORERS_MIN = 3;
export const SCORERS_MAX = 8;
export const SCORERS_DEFAULT = 5;
/** Best attackers of each team in «Attacco»: limits and default. */
export const ATTACKERS_MIN = 1;
export const ATTACKERS_MAX = 5;
export const ATTACKERS_DEFAULT = 3;

export const SetScorersOptionsSchema = z.strictObject({
  period: PeriodSchema,
  /** Most scorers shown for each team. */
  limit: z.int().min(SCORERS_MIN).max(SCORERS_MAX).default(SCORERS_DEFAULT),
});

/** Aces and blocks: count of each team and who scored them. */
export const PeriodOptionsSchema = z.strictObject({ period: PeriodSchema });

export const AttackOptionsSchema = z.strictObject({
  period: PeriodSchema,
  limit: z.int().min(ATTACKERS_MIN).max(ATTACKERS_MAX).default(ATTACKERS_DEFAULT),
});

/**
 * Role of a player against player duel: one role (`DUEL_ROLES` of @arenalive/volley-stats, in its order), or `rotate`
 * every role with a duel in turn.
 */
export const DUEL_ROLE_CHOICES = ['rotate', ...DUEL_ROLES] as const;
export type DuelRoleChoice = (typeof DUEL_ROLE_CHOICES)[number];

export const RoleDuelOptionsSchema = z.strictObject({
  period: PeriodSchema,
  role: z.enum(DUEL_ROLE_CHOICES).default('rotate'),
});

export const TeamDuelOptionsSchema = z.strictObject({
  period: PeriodSchema,
  /** Rows chosen (`TEAM_DUEL_KEYS` of @arenalive/volley-stats, shown in its order); empty: every row. */
  rows: z
    .array(z.enum(TEAM_DUEL_KEYS))
    .max(TEAM_DUEL_KEYS.length)
    .refine((rows) => new Set(rows).size === rows.length, { message: 'riga ripetuta' })
    .default([]),
});

/** Rows of «Classifica» when it shows the first N: limits and default. */
export const STANDINGS_MIN_ROWS = 3;
export const STANDINGS_MAX_ROWS = 16;
export const STANDINGS_DEFAULT_ROWS = 5;

/** «Prossima partita»: the QR code of the link of that match can be hidden. */
export const NextMatchOptionsSchema = z.strictObject({
  qr: z.boolean().default(true),
});

/**
 * «Classifica» of the championship of the club: the first `count` rows (`top`), every row (`all`) or the club ±2
 * positions (`around`, `count` is not used).
 */
export const StandingsOptionsSchema = z.strictObject({
  scope: z.enum(STANDINGS_SCOPES).default('around'),
  count: z.int().min(STANDINGS_MIN_ROWS).max(STANDINGS_MAX_ROWS).default(STANDINGS_DEFAULT_ROWS),
});

/** Thickness of the lines and of the arrows of the court map, as a multiple of the usual one: limits and default. */
export const COURT_WIDTH_MIN = 0.5;
export const COURT_WIDTH_MAX = 3;
export const COURT_WIDTH_DEFAULT = 1;

/** Colours of the three bands of the court in «tricolore» (flag of Italy): green, white, red. */
export const COURT_TRICOLOR_DEFAULT = ['#009246', '#ffffff', '#ce2b37'] as const;
export const COURT_FIELD_MODES = ['single', 'tricolor'] as const;

/**
 * Team shown by the map without the touch filters (TV): `cycle` home and away in turn, `ours` the team of the client
 * (home when not recognized), or always `home` / `away`.
 */
export const COURT_SIDE_MODES = ['cycle', 'ours', 'home', 'away'] as const;
export type CourtSideMode = (typeof COURT_SIDE_MODES)[number];
/** Skill shown without the touch filters: attacks, serves, or both in turn. */
export const COURT_SKILL_MODES = ['attack', 'serve', 'cycle'] as const;
export type CourtSkillMode = (typeof COURT_SKILL_MODES)[number];
/**
 * Halves of the map: `scoreboard` as the scoreboard, home always on the left and away on the right (the arrows of the
 * away team go from right to left); `shown` the team shown always on the left, attacking to the right.
 */
export const COURT_ORIENTATIONS = ['scoreboard', 'shown'] as const;
export type CourtOrientation = (typeof COURT_ORIENTATIONS)[number];
/** Seconds of each view of the map when it goes in turn. */
export const COURT_CYCLE_SECONDS_MIN = 5;
export const COURT_CYCLE_SECONDS_MAX = 60;
export const COURT_CYCLE_SECONDS_DEFAULT = 10;

/**
 * «Mappe di campo»: colours of the field, of the lines and of the arrows for our team and for the opponent, and
 * thickness of lines and arrows. A colour that is missing follows the theme (light or dark) and, for the arrows, the
 * template: with no options the map looks as it always did.
 */
export const CourtOptionsSchema = z.strictObject({
  /** Team and skill shown without the touch filters (with them: the filters start from these). */
  side: z.enum(COURT_SIDE_MODES).default('cycle'),
  skill: z.enum(COURT_SKILL_MODES).default('attack'),
  cycleSeconds: z.int().min(COURT_CYCLE_SECONDS_MIN).max(COURT_CYCLE_SECONDS_MAX).default(COURT_CYCLE_SECONDS_DEFAULT),
  /** Which team plays in which half; saved layouts without it take the scoreboard one (home on the left). */
  orientation: z.enum(COURT_ORIENTATIONS).default('scoreboard'),
  /**
   * `single`: both halves in `fieldColor`; `tricolor`: the whole court in three bands of two columns of zones, with
   * the colours of `tricolor` (default: green, white, red; the white band straddles the net). Missing: the halves
   * follow `fieldOurs` / `fieldOpponent`.
   */
  fieldMode: z.enum(COURT_FIELD_MODES).optional(),
  fieldColor: HexColorSchema.optional(),
  tricolor: z.tuple([HexColorSchema, HexColorSchema, HexColorSchema]).optional(),
  /** Field of the half of our team / of the opponent. */
  fieldOurs: HexColorSchema.optional(),
  fieldOpponent: HexColorSchema.optional(),
  /** Lines (perimeter, 3 m line) of the half of our team / of the opponent; the net follows our team. */
  linesOurs: HexColorSchema.optional(),
  linesOpponent: HexColorSchema.optional(),
  lineWidth: z.number().min(COURT_WIDTH_MIN).max(COURT_WIDTH_MAX).default(COURT_WIDTH_DEFAULT),
  /** Arrows of the attacks and serves of our team / of the opponent (one colour for every evaluation). */
  arrowsOurs: HexColorSchema.optional(),
  arrowsOpponent: HexColorSchema.optional(),
  arrowWidth: z.number().min(COURT_WIDTH_MIN).max(COURT_WIDTH_MAX).default(COURT_WIDTH_DEFAULT),
});
export type CourtOptions = z.output<typeof CourtOptionsSchema>;

/** Options of every type (an empty object for the blocks without options). */
export const BLOCK_OPTIONS = {
  scoreboard: NoOptionsSchema,
  momentum: NoOptionsSchema,
  comparison: NoOptionsSchema,
  players: NoOptionsSchema,
  court: CourtOptionsSchema,
  rotations: RotationsOptionsSchema,
  logo: LogoOptionsSchema,
  sponsor: SponsorOptionsSchema,
  message: MessageOptionsSchema,
  qr: QrOptionsSchema,
  lastPoint: NoOptionsSchema,
  setScores: NoOptionsSchema,
  topPlayers: TopPlayersOptionsSchema,
  setScorers: SetScorersOptionsSchema,
  aces: PeriodOptionsSchema,
  blocks: PeriodOptionsSchema,
  attack: AttackOptionsSchema,
  roleDuel: RoleDuelOptionsSchema,
  teamDuel: TeamDuelOptionsSchema,
  nextMatch: NextMatchOptionsSchema,
  standings: StandingsOptionsSchema,
} as const satisfies Record<BlockType, z.ZodType>;

/** Stable id of a block inside the list of a device (letters, digits, `-` and `_`). */
export const BlockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

const blockOf = <T extends BlockType, O extends z.ZodType>(type: T, options: O) =>
  z.strictObject({
    id: BlockIdSchema,
    type: z.literal(type),
    width: z.int().min(1).max(LAYOUT_COLUMNS).default(LAYOUT_COLUMNS),
    visible: z.boolean().default(true),
    /** Phone only: the section starts closed. */
    collapsed: z.boolean().default(false),
    /** Missing: the defaults of the type. */
    options,
  });

export const LayoutBlockSchema = z.discriminatedUnion('type', [
  blockOf('scoreboard', BLOCK_OPTIONS.scoreboard.prefault({})),
  blockOf('momentum', BLOCK_OPTIONS.momentum.prefault({})),
  blockOf('comparison', BLOCK_OPTIONS.comparison.prefault({})),
  blockOf('players', BLOCK_OPTIONS.players.prefault({})),
  blockOf('court', BLOCK_OPTIONS.court.prefault({})),
  blockOf('rotations', BLOCK_OPTIONS.rotations.prefault({})),
  blockOf('logo', BLOCK_OPTIONS.logo.prefault({})),
  blockOf('sponsor', BLOCK_OPTIONS.sponsor.prefault({})),
  blockOf('message', BLOCK_OPTIONS.message.prefault({})),
  blockOf('qr', BLOCK_OPTIONS.qr.prefault({})),
  blockOf('lastPoint', BLOCK_OPTIONS.lastPoint.prefault({})),
  blockOf('setScores', BLOCK_OPTIONS.setScores.prefault({})),
  blockOf('topPlayers', BLOCK_OPTIONS.topPlayers.prefault({})),
  blockOf('setScorers', BLOCK_OPTIONS.setScorers.prefault({})),
  blockOf('aces', BLOCK_OPTIONS.aces.prefault({})),
  blockOf('blocks', BLOCK_OPTIONS.blocks.prefault({})),
  blockOf('attack', BLOCK_OPTIONS.attack.prefault({})),
  blockOf('roleDuel', BLOCK_OPTIONS.roleDuel.prefault({})),
  blockOf('teamDuel', BLOCK_OPTIONS.teamDuel.prefault({})),
  blockOf('nextMatch', BLOCK_OPTIONS.nextMatch.prefault({})),
  blockOf('standings', BLOCK_OPTIONS.standings.prefault({})),
]);
export type LayoutBlock = z.output<typeof LayoutBlockSchema>;
export type LayoutBlockInput = z.input<typeof LayoutBlockSchema>;
/** Options of the block of type `T`. */
export type BlockOptions<T extends BlockType> = z.output<(typeof BLOCK_OPTIONS)[T]>;

/** Blocks of one device: unique ids, at most one scoreboard, widths allowed for each type. */
export const DeviceBlocksSchema = z
  .array(LayoutBlockSchema)
  .max(LAYOUT_MAX_BLOCKS)
  .superRefine((blocks, ctx) => {
    const ids = new Set<string>();
    let scoreboards = 0;
    blocks.forEach((block, index) => {
      if (ids.has(block.id)) ctx.addIssue({ code: 'custom', message: 'id ripetuto', path: [index, 'id'] });
      ids.add(block.id);
      if (block.type === 'scoreboard') scoreboards += 1;
      if (!BLOCK_WIDTHS[block.type].includes(block.width))
        ctx.addIssue({ code: 'custom', message: 'larghezza non ammessa', path: [index, 'width'] });
    });
    if (scoreboards > 1) ctx.addIssue({ code: 'custom', message: 'un solo tabellone per dispositivo' });
  });

/** Default page of every device (the portal before the editor): the six blocks of the match, the scoreboard first. */
const DEFAULT_LAYOUT_INPUT: Record<LayoutDevice, LayoutBlockInput[]> = {
  tv: [
    { id: 'scoreboard', type: 'scoreboard', width: 12 },
    { id: 'momentum', type: 'momentum', width: 8 },
    { id: 'comparison', type: 'comparison', width: 4 },
    { id: 'players', type: 'players', width: 12 },
    { id: 'court', type: 'court', width: 6 },
    { id: 'rotations', type: 'rotations', width: 6 },
  ],
  tablet: [
    { id: 'scoreboard', type: 'scoreboard', width: 12 },
    { id: 'momentum', type: 'momentum', width: 6 },
    { id: 'comparison', type: 'comparison', width: 6 },
    { id: 'players', type: 'players', width: 12 },
    { id: 'court', type: 'court', width: 6 },
    { id: 'rotations', type: 'rotations', width: 6 },
  ],
  phone: [
    { id: 'scoreboard', type: 'scoreboard' },
    { id: 'momentum', type: 'momentum' },
    { id: 'comparison', type: 'comparison', collapsed: true },
    { id: 'players', type: 'players', collapsed: true },
    { id: 'court', type: 'court', collapsed: true },
    { id: 'rotations', type: 'rotations', collapsed: true },
  ],
};

/** Pure: the default blocks of a device for a template (a new list at every call). */
export function defaultDeviceBlocks(device: LayoutDevice, template: TemplateId = 'standard'): LayoutBlock[] {
  return DeviceBlocksSchema.parse(TEMPLATES[template].layout?.[device] ?? DEFAULT_LAYOUT_INPUT[device]);
}

/** Pure: a block of `type` with the default options, the first allowed width not over `preferred` (12 if none). */
export function newBlock(type: BlockType, id: string, preferred: number = LAYOUT_COLUMNS): LayoutBlock {
  const widths = BLOCK_WIDTHS[type];
  const width = [...widths].reverse().find((w) => w <= preferred) ?? widths[0] ?? LAYOUT_COLUMNS;
  return LayoutBlockSchema.parse({ id, type, width });
}

/**
 * Layout document of a client. Every device has a default (the empty document of the database reads as the default
 * page); strict and versioned like the other configuration documents.
 */
export const TenantLayoutSchema = z.strictObject({
  version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION),
  tv: DeviceBlocksSchema.default(() => defaultDeviceBlocks('tv')),
  tablet: DeviceBlocksSchema.default(() => defaultDeviceBlocks('tablet')),
  phone: DeviceBlocksSchema.default(() => defaultDeviceBlocks('phone')),
  /**
   * «Touch» of every device: with `false` the public page shows nothing to tap or click (no buttons, selectors or
   * links) and the charts keep their default view. Missing in the documents saved before: `true`.
   */
  touch: z
    .strictObject({
      tv: z.boolean().default(true),
      tablet: z.boolean().default(true),
      phone: z.boolean().default(true),
    })
    .default({ tv: true, tablet: true, phone: true }),
});
export type TenantLayout = z.output<typeof TenantLayoutSchema>;
export type TenantLayoutInput = z.input<typeof TenantLayoutSchema>;

/** Pure: the default layout of every device, for a template (default: the standard one). */
export function defaultLayout(template: TemplateId = 'standard'): TenantLayout {
  const layout = TenantLayoutSchema.parse({});
  if (template === 'standard') return layout;
  for (const device of LAYOUT_DEVICES) layout[device] = defaultDeviceBlocks(device, template);
  return layout;
}

/**
 * Pure: a stored layout with the missing fields filled; an invalid one reads as the defaults. A device the client has
 * never saved takes the default page of the template of the client.
 */
export function resolveLayout(document: unknown, template: TemplateId = 'standard'): TenantLayout {
  const parsed = TenantLayoutSchema.safeParse(document ?? {});
  if (!parsed.success) return defaultLayout(template);
  const stored = document !== null && typeof document === 'object' ? (document as Record<string, unknown>) : {};
  for (const device of LAYOUT_DEVICES)
    if (stored[device] === undefined) parsed.data[device] = defaultDeviceBlocks(device, template);
  return parsed.data;
}

/** Pure: ids of the images used by the blocks of a layout (each once, in order of appearance). */
export function layoutImageIds(layout: TenantLayout): string[] {
  const ids = new Set<string>();
  for (const device of LAYOUT_DEVICES)
    for (const block of layout[device])
      if (block.type === 'sponsor') for (const id of block.options.images) ids.add(id);
  return [...ids];
}

/** Pure: ids of the sponsors chosen by the blocks of a layout (each once, in order of appearance). */
export function layoutSponsorIds(layout: TenantLayout): string[] {
  const ids = new Set<string>();
  for (const device of LAYOUT_DEVICES)
    for (const block of layout[device])
      if (block.type === 'sponsor') for (const id of block.options.sponsors) ids.add(id);
  return [...ids];
}

/** `GET/PUT /api/admin/layout`: the layout of the client of the session (the body of PUT is the layout). */
export const LayoutResponseSchema = z.object({ tenantName: z.string(), layout: TenantLayoutSchema });
export type LayoutResponse = z.infer<typeof LayoutResponseSchema>;
