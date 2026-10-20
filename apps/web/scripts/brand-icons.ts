/**
 * Icons of ArenaLive from the logo (public/brand/arenalive-positivo.png): the green symbol at the left of the logo
 * (columns before the first column with a non-green pixel, the text), cropped to its drawing and scaled with a
 * Lanczos-3 filter on premultiplied alpha (the source is small: 150 px wide).
 *
 *   pnpm --filter @arenalive/web exec tsx scripts/brand-icons.ts
 *
 * Writes (paths from apps/web):
 *   public/icons/favicon-32.png          favicon, transparent
 *   public/icons/icon-192.png, -512      PWA icons «any», transparent with a margin
 *   public/icons/icon-maskable-512.png   PWA icon «maskable»: dark background, symbol inside the safe zone (60%)
 *   public/icons/apple-touch-icon.png    180 px, dark background (iOS fills transparency with black)
 *   ../agent-dotnet/src/ArenaLive.Agent.App/arenalive-agent.ico   16, 24, 32, 48, 64, 128, 256 px (PNG entries)
 * and copies the two logos and the .ico to the agents (resources of the C# window, bytes included in the Node agent):
 *   ../agent-dotnet/src/ArenaLive.Agent.App/brand/, ../agent/src/gui/brand/
 * Reuses the PNG reader and writer of trim-logo.ts (no dependency besides node:zlib).
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rgba } from './trim-logo.ts';
import { crop, decodePng, encodePng, opaqueBox } from './trim-logo.ts';

/** Dark background of the opaque icons (the ink of the positive logo). */
export const ICON_BACKGROUND: [number, number, number] = [11, 14, 19];

const isGreen = (r: number, g: number, b: number): boolean => g > r + 40 && g > b + 40;

/** Pure: the green symbol at the left of the logo, cropped to its drawing (other pixels transparent). */
export function extractSymbol(logo: Rgba): Rgba {
  let end = logo.width;
  for (let x = 0; x < logo.width && end === logo.width; x++)
    for (let y = 0; y < logo.height; y++) {
      const i = (y * logo.width + x) * 4;
      const a = logo.data[i + 3] ?? 0;
      if (a > 40 && !isGreen(logo.data[i] ?? 0, logo.data[i + 1] ?? 0, logo.data[i + 2] ?? 0)) {
        end = x;
        break;
      }
    }
  const left = crop(logo, { x: 0, y: 0, w: end, h: logo.height });
  const box = opaqueBox(left, 8);
  if (!box) throw new Error('nessun simbolo verde nel logo');
  return crop(left, box);
}

const lanczos = (x: number, a = 3): number => {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
};

/** Weights of a one-dimensional Lanczos-3 resampling from `src` to `dst` samples. */
function weights(src: number, dst: number): { start: number; w: number[] }[] {
  const scale = dst / src;
  const support = scale < 1 ? 3 / scale : 3;
  return Array.from({ length: dst }, (_, i) => {
    const center = (i + 0.5) / scale - 0.5;
    const start = Math.floor(center - support) + 1;
    const end = Math.floor(center + support);
    const w: number[] = [];
    for (let j = start; j <= end; j++) w.push(lanczos(scale < 1 ? (j - center) * scale : j - center));
    const sum = w.reduce((s, v) => s + v, 0) || 1;
    return { start, w: w.map((v) => v / sum) };
  });
}

/** Pure: `img` scaled to `width` × `height` (Lanczos-3, premultiplied alpha, edges clamped). */
export function resample(img: Rgba, width: number, height: number): Rgba {
  const pre = new Float64Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    const a = (img.data[i * 4 + 3] ?? 0) / 255;
    pre[i * 4] = (img.data[i * 4] ?? 0) * a;
    pre[i * 4 + 1] = (img.data[i * 4 + 1] ?? 0) * a;
    pre[i * 4 + 2] = (img.data[i * 4 + 2] ?? 0) * a;
    pre[i * 4 + 3] = a * 255;
  }
  const wx = weights(img.width, width);
  const wy = weights(img.height, height);
  const mid = new Float64Array(width * img.height * 4);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < width; x++) {
      const { start, w } = wx[x] ?? { start: 0, w: [] };
      for (let k = 0; k < w.length; k++) {
        const sx = Math.min(img.width - 1, Math.max(0, start + k));
        for (let c = 0; c < 4; c++) {
          const at = (y * width + x) * 4 + c;
          mid[at] = (mid[at] ?? 0) + (w[k] ?? 0) * (pre[(y * img.width + sx) * 4 + c] ?? 0);
        }
      }
    }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const { start, w } = wy[y] ?? { start: 0, w: [] };
    for (let x = 0; x < width; x++) {
      const acc = new Float64Array(4);
      for (let k = 0; k < w.length; k++) {
        const sy = Math.min(img.height - 1, Math.max(0, start + k));
        for (let c = 0; c < 4; c++) acc[c] = (acc[c] ?? 0) + (w[k] ?? 0) * (mid[(sy * width + x) * 4 + c] ?? 0);
      }
      const a = Math.min(255, Math.max(0, acc[3] ?? 0));
      const o = (y * width + x) * 4;
      out[o + 3] = Math.round(a);
      if (a > 0)
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(255, Math.max(0, ((acc[c] ?? 0) / a) * 255)));
    }
  }
  return { width, height, data: out };
}

