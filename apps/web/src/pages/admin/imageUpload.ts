import type { AssetKind, AssetSummary } from '@arenalive/shared';
import {
  ASSET_MAX_BYTES,
  AssetSummarySchema,
  VIDEO_MAX_BYTES,
  VIDEO_UPLOAD_PATH,
  VideoMimeSchema,
} from '@arenalive/shared';
import { apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';

/** Upload of the images of the client (logos of the «Studio grafico», images of the sponsors, backgrounds of the overlays) and of the videos of the backgrounds. */

/** Types of image accepted by the file inputs (the server checks the bytes anyway). */
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

/** Text shown when a chosen image is over the limit (nothing is sent). */
export const IMAGE_TOO_LARGE = 'Immagine troppo grande: al massimo 2 MB.';

/**
 * Uploads an image of the client of `kind` (a sponsor image optionally for one of its sponsors); null when the file is
 * over ASSET_MAX_BYTES (nothing sent).
 */
export async function uploadImage(file: File, kind: AssetKind, sponsorId?: string): Promise<AssetSummary | null> {
  if (file.size > ASSET_MAX_BYTES) return null;
  const data = await fileToBase64(file);
  return apiRequest('/api/admin/assets', AssetSummarySchema, {
    method: 'POST',
    body: { kind, data, ...(sponsorId === undefined ? {} : { sponsorId }) },
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
 * Uploads a video for the backgrounds of the overlays as bytes (never base64); throws an Error with the text of
 * `videoProblem` when it is refused before sending.
 */
export async function uploadVideo(file: File): Promise<AssetSummary> {
  const problem = videoProblem(file);
  if (problem) throw new Error(problem);
  return apiRequest(VIDEO_UPLOAD_PATH, AssetSummarySchema, { method: 'POST', file });
}

/** Uploads a sponsor image for a sponsor of the client (see `uploadImage`). */
export const uploadSponsorImage = (file: File, sponsorId: string): Promise<AssetSummary | null> =>
  uploadImage(file, 'sponsor', sponsorId);

/** Pure: «1 immagine», «3 immagini», «nessuna immagine». */
export const imageCountText = (n: number): string =>
  n === 0 ? 'nessuna immagine' : n === 1 ? '1 immagine' : `${n} immagini`;
