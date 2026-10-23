/** Small MP4 and WebM files with the structure the server checks (not meant to be played). */

const box = (type: string, ...parts: Buffer[]): Buffer => {
  const payload = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
};

/** MP4: `ftyp` with `brands`, a `moov` with one video track of width×height, `mdat` of `pad` bytes. */
export function mp4(width: number, height: number, pad = 64, brands = ['isom', 'iso2', 'avc1', 'mp41']): Buffer {
  const ftyp = Buffer.alloc(8 + 4 * brands.length);
  ftyp.write(brands[0] ?? 'isom', 0, 'latin1');
  ftyp.writeUInt32BE(0x200, 4);
  brands.forEach((b, i) => ftyp.write(b, 8 + 4 * i, 'latin1'));
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([
    box('ftyp', ftyp),
    box('moov', box('trak', box('tkhd', tkhd))),
    box('mdat', Buffer.alloc(pad, 7)),
  ]);
}

const vint8 = (n: number): Buffer => {
  const out = Buffer.alloc(8);
  out[0] = 0x01;
  out.writeUIntBE(n, 2, 6);
  return out;
};
const el = (id: number[], ...parts: Buffer[]): Buffer => {
  const payload = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(id), vint8(payload.length), payload]);
};
const uint2 = (n: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(n, 0);
  return out;
};

/** WebM: EBML header with `doctype`, a Segment with one video track of width×height and a cluster of `pad` bytes. */
export function webm(width: number, height: number, pad = 64, doctype = 'webm'): Buffer {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from(doctype, 'latin1')));
  const tracks = el(
    [0x16, 0x54, 0xae, 0x6b],
    el([0xae], el([0xe0], el([0xb0], uint2(width)), el([0xba], uint2(height)))),
  );
  // Cluster of unknown size, as a live recorder writes it.
  const cluster = Buffer.concat([
    Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.alloc(pad, 9),
  ]);
  const segmentBody = Buffer.concat([tracks, cluster]);
  return Buffer.concat([header, Buffer.from([0x18, 0x53, 0x80, 0x67]), vint8(segmentBody.length), segmentBody]);
}
