import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Valid PNG of `width`×`height` (grey); `padding` bytes of an extra ancillary chunk make it as big as needed. */
export function png(width: number, height: number, padding = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  const extra = padding > 0 ? [chunk('tEXt', Buffer.alloc(padding, 0x61))] : [];
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Minimal JPEG structure (SOI, APP0, SOF0 with the size, SOS, data, EOI). */
export function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof,
    sos,
    Buffer.from([0x12, 0x34]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Lossless WebP header (VP8L) of the given size. */
export function webp(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data[0] = 0x2f;
  data.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  const chunkHeader = Buffer.concat([Buffer.from('VP8L', 'latin1'), Buffer.alloc(4)]);
  chunkHeader.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), chunkHeader, data]);
  const riff = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4)]);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** Extended WebP header (VP8X) of the given size. */
export function webpExtended(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  const chunkHeader = Buffer.concat([Buffer.from('VP8X', 'latin1'), Buffer.alloc(4)]);
  chunkHeader.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), chunkHeader, data]);
  const riff = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4)]);
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

export const svg = (inner: string, attrs = 'viewBox="0 0 120 40"'): Buffer =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>\n`,
  );
