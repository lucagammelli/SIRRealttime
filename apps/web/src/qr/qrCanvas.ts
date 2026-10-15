import type { Box } from './qrImage.ts';
import { logoImageBox, QR_CAPTION_PX, QR_DARK, QR_LIGHT, qrLayout, qrMatrix, qrPixels } from './qrImage.ts';

/** Browser part of the QR images: the PNG drawn on a canvas (modules, logo, caption) and the logo as a data URL. */

export class QrRenderError extends Error {
  readonly code = 'QR_RENDER_FAILED';
}

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Reads an image of the client (same origin) as a data URL; null when missing, not an image or unreadable. */
export async function readLogoDataUrl(src: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(src, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!LOGO_TYPES.has(blob.type)) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draws `img` inside `box` keeping its proportions (centred). */
function drawContained(ctx: CanvasRenderingContext2D, img: HTMLImageElement, box: Box): void {
  const w = img.naturalWidth || box.size;
  const h = img.naturalHeight || box.size;
  const scale = Math.min(box.size / w, box.size / h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  ctx.drawImage(img, box.x + Math.round((box.size - dw) / 2), box.y + Math.round((box.size - dh) / 2), dw, dh);
}

/**
 * PNG (data URL) of the QR code of `text` for printing: 1024 px square, logo in the middle when given (left out if
 * it cannot be loaded), `caption` in the band under the square.
 */
export async function qrPngDataUrl(
  text: string,
  options: { caption: string; logoDataUrl?: string | null },
): Promise<string> {
  const logo = options.logoDataUrl ? await loadImage(options.logoDataUrl) : null;
  const matrix = qrMatrix(text);
  const layout = qrLayout(matrix.size, logo !== null);
  const canvas = document.createElement('canvas');
  canvas.width = layout.side;
  canvas.height = layout.side + QR_CAPTION_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new QrRenderError('canvas non disponibile');
  ctx.fillStyle = QR_LIGHT;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(new ImageData(qrPixels(matrix, layout), layout.side, layout.side), 0, 0);
  const box = logoImageBox(layout);
  if (logo && box) drawContained(ctx, logo, box);
  ctx.fillStyle = QR_DARK;
  ctx.font = '700 96px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(options.caption, layout.side / 2, layout.side + QR_CAPTION_PX / 2);
  return canvas.toDataURL('image/png');
}
