import type { VideoMime } from '@arenalive/shared';

/** Video recognized from its bytes. */
export interface VideoInfo {
  mime: VideoMime;
  width: number;
  height: number;
}

/** Why an upload is not an accepted video (the message is shown to the admin). */
export class VideoRejected extends Error {
  readonly code = 'VIDEO_REJECTED';
}

/** Largest side accepted, in pixels. */
export const VIDEO_MAX_SIDE = 4096;

/**
 * Brands of an MP4 or QuickTime (`ftyp`) that browsers play in <video>: ISO base media, MP4 and QuickTime (`qt  `, the
 * `.mov` of iPhones and Macs: same box structure, a `wide` box before `mdat` is just another top-level box). At least
 * one among the major and the compatible brands. QuickTime is stored and served as `video/mp4`: browsers play H.264
 * `.mov` as MP4 and the stored type only has to be one of VideoMime.
 */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'qt  ',
]);

const NOT_A_VIDEO = 'Formato non ammesso: usa un video MP4, MOV o WebM';

const size = (width: number, height: number): { width: number; height: number } => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new VideoRejected('Video senza una traccia video valida');
  if (width > VIDEO_MAX_SIDE || height > VIDEO_MAX_SIDE)
    throw new VideoRejected(`Video troppo grande (massimo ${VIDEO_MAX_SIDE} px per lato)`);
  return { width: Math.round(width), height: Math.round(height) };
};

interface Box {
  type: string;
  /** Start of the content (after the header) and end of the box. */
  start: number;
  end: number;
}

/** Pure: the boxes of an MP4 between `from` and `to`, one after the other with nothing left over (else rejected). */
function mp4Boxes(buf: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (to - at < 8) throw new VideoRejected('Video MP4 non valido: dati in più alla fine');
    let length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    let header = 8;
    if (length === 1) {
      if (to - at < 16) throw new VideoRejected('Video MP4 non valido');
      const large = buf.readBigUInt64BE(at + 8);
      if (large > BigInt(to - at)) throw new VideoRejected('Video MP4 non valido: file troncato');
      length = Number(large);
      header = 16;
    } else if (length === 0) length = to - at;
    if (length < header || at + length > to) throw new VideoRejected('Video MP4 non valido: file troncato');
    out.push({ type, start: at + header, end: at + length });
    at += length;
  }
  return out;
}

/** Pure: width and height (16.16 fixed point) of a `tkhd` box, version 0 or 1. */
function trackSize(buf: Buffer, box: Box): { width: number; height: number } {
  const version = buf[box.start];
  const offset = box.start + (version === 1 ? 88 : 76);
  if (offset + 8 > box.end) throw new VideoRejected('Video MP4 non valido');
  return { width: buf.readUInt32BE(offset) / 65536, height: buf.readUInt32BE(offset + 4) / 65536 };
}

/**
 * Pure: MP4 with valid structure: `ftyp` first with an accepted brand, top-level boxes one after the other to the end
 * of the file (nothing appended), a `moov` with at least one track with a picture (the largest gives the size).
 */
