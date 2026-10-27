import { z } from 'zod';
import { ASSET_MAX_BASE64_LENGTH, AssetMimeSchema } from './assets.js';
import { HEX_COLOR_PATTERN, relativeLuminance } from './colors.js';

/**
 * Logos of the platform («loghi di sistema»): one on the left and one on the right, the same for every client, each
 * in two variants: `positive` for light backgrounds and `negative` for dark ones (pickSystemLogo chooses by the real
 * background). The left one stands at the top of the sidebar of the reserved area; both stand in the header of the
 * public live page. Only the superadmin loads, replaces or removes them; a missing logo takes no room.
 */

export const SYSTEM_LOGO_SLOTS = ['left', 'right'] as const;
export const SystemLogoSlotSchema = z.enum(SYSTEM_LOGO_SLOTS);
export type SystemLogoSlot = z.infer<typeof SystemLogoSlotSchema>;

/** `positive`: drawn for light backgrounds; `negative`: for dark ones. */
export const SYSTEM_LOGO_VARIANTS = ['positive', 'negative'] as const;
export const SystemLogoVariantSchema = z.enum(SYSTEM_LOGO_VARIANTS);
export type SystemLogoVariant = z.infer<typeof SystemLogoVariantSchema>;

/** Largest logo accepted (pixels; an SVG by its declared size): a larger one is refused at upload. */
export const SYSTEM_LOGO_MAX_WIDTH = 180;
export const SYSTEM_LOGO_MAX_HEIGHT = 50;

/** Pure: whether a logo of `width` × `height` px fits in SYSTEM_LOGO_MAX_WIDTH × SYSTEM_LOGO_MAX_HEIGHT. */
export const systemLogoFits = (width: number, height: number): boolean =>
  width <= SYSTEM_LOGO_MAX_WIDTH && height <= SYSTEM_LOGO_MAX_HEIGHT;

/** `PUT /api/admin/system-logos/:slot/:variant`: the image as base64 (type recognized from the bytes by the server). */
export const UploadSystemLogoRequestSchema = z.strictObject({
  data: z.base64().min(4).max(ASSET_MAX_BASE64_LENGTH),
});
export type UploadSystemLogoRequest = z.infer<typeof UploadSystemLogoRequestSchema>;

/** `:slot` and `:variant` of the admin routes. */
export const SystemLogoSlotParamSchema = z.object({ slot: SystemLogoSlotSchema, variant: SystemLogoVariantSchema });
export type SystemLogoSlotParam = z.infer<typeof SystemLogoSlotParamSchema>;

/** Path of the file of a system logo (the id changes with every upload: cached a year). */
export const systemLogoPath = (id: string): string => `/api/public/system-logos/${id}`;

export const SystemLogoSchema = z.object({
  /** Public path of the file (systemLogoPath). */
  url: z.string(),
  mime: AssetMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type SystemLogo = z.infer<typeof SystemLogoSchema>;

/** The two variants of one side, null when not loaded. */
export const SystemLogoPairSchema = z.object({
  positive: SystemLogoSchema.nullable(),
  negative: SystemLogoSchema.nullable(),
});
export type SystemLogoPair = z.infer<typeof SystemLogoPairSchema>;

/**
 * `GET /api/public/system-logos` (and the answer of the admin routes): the two variants of the two sides, null when
 * not loaded. The same for every hostname and client.
 */
export const SystemLogosSchema = z.object({
  left: SystemLogoPairSchema,
  right: SystemLogoPairSchema,
});
export type SystemLogos = z.infer<typeof SystemLogosSchema>;

const NO_PAIR: SystemLogoPair = { positive: null, negative: null };
/** No system logo loaded. */
export const NO_SYSTEM_LOGOS: SystemLogos = { left: NO_PAIR, right: NO_PAIR };

/** Luminance below which a background counts as dark (the same threshold as ensureContrast). */
export const DARK_BACKGROUND_LUMINANCE = 0.5;

/** Pure: the variant meant for `background` (`#rrggbb`): negative on a dark one, positive otherwise (or unknown). */
export function systemLogoVariantFor(background: string | null): SystemLogoVariant {
  if (background === null || !HEX_COLOR_PATTERN.test(background.trim().toLowerCase())) return 'positive';
  return relativeLuminance(background) < DARK_BACKGROUND_LUMINANCE ? 'negative' : 'positive';
}

/**
 * Pure: the logo of a side to draw on `background` (`#rrggbb`, null when unknown: positive), with the variant
 * actually used; the other variant when the right one is missing, null when the side has none.
 */
export function pickSystemLogo(
  pair: SystemLogoPair,
  background: string | null,
): { logo: SystemLogo; variant: SystemLogoVariant } | null {
  const wanted = systemLogoVariantFor(background);
  const other: SystemLogoVariant = wanted === 'positive' ? 'negative' : 'positive';
  const first = pair[wanted];
  if (first) return { logo: first, variant: wanted };
  const second = pair[other];
  return second ? { logo: second, variant: other } : null;
}

/** Pure: whether a side has at least one variant loaded. */
export const hasSystemLogo = (pair: SystemLogoPair): boolean => pair.positive !== null || pair.negative !== null;
