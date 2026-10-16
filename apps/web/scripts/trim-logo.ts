/**
 * Prepares a logo of a template from the original PNG of the client (docs/grafica): crops the transparent margins,
 * scales it down to a width (area average with premultiplied alpha, transparency kept) and writes a new PNG.
 * Only PNG RGBA 8 bit without interlace (the originals); no dependency besides node:zlib.
 *
 *   pnpm --filter @sir/web exec tsx scripts/trim-logo.ts <input.png> <output.png> [width=1200] [margin=0] [part=all]
 *
 * `margin`: transparent border kept around the drawing, as a share of the final width. `part`: `all` the whole
 * drawing; `top` only what is above the last fully transparent band of rows (the logo without the line of text under
 * it); `bottom` only what is under it (the line of text).
 *
 * Template «SIR VOLLEY» (originals in docs/grafica):
 *   tsx scripts/trim-logo.ts "../../docs/grafica/sir real time logo-02.png" public/templates/sir-volley/logo-sir-realtime.png 1200 0 top
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  /** width × height × 4 bytes, RGBA, straight alpha. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Pure: pixels of a PNG RGBA 8 bit (colour type 6), not interlaced; throws on any other format. */
export function decodePng(file: Uint8Array): Rgba {
  const buf = Buffer.from(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('non è un PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colour !== 6 || interlace !== 0) throw new Error('solo PNG RGBA 8 bit non interlacciati');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x] ?? 0;
      const left = x >= 4 ? (data[dst + x - 4] ?? 0) : 0;
      const up = y > 0 ? (data[dst - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= 4 ? (data[dst - stride + x - 4] ?? 0) : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth(left, up, upLeft);
      data[dst + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Pure: PNG RGBA 8 bit of the pixels (filter «sub» on every row, best zlib compression, no metadata). */
export function encodePng({ width, height, data }: Rgba): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) {
      const value = data[y * stride + x] ?? 0;
      const left = x >= 4 ? (data[y * stride + x - 4] ?? 0) : 0;
      raw[y * (stride + 1) + 1 + x] = (value - left) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Pure: smallest box holding every pixel with alpha above `threshold`, null for an image fully transparent. */
export function opaqueBox(img: Rgba, threshold = 0): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export type Part = 'all' | 'top' | 'bottom';

/**
 * Pure: rows of the box to keep for `part`: all of them, the ones above the last band of fully transparent rows inside
 * the box, or the ones under it (the box itself when there is no such band).
 */
export function partRows(img: Rgba, box: { x: number; y: number; w: number; h: number }, part: Part): [number, number] {
  if (part === 'all') return [box.y, box.y + box.h];
  const opaque = (y: number): boolean => {
    for (let x = box.x; x < box.x + box.w; x++) if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) > 0) return true;
    return false;
  };
  let gapStart = -1;
  let gapEnd = -1;
  for (let y = box.y + box.h - 1; y >= box.y; y--) {
    if (!opaque(y)) {
      if (gapEnd < 0) gapEnd = y + 1;
      gapStart = y;
    } else if (gapEnd >= 0) break;
  }
  if (gapEnd < 0) return [box.y, box.y + box.h];
  return part === 'top' ? [box.y, gapStart] : [gapEnd, box.y + box.h];
}

/** Pure: the part of `img` in the box, with `pad` transparent pixels around it. */
export function crop(img: Rgba, box: { x: number; y: number; w: number; h: number }, pad = 0): Rgba {
  const width = box.w + 2 * pad;
  const height = box.h + 2 * pad;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < box.h; y++) {
    const from = ((box.y + y) * img.width + box.x) * 4;
    data.set(img.data.subarray(from, from + box.w * 4), ((y + pad) * width + pad) * 4);
  }
  return { width, height, data };
}

/** Pure: `img` scaled down to `width` (height in proportion) by area average, colours weighted by their alpha. */
export function resize(img: Rgba, width: number): Rgba {
  if (width >= img.width) return img;
  const scale = img.width / width;
  const height = Math.max(1, Math.round(img.height / scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = y * scale;
    const sy1 = Math.min(img.height, (y + 1) * scale);
    for (let x = 0; x < width; x++) {
      const sx0 = x * scale;
      const sx1 = Math.min(img.width, (x + 1) * scale);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const w = (Math.min(sx + 1, sx1) - Math.max(sx, sx0)) * wy;
          const i = (sy * img.width + sx) * 4;
          const alpha = (img.data[i + 3] ?? 0) * w;
          r += (img.data[i] ?? 0) * alpha;
          g += (img.data[i + 1] ?? 0) * alpha;
          b += (img.data[i + 2] ?? 0) * alpha;
          a += alpha;
          area += w;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        data[o] = Math.round(r / a);
        data[o + 1] = Math.round(g / a);
        data[o + 2] = Math.round(b / a);
      }
      data[o + 3] = Math.round(a / area);
    }
  }
  return { width, height, data };
}

function main(): void {
  const [input, output, widthArg = '1200', marginArg = '0', partArg = 'all'] = process.argv.slice(2);
  if (!input || !output || !['all', 'top', 'bottom'].includes(partArg)) {
    console.error(
      'Uso: tsx scripts/trim-logo.ts <input.png> <output.png> [larghezza=1200] [margine=0] [all|top|bottom]',
    );
    process.exit(2);
  }
  const img = decodePng(readFileSync(input));
  const whole = opaqueBox(img);
  if (!whole) throw new Error('immagine completamente trasparente');
  const [from, to] = partRows(img, whole, partArg as Part);
  const band = crop(img, { x: 0, y: from, w: img.width, h: to - from });
  const box = opaqueBox(band);
  if (!box) throw new Error('parte vuota');
  const width = Number(widthArg);
  // The margin is chosen on the final size, then brought back to the original pixels.
  const padFinal = Math.round(width * Number(marginArg));
  const pad = Math.round((padFinal * box.w) / Math.max(1, width - 2 * padFinal));
  const out = resize(crop(band, box, pad), width);
  const png = encodePng(out);
  writeFileSync(output, png);
  console.log(
    `${output}: ${out.width}×${out.height} px, ${png.length} byte (ritaglio ${box.w}×${box.h} da ${img.width}×${img.height})`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