function readMp4(buf: Buffer): VideoInfo {
  const boxes = mp4Boxes(buf, 0, buf.length);
  const ftyp = boxes[0];
  if (ftyp?.type !== 'ftyp' || ftyp.end - ftyp.start < 8) throw new VideoRejected(NOT_A_VIDEO);
  const brands = [buf.toString('latin1', ftyp.start, ftyp.start + 4)];
  for (let at = ftyp.start + 8; at + 4 <= ftyp.end; at += 4) brands.push(buf.toString('latin1', at, at + 4));
  if (!brands.some((b) => MP4_BRANDS.has(b))) throw new VideoRejected(NOT_A_VIDEO);
  const moov = boxes.find((b) => b.type === 'moov');
  if (!moov) throw new VideoRejected('Video MP4 non valido: mancano le informazioni del video');
  let best = { width: 0, height: 0 };
  for (const trak of mp4Boxes(buf, moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const tkhd = mp4Boxes(buf, trak.start, trak.end).find((b) => b.type === 'tkhd');
    if (!tkhd) continue;
    const track = trackSize(buf, tkhd);
    if (track.width * track.height > best.width * best.height) best = track;
  }
  return { mime: 'video/mp4', ...size(best.width, best.height) };
}

const EBML_HEADER = 0x1a45dfa3;
const EBML_DOCTYPE = 0x4282;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const CLUSTER = 0x1f43b675;

interface Element {
  id: number;
  start: number;
  /** End of the content; null for an element of unknown size (it runs to the end of its parent). */
  end: number | null;
}

/** Pure: an EBML element at `at` (id with its marker, size without it), or a rejection when it does not fit. */
function ebmlElement(buf: Buffer, at: number, to: number): Element {
  const first = buf[at];
  if (first === undefined || first === 0) throw new VideoRejected('Video WebM non valido');
  const idLength = Math.clz32(first) - 23;
  if (idLength > 4 || at + idLength > to) throw new VideoRejected('Video WebM non valido');
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + (buf[at + i] ?? 0);
  const sizeAt = at + idLength;
  const sizeFirst = buf[sizeAt];
  if (sizeFirst === undefined || sizeFirst === 0) throw new VideoRejected('Video WebM non valido');
  const sizeLength = Math.clz32(sizeFirst) - 23;
  if (sizeAt + sizeLength > to) throw new VideoRejected('Video WebM non valido');
  let value = sizeFirst & (0xff >> sizeLength);
  let unknown = value === 0xff >> sizeLength;
  for (let i = 1; i < sizeLength; i++) {
    const byte = buf[sizeAt + i] ?? 0;
    unknown &&= byte === 0xff;
    value = value * 256 + byte;
  }
  const start = sizeAt + sizeLength;
  if (unknown) return { id, start, end: null };
  if (start + value > to) throw new VideoRejected('Video WebM non valido: file troncato');
  return { id, start, end: start + value };
}

/** Pure: the children of an element between `from` and `to`; stops at a child of unknown size (a cluster). */
function ebmlChildren(buf: Buffer, from: number, to: number): Element[] {
  const out: Element[] = [];
  let at = from;
  while (at < to) {
    const el = ebmlElement(buf, at, to);
    out.push(el);
    if (el.end === null) break;
    at = el.end;
  }
  return out;
}

const ebmlUint = (buf: Buffer, el: Element): number => {
  let value = 0;
  for (let i = el.start; i < (el.end ?? el.start); i++) value = value * 256 + (buf[i] ?? 0);
  return value;
};

/**
 * Pure: WebM: EBML header first with DocType `webm`, then a Segment whose Tracks (before the first cluster) have a
 * video track with its size (the largest one).
 */
function readWebm(buf: Buffer): VideoInfo {
  const header = ebmlElement(buf, 0, buf.length);
  if (header.id !== EBML_HEADER || header.end === null) throw new VideoRejected(NOT_A_VIDEO);
  const doctype = ebmlChildren(buf, header.start, header.end).find((e) => e.id === EBML_DOCTYPE);
  if (!doctype || buf.toString('latin1', doctype.start, doctype.end ?? doctype.start) !== 'webm')
    throw new VideoRejected(NOT_A_VIDEO);
  const segment = ebmlElement(buf, header.end, buf.length);
  if (segment.id !== SEGMENT) throw new VideoRejected('Video WebM non valido');
  let best = { width: 0, height: 0 };
  for (const child of ebmlChildren(buf, segment.start, segment.end ?? buf.length)) {
    if (child.id === CLUSTER) break;
    if (child.id !== TRACKS || child.end === null) continue;
    for (const entry of ebmlChildren(buf, child.start, child.end)) {
      if (entry.id !== TRACK_ENTRY || entry.end === null) continue;
      const video = ebmlChildren(buf, entry.start, entry.end).find((e) => e.id === VIDEO);
      if (!video || video.end === null) continue;
      const fields = ebmlChildren(buf, video.start, video.end);
      const width = fields.find((e) => e.id === PIXEL_WIDTH);
      const height = fields.find((e) => e.id === PIXEL_HEIGHT);
      const track = { width: width ? ebmlUint(buf, width) : 0, height: height ? ebmlUint(buf, height) : 0 };
      if (track.width * track.height > best.width * best.height) best = track;
    }
    break;
  }
  return { mime: 'video/webm', ...size(best.width, best.height) };
}

/**
 * Pure: type and size of a video recognized from its bytes alone: MP4 or QuickTime (ISO and `qt  ` brands) or WebM. Throws VideoRejected
 * for anything else (the declared name and type of the upload are never used).
 */
export function inspectVideo(buf: Buffer): VideoInfo {
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return readMp4(buf);
  if (buf.length >= 4 && buf.readUInt32BE(0) === EBML_HEADER) return readWebm(buf);
  throw new VideoRejected(NOT_A_VIDEO);
}
