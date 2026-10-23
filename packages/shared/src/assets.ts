import { z } from 'zod';

/** Id of an uploaded image (row of `assets`). */
export const AssetIdSchema = z.uuid();

/** Use of a file: logos of the branding, sponsor images, backgrounds of the overlays (image or video). */
export const AssetKindSchema = z.enum(['logo', 'sponsor', 'overlay']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** Image types accepted, recognized from the bytes (never from a name or a declared type). */
export const AssetMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
export type AssetMime = z.infer<typeof AssetMimeSchema>;

/** Video types accepted (only as backgrounds of the overlays), recognized from the bytes: MP4 and WebM. */
export const VideoMimeSchema = z.enum(['video/mp4', 'video/webm']);
export type VideoMime = z.infer<typeof VideoMimeSchema>;

/** Type of a stored file: an image or a video. */
export const AssetFileMimeSchema = z.enum([...AssetMimeSchema.options, ...VideoMimeSchema.options]);
export type AssetFileMime = z.infer<typeof AssetFileMimeSchema>;

/** Pure: true for the type of a video. */
export const isVideoMime = (mime: string): mime is VideoMime => (VideoMimeSchema.options as string[]).includes(mime);

/** Largest video accepted (bytes of the file). */
export const VIDEO_MAX_BYTES = 15 * 1024 * 1024;

/**
 * `POST /api/admin/assets/video`: the bytes of an MP4 or WebM file as the body (`application/octet-stream`, never
 * base64): a background of the overlays (kind `overlay`).
 */
export const VIDEO_UPLOAD_PATH = '/api/admin/assets/video';

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
  mime: AssetFileMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  /**
   * Path of the file for the reserved area (`/api/admin/assets/<id>/file`, see adminAssetPath): valid whatever the
   * hostname. The public pages use publicAssetPath.
   */
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
