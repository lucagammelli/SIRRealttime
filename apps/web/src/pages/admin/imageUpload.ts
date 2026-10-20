import type { AssetKind, AssetSummary } from '@sir/shared';
import { ASSET_MAX_BYTES, AssetSummarySchema } from '@sir/shared';
import { apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';

/** Upload of the images of the client (logos of the «Studio grafico», images of the sponsors). */

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

/** Uploads a sponsor image for a sponsor of the client (see `uploadImage`). */
export const uploadSponsorImage = (file: File, sponsorId: string): Promise<AssetSummary | null> =>
  uploadImage(file, 'sponsor', sponsorId);

/** Pure: «1 immagine», «3 immagini», «nessuna immagine». */
export const imageCountText = (n: number): string =>
  n === 0 ? 'nessuna immagine' : n === 1 ? '1 immagine' : `${n} immagini`;