/**
 * Pure: a square icon of `size` px with the symbol centred, as large as fits in `size × fill`, over `background`
 * (null: transparent).
 */
export function squareIcon(
  symbol: Rgba,
  size: number,
  fill: number,
  background: [number, number, number] | null,
): Rgba {
  const scale = Math.min((size * fill) / symbol.width, (size * fill) / symbol.height);
  const w = Math.max(1, Math.round(symbol.width * scale));
  const h = Math.max(1, Math.round(symbol.height * scale));
  const scaled = resample(symbol, w, h);
  const data = new Uint8Array(size * size * 4);
  if (background) for (let i = 0; i < size * size; i++) data.set([...background, 255], i * 4);
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = ((y + oy) * size + x + ox) * 4;
      const a = (scaled.data[s + 3] ?? 0) / 255;
      const da = (data[d + 3] ?? 0) / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++)
        data[d + c] = oa > 0 ? Math.round(((scaled.data[s + c] ?? 0) * a + (data[d + c] ?? 0) * da * (1 - a)) / oa) : 0;
      data[d + 3] = Math.round(oa * 255);
    }
  return { width: size, height: size, data };
}

/** Pure: a Windows .ico with one PNG entry per image (Vista and later read PNG entries, 256 px included). */
export function encodeIco(images: Rgba[]): Buffer {
  const pngs = images.map((img) => encodePng(img));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(img.width >= 256 ? 0 : img.width, e);
    header.writeUInt8(img.height >= 256 ? 0 : img.height, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i]?.length ?? 0, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i]?.length ?? 0;
  });
  return Buffer.concat([header, ...pngs]);
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function main(): void {
  const web = join(dirname(fileURLToPath(import.meta.url)), '..');
  const symbol = extractSymbol(decodePng(readFileSync(join(web, 'public/brand/arenalive-positivo.png'))));
  const write = (path: string, img: Rgba): void => {
    writeFileSync(join(web, path), encodePng(img));
    console.log(`${path} ${img.width}×${img.height}`);
  };
  write('public/icons/favicon-32.png', squareIcon(symbol, 32, 1, null));
  write('public/icons/icon-192.png', squareIcon(symbol, 192, 0.84, null));
  write('public/icons/icon-512.png', squareIcon(symbol, 512, 0.84, null));
  write('public/icons/icon-maskable-512.png', squareIcon(symbol, 512, 0.6, ICON_BACKGROUND));
  write('public/icons/apple-touch-icon.png', squareIcon(symbol, 180, 0.72, ICON_BACKGROUND));
  const ico = '../agent-dotnet/src/ArenaLive.Agent.App/arenalive-agent.ico';
  writeFileSync(join(web, ico), encodeIco(ICO_SIZES.map((s) => squareIcon(symbol, s, s <= 24 ? 1 : 0.92, null))));
  console.log(`${ico} ${ICO_SIZES.join(', ')} px (symbol ${symbol.width}×${symbol.height} px)`);
  for (const name of ['arenalive-positivo.png', 'arenalive-negativo.png'])
    for (const dir of ['../agent-dotnet/src/ArenaLive.Agent.App/brand', '../agent/src/gui/brand'])
      copyFileSync(join(web, 'public/brand', name), join(web, dir, name));
  copyFileSync(join(web, ico), join(web, '../agent/src/gui/brand/arenalive-agent.ico'));
  console.log('copiati i loghi e l’icona negli agenti');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
