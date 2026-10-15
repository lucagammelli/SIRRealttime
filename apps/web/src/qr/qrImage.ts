import { create } from 'qrcode';

/**
 * QR codes of the public links, made in the browser without network. Pure functions: the matrix (error correction
 * H, about 30% of the symbol can be lost), the layout of the printed image (quiet zone, logo box, caption) and the
 * pixels / SVG of the image. The canvas part (logo and caption text of the PNG) is in qrCanvas.ts.
 *
 * Colours: always black on white, whatever the theme of the portal: a QR must be printed and scanned (not UI tokens).
 */
export const QR_DARK = '#000000';
export const QR_LIGHT = '#ffffff';

/** Side of the square QR image in pixels (PNG for printing). */
export const QR_SIZE_PX = 1024;
/** Quiet zone around the symbol, in modules (the standard asks for 4). */
export const QR_QUIET_MODULES = 4;
/** Side of the logo box (white padding included) as a fraction of the symbol side: small enough to stay readable. */
export const QR_LOGO_RATIO = 0.2;
/** Height of the band with the code under the square. */
export const QR_CAPTION_PX = 160;

export interface QrMatrix {
  /** Modules per side. */
  size: number;
  isDark(row: number, col: number): boolean;
}

/** Pure: modules of the QR code of `text`, error correction H. */
export function qrMatrix(text: string): QrMatrix {
  const { modules } = create(text, { errorCorrectionLevel: 'H' });
  return { size: modules.size, isDark: (row, col) => modules.get(row, col) === 1 };
}

export interface Box {
  x: number;
  y: number;
  size: number;
}

export interface QrLayout {
  /** Side of the square (pixels). */
  side: number;
  modules: number;
  /** Pixels per module (an integer: sharp edges). */
  modulePx: number;
  /** Left/top pixel of the first module (quiet zone plus the rest of the integer division, centred). */
  offset: number;
  /** Box of the logo in the middle of the symbol, null without logo. */
  logo: Box | null;
}

/** Pure: where the modules and the logo go in a square of `side` pixels. */
export function qrLayout(modules: number, withLogo: boolean, side = QR_SIZE_PX): QrLayout {
  const modulePx = Math.max(1, Math.floor(side / (modules + 2 * QR_QUIET_MODULES)));
  const symbolPx = modules * modulePx;
  const offset = Math.floor((side - symbolPx) / 2);
  let logo: Box | null = null;
  if (withLogo) {
    const size = Math.round(symbolPx * QR_LOGO_RATIO);
    const start = offset + Math.round((symbolPx - size) / 2);
    logo = { x: start, y: start, size };
  }
  return { side, modules, modulePx, offset, logo };
}

/** Pure: box of the logo image inside the white logo box (a margin of about one module on each side). */
export function logoImageBox(layout: QrLayout): Box | null {
  if (!layout.logo) return null;
  const pad = Math.max(layout.modulePx, Math.round(layout.logo.size * 0.08));
  return { x: layout.logo.x + pad, y: layout.logo.y + pad, size: layout.logo.size - 2 * pad };
}

/**
 * Pure: RGBA pixels (side × side) of the square: dark modules on white, the logo box (if any) left white for the
 * logo drawn on top.
 */
export function qrPixels(matrix: QrMatrix, layout: QrLayout): Uint8ClampedArray<ArrayBuffer> {
  const { side, modulePx, offset, logo } = layout;
  const px = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.isDark(row, col)) continue;
      const x0 = offset + col * modulePx;
      const y0 = offset + row * modulePx;
      for (let y = y0; y < y0 + modulePx; y++) {
        const line = y * side;
        for (let x = x0; x < x0 + modulePx; x++) {
          if (logo && x >= logo.x && x < logo.x + logo.size && y >= logo.y && y < logo.y + logo.size) continue;
          const i = (line + x) * 4;
          px[i] = 0;
          px[i + 1] = 0;
          px[i + 2] = 0;
        }
      }
    }
  }
  return px;
}

const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** Data URLs of images accepted inside the SVG (the logo, read by the browser): raster formats in base64 only. */
const LOGO_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export interface QrSvgOptions {
  /** Text under the square (the short code, e.g. «K7M2-QX9P»). */
  caption: string;
  /** Logo as a data URL (png, jpeg or webp in base64); anything else is left out. */
  logoDataUrl?: string | null;
}

/**
 * Pure: SVG image (QR square plus caption band) of `text`. The dark modules of each row are merged in runs, one
 * path for the whole symbol; the logo box is painted white over them (as `qrPixels` does) with the logo inside.
 */
export function qrSvg(text: string, options: QrSvgOptions): string {
  const matrix = qrMatrix(text);
  const logoUrl = options.logoDataUrl && LOGO_DATA_URL.test(options.logoDataUrl) ? options.logoDataUrl : null;
  const layout = qrLayout(matrix.size, logoUrl !== null);
  const { side, modulePx: m, offset, logo } = layout;
  const height = side + QR_CAPTION_PX;
  let path = '';
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      path += `M${offset + start * m} ${offset + row * m}h${(col - start) * m}v${m}h${-(col - start) * m}z`;
    }
  }
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${height}" width="${side}" height="${height}">`,
    `<rect width="${side}" height="${height}" fill="${QR_LIGHT}"/>`,
    `<path d="${path}" fill="${QR_DARK}" shape-rendering="crispEdges"/>`,
  ];
  const image = logoImageBox(layout);
  if (logo && image && logoUrl) {
    parts.push(
      `<rect x="${logo.x}" y="${logo.y}" width="${logo.size}" height="${logo.size}" fill="${QR_LIGHT}"/>`,
      `<image x="${image.x}" y="${image.y}" width="${image.size}" height="${image.size}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(logoUrl)}"/>`,
    );
  }
  parts.push(
    `<text x="${side / 2}" y="${side + QR_CAPTION_PX / 2}" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="700" font-size="96" letter-spacing="8" fill="${QR_DARK}">${escapeXml(options.caption)}</text>`,
    '</svg>',
  );
  return parts.join('');
}

/** Pure: data URL of an SVG document (usable as `src` of an <img> under the CSP `img-src 'self' data:`). */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
