import { z } from 'zod';
import { ASSET_MAX_BASE64_LENGTH, AssetMimeSchema } from './assets.js';

/**
 * Logos of the platform («loghi di sistema»): one on the left and one on the right of the header of the public live
 * page and of the reserved area, the same for every client. Only the superadmin loads, replaces or removes them; a
 * missing logo takes no room.
 */

export const SYSTEM_LOGO_SLOTS = ['left', 'right'] as const;
export const SystemLogoSlotSchema = z.enum(SYSTEM_LOGO_SLOTS);
export type SystemLogoSlot = z.infer<typeof SystemLogoSlotSchema>;

/** Largest logo accepted (pixels; an SVG by its declared size): a larger one is refused at upload. */
export const SYSTEM_LOGO_MAX_WIDTH = 150;
export const SYSTEM_LOGO_MAX_HEIGHT = 50;

/** Pure: whether a logo of `width` × `height` px fits in SYSTEM_LOGO_MAX_WIDTH × SYSTEM_LOGO_MAX_HEIGHT. */
export const systemLogoFits = (width: number, height: number): boolean =>
  width <= SYSTEM_LOGO_MAX_WIDTH && height <= SYSTEM_LOGO_MAX_HEIGHT;

/** `PUT /api/admin/system-logos/:slot`: the image as base64 (type recognized from the bytes by the server). */
export const UploadSystemLogoRequestSchema = z.strictObject({
  data: z.base64().min(4).max(ASSET_MAX_BASE64_LENGTH),
});
export type UploadSystemLogoRequest = z.infer<typeof UploadSystemLogoRequestSchema>;

/** `:slot` of the admin routes. */
export const SystemLogoSlotParamSchema = z.object({ slot: SystemLogoSlotSchema });

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

/**
 * `GET /api/public/system-logos` (and the answer of the admin routes): the two logos, null when not loaded. The
 * same for every hostname and client.
 */
export const SystemLogosSchema = z.object({
  left: SystemLogoSchema.nullable(),
  right: SystemLogoSchema.nullable(),
});
export type SystemLogos = z.infer<typeof SystemLogosSchema>;

/** No system logo loaded. */
export const NO_SYSTEM_LOGOS: SystemLogos = { left: null, right: null };
