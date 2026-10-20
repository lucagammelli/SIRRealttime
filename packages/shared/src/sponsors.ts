import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { plainText } from './strings.js';

/**
 * Sponsors of a client («Sponsor» of the reserved area): name, optional website and one or more images (rows of
 * `assets` with their `sponsor_id`). The sponsor blocks of the public page and the sponsor slides of the pauses choose
 * sponsors, and show all their images in turn.
 */

/** Id of a sponsor (row of `sponsors`). */
export const SponsorIdSchema = z.uuid();

export const SPONSOR_NAME_MAX = 80;
export const SPONSOR_WEBSITE_MAX = 300;
/** Most sponsors of one client. */
export const SPONSORS_MAX = 50;
/** Most images of one sponsor. */
export const SPONSOR_IMAGES_MAX = 12;

/** Pure: true for an absolute `https://` address with a host (never another scheme, never credentials). */
export function isSponsorWebsite(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
}

/** Website of a sponsor: only `https://` (it becomes a link of the public page). */
export const SponsorWebsiteSchema = z
  .string()
  .trim()
  .max(SPONSOR_WEBSITE_MAX)
  .refine(isSponsorWebsite, { message: 'indirizzo non valido: solo https://' })
  // Normalized (scheme and host in lower case): «HTTPS://X.it» is stored as «https://x.it/».
  .transform((text) => new URL(text).href);

export const SponsorNameSchema = plainText(SPONSOR_NAME_MAX);

/** A sponsor as the admin pages see it: its images in order of upload. */
export const SponsorSchema = z.object({
  id: SponsorIdSchema,
  name: z.string(),
  website: z.string().nullable(),
  /** Place in the list of the client (0 first): the order of the rotation. */
  position: z.number().int().nonnegative(),
  imageIds: z.array(AssetIdSchema),
  createdAt: z.iso.datetime(),
});
export type Sponsor = z.infer<typeof SponsorSchema>;

/** `GET /api/admin/sponsors`: the sponsors of the client in their order. */
export const SponsorListResponseSchema = z.object({ sponsors: z.array(SponsorSchema) });
export type SponsorListResponse = z.infer<typeof SponsorListResponseSchema>;

/** `POST /api/admin/sponsors`: a new sponsor, last in the list. */
export const CreateSponsorRequestSchema = z.strictObject({
  name: SponsorNameSchema,
  website: SponsorWebsiteSchema.nullable().default(null),
});
export type CreateSponsorRequest = z.infer<typeof CreateSponsorRequestSchema>;

/** `PATCH /api/admin/sponsors/:id`: name and/or website (null: none); at least one field. */
export const UpdateSponsorRequestSchema = z
  .strictObject({
    name: SponsorNameSchema.optional(),
    website: SponsorWebsiteSchema.nullable().optional(),
  })
  .refine((r) => r.name !== undefined || r.website !== undefined, { message: 'nessun campo da modificare' });
export type UpdateSponsorRequest = z.infer<typeof UpdateSponsorRequestSchema>;

/** `PUT /api/admin/sponsors/order`: every sponsor of the client, once, in the new order. */
export const SponsorOrderRequestSchema = z.strictObject({
  ids: z
    .array(SponsorIdSchema)
    .max(SPONSORS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'sponsor ripetuto' }),
});
export type SponsorOrderRequest = z.infer<typeof SponsorOrderRequestSchema>;

/** A sponsor as the public pages see it (only the ones chosen by the page or the pauses). */
export const PublicSponsorSchema = z.object({
  id: SponsorIdSchema,
  name: z.string(),
  website: SponsorWebsiteSchema.nullable(),
  /** Public paths of its images (`/api/public/assets/<id>`). */
  images: z.array(z.string()),
});
export type PublicSponsor = z.infer<typeof PublicSponsorSchema>;
