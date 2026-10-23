import type { AssetKind, AssetSummary } from '@arenalive/shared';
import {
  ASSET_MAX_BYTES,
  AssetSummarySchema,
  cleanAssetName,
  FILE_NAME_HEADER,
  VIDEO_MAX_BYTES,
  isVideoMime,
  VIDEO_UPLOAD_PATH,
  VideoMimeSchema,
} from '@arenalive/shared';
import { apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';
import { formatDay, megabytes } from '../../lib/format.ts';

/** Upload of the images and the videos of the client: only the page «Immagini e video» (`MediaPage`) uploads, the other pages choose from the library. */

/** Types of image accepted by the file inputs (the server checks the bytes anyway). */
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

/** Text shown when a chosen image is over the limit (nothing is sent). */
export const IMAGE_TOO_LARGE = 'Immagine troppo grande: al massimo 2 MB.';

/**
 * Uploads an image of the client of `kind` (a sponsor image optionally for one of its sponsors), with the name of the
 * file (cleaned); null when the file is
 * over ASSET_MAX_BYTES (nothing sent).
 */
export async function uploadImage(file: File, kind: AssetKind, sponsorId?: string): Promise<AssetSummary | null> {
  if (file.size > ASSET_MAX_BYTES) return null;
  const data = await fileToBase64(file);
  const name = cleanAssetName(file.name);
  return apiRequest('/api/admin/assets', AssetSummarySchema, {
    method: 'POST',
    body: { kind, data, ...(sponsorId === undefined ? {} : { sponsorId }), ...(name ? { name } : {}) },
  });
}

/** Types of video accepted by the file inputs (the server checks the bytes anyway). */
export const ACCEPT_VIDEO = VideoMimeSchema.options.join(',');

/** Text shown when a chosen video is over the limit (nothing is sent). */
export const VIDEO_TOO_LARGE = `Video troppo grande: al massimo ${VIDEO_MAX_BYTES / (1024 * 1024)} MB.`;
/** Text shown when the chosen file is not declared as MP4 or WebM by the browser (nothing is sent). */
export const VIDEO_WRONG_TYPE = 'Formato non ammesso: scegli un video MP4 o WebM.';

/** Pure: why a chosen file cannot be sent as a video (type declared by the browser, size), null when it can. */
export function videoProblem(file: Pick<File, 'size' | 'type'>): string | null {
  if (!VideoMimeSchema.safeParse(file.type).success) return VIDEO_WRONG_TYPE;
  if (file.size > VIDEO_MAX_BYTES) return VIDEO_TOO_LARGE;
  return null;
}

/**
 * Uploads a video for the backgrounds of the overlays as bytes (never base64), with the name of the file (cleaned) in
 * FILE_NAME_HEADER; throws an Error with the text of
 * `videoProblem` when it is refused before sending.
 */
export async function uploadVideo(file: File): Promise<AssetSummary> {
  const problem = videoProblem(file);
  if (problem) throw new Error(problem);
  const name = cleanAssetName(file.name);
  return apiRequest(VIDEO_UPLOAD_PATH, AssetSummarySchema, {
    method: 'POST',
    file,
    ...(name ? { headers: { [FILE_NAME_HEADER]: encodeURIComponent(name) } } : {}),
  });
}

/** Pure: «1 immagine», «3 immagini», «nessuna immagine». */
export const imageCountText = (n: number): string =>
  n === 0 ? 'nessuna immagine' : n === 1 ? '1 immagine' : `${n} immagini`;

/**
 * Pure: the name of a file in the lists: its name, or for a file uploaded before the names «Video del 23/10/2026 ·
 * 1920×1080» (the day it was uploaded and its size: never a number of position, which changes with the list).
 */
export function assetLabel(asset: Pick<AssetSummary, 'name' | 'mime' | 'createdAt' | 'width' | 'height'>): string {
  if (asset.name) return asset.name;
  const what = isVideoMime(asset.mime) ? 'Video' : 'Immagine';
  return `${what} del ${formatDay(asset.createdAt)} · ${asset.width}×${asset.height}`;
}

/** Pure: size and weight of a file, «1920×1080 px · 3,2 MB». */
export const assetDetails = (asset: Pick<AssetSummary, 'width' | 'height' | 'bytes'>): string =>
  `${asset.width}×${asset.height} px · ${megabytes(asset.bytes)} MB`;

/** Pure: the text of a file in a list to choose from: name (or the fallback of assetLabel), size and weight. */
export const assetOptionText = (asset: AssetSummary): string =>
  asset.name ? `${asset.name} · ${assetDetails(asset)}` : `${assetLabel(asset)} px · ${megabytes(asset.bytes)} MB`;
