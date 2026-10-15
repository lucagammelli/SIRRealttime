import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import type { QrLayout } from './qrImage.ts';
import {
  logoImageBox,
  QR_CAPTION_PX,
  QR_LOGO_RATIO,
  QR_QUIET_MODULES,
  QR_SIZE_PX,
  qrLayout,
  qrMatrix,
  qrPixels,
  qrSvg,
} from './qrImage.ts';

const URLS = [
  'http://localhost:5173/l/K7M2QX9P',
  'https://portale.example.org/l/ABCDEFGH',
  'https://diretta.societa-pallavolo-molto-lunga.example.it/l/Z9Y8X7W6',
];

const decode = (px: Uint8ClampedArray, width: number, height: number): string | null =>
  jsQR(px, width, height)?.data ?? null;

/** Worst case of a logo: a dense pseudo-random pattern of dark pixels over the whole logo image box. */
function paintLogo(px: Uint8ClampedArray, layout: QrLayout): void {
  const box = logoImageBox(layout);
  if (!box) throw new Error('no logo box');
  let seed = 12345;
  for (let y = box.y; y < box.y + box.size; y++) {
    for (let x = box.x; x < box.x + box.size; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const dark = ((x >> 4) + (y >> 4) + (seed & 1)) % 2 === 0;
      const i = (y * layout.side + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = dark ? 0 : 255;
    }
  }
}

/** Pixels of the square as drawn by the SVG path (`M x y h w v m h -w z` runs). */
function rasterizeSvg(svg: string, side: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(side * side * 4).fill(255);
  const d = /<path d="([^"]*)"/.exec(svg)?.[1] ?? '';
  for (const run of d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
    const [x0, y0, w, h] = run.slice(1).map(Number) as [number, number, number, number];
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * side + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
  }
  const rect = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(svg);
  if (rect) {
    const [x0, y0, w, h] = rect.slice(1).map(Number) as [number, number, number, number];
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * side + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 255;
      }
  }
  return px;
}

describe('QR of the short links', () => {
  it('lays out the symbol with the quiet zone and a logo box of at most 20% of the side', () => {
    const matrix = qrMatrix(URLS[2] ?? '');
    const layout = qrLayout(matrix.size, true);
    expect(layout.side).toBe(QR_SIZE_PX);
    expect(layout.offset).toBeGreaterThanOrEqual(QR_QUIET_MODULES * layout.modulePx);
    expect(layout.offset + matrix.size * layout.modulePx).toBeLessThanOrEqual(
      QR_SIZE_PX - QR_QUIET_MODULES * layout.modulePx,
    );
    expect(layout.logo?.size).toBeLessThanOrEqual(Math.ceil(matrix.size * layout.modulePx * QR_LOGO_RATIO));
    expect(qrLayout(matrix.size, false).logo).toBeNull();
  });

  it.each(URLS)('decodes the PNG pixels into the right URL, with and without logo: %s', (url) => {
    const matrix = qrMatrix(url);
    const plain = qrLayout(matrix.size, false);
    expect(decode(qrPixels(matrix, plain), plain.side, plain.side)).toBe(url);
    const withLogo = qrLayout(matrix.size, true);
    const px = qrPixels(matrix, withLogo);
    paintLogo(px, withLogo);
    expect(decode(px, withLogo.side, withLogo.side)).toBe(url);
  });

  it.each(URLS)('decodes the SVG modules into the right URL, with and without logo: %s', (url) => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    for (const logoDataUrl of [null, logo]) {
      const svg = qrSvg(url, { caption: 'K7M2-QX9P', logoDataUrl });
      expect(svg).toContain(`viewBox="0 0 ${QR_SIZE_PX} ${QR_SIZE_PX + QR_CAPTION_PX}"`);
      expect(svg).toContain('>K7M2-QX9P</text>');
      expect(svg.includes('<image')).toBe(logoDataUrl !== null);
      expect(decode(rasterizeSvg(svg, QR_SIZE_PX), QR_SIZE_PX, QR_SIZE_PX)).toBe(url);
    }
  });

  it('leaves out a logo that is not a raster data URL and escapes the caption', () => {
    for (const logoDataUrl of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', '/api/x" onload="y'])
      expect(qrSvg(URLS[0] ?? '', { caption: 'x', logoDataUrl })).not.toContain('<image');
    const svg = qrSvg(URLS[0] ?? '', { caption: '<b>&"', logoDataUrl: null });
    expect(svg).toContain('&lt;b&gt;&amp;&quot;');
    expect(svg).not.toContain('<b>');
  });
});
