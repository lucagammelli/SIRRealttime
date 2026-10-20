import { z } from 'zod';

/** Id of an uploaded image (row of `assets`). */
export const AssetIdSchema = z.uuid();

/** Use of an image: logos of the branding, sponsor images. */
export const AssetKindSchema = z.enum(['logo', 'sponsor']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** Image types accepted, recognized from the bytes (never from a name or a declared type). */
export const AssetMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
export type AssetMime = z.infer<typeof AssetMimeSchema>;

/** Largest image accepted (decoded bytes). */
export const ASSET_MAX_BYTES = 2 * 1024 * 1024;
/** Length of the base64 text of an image of ASSET_MAX_BYTES (with padding). */
export const ASSET_MAX_BASE64_LENGTH = Math.ceil(ASSET_MAX_BYTES / 3) * 4;

/**
 * `POST /api/admin/assets`: the image as base64 in a JSON body (the admin routes accept only JSON). No name and no
 * type: the server recognizes the type from the bytes and names the file after its sha256.
 */
export const UploadAssetRequestSchema = z.strictObject({
  kind: AssetKindSchema,
  data: z.base64().min(4).max(ASSET_MAX_BASE64_LENGTH),
  /** Sponsor of the client the image belongs to (only for `kind: 'sponsor'`; id of `sponsors`, see sponsors.ts). */
  sponsorId: z.uuid().optional(),
});
export type UploadAssetRequest = z.infer<typeof UploadAssetRequestSchema>;

export const AssetSummarySchema = z.object({
  id: AssetIdSchema,
  kind: AssetKindSchema,
  mime: AssetMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  /** Public path of the file (`/api/public/assets/<id>`), valid on the hostnames of the client. */
  url: z.string(),
  /** Sponsor the image belongs to (null: none; missing in an older answer: none). */
  sponsorId: z.uuid().nullable().default(null),
});
export type AssetSummary = z.infer<typeof AssetSummarySchema>;

/** `PATCH /api/admin/assets/:id`: gives a sponsor image to a sponsor of the client, or takes it away (null). */
export const UpdateAssetRequestSchema = z.strictObject({ sponsorId: z.uuid().nullable() });
export type UpdateAssetRequest = z.infer<typeof UpdateAssetRequestSchema>;

/** `GET /api/admin/assets`: images of the client and the space they use. */
export const AssetListResponseSchema = z.object({
  assets: z.array(AssetSummarySchema),
  usedBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().positive(),
});
export type AssetListResponse = z.infer<typeof AssetListResponseSchema>;
