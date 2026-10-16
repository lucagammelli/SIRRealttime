import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { hasNoControlChars } from '@sir/shared';

/**
 * Minimal zip writer, «store» method (no compression: the executable compresses little and the download starts at
 * once), without zip64 (every entry and the whole archive under 4 GB). The CRC of every entry is known before its
 * header, so no data descriptor is used and the total size is known in advance (Content-Length).
 */

/** Entry built in memory. */
export interface ZipDataEntry {
  name: string;
  data: Buffer;
}

/** Entry read from an open file: `size` and `crc32` already computed (see `fileCrc32`). */
export interface ZipFileEntry {
  name: string;
  file: FileHandle;
  size: number;
  crc32: number;
}

export type ZipEntry = ZipDataEntry | ZipFileEntry;

export class ZipError extends Error {
  readonly code = 'ZIP_INVALID';
}

const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
/** Version 2.0: needed for folders in the names and for the UTF-8 flag. */
const VERSION = 20;
/** Bit 11: names in UTF-8. */
const UTF8_FLAG = 0x0800;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;

/** Pure: MS-DOS time and date of `date` (UTC fields; years before 1980 become 1980, seconds rounded down to 2). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** Pure: a relative path with `/`, no empty, `.` or `..` part, no backslash or control character. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || Buffer.byteLength(name) > 0xffff || name.includes('\\') || !hasNoControlChars(name)) return false;
  const parts = name.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

const sizeOf = (entry: ZipEntry): number => ('data' in entry ? entry.data.length : entry.size);
const crcOf = (entry: ZipEntry): number => ('data' in entry ? crc32(entry.data) : entry.crc32);

function localHeader(name: Buffer, crc: number, size: number, when: { time: number; date: number }): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(when.time, 10);
  header.writeUInt16LE(when.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(
  name: Buffer,
  crc: number,
  size: number,
  offset: number,
  when: { time: number; date: number },
): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(VERSION, 4); // made by: MS-DOS, 2.0
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(when.time, 12);
  header.writeUInt16LE(when.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  // extra, comment, disk, internal and external attributes: 0.
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function endRecord(count: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(END_RECORD);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

/** Piece of the archive: bytes ready, or `size` bytes of an open file. */
type Part = Buffer | { file: FileHandle; size: number };

/**
 * Pure (no I/O): headers and order of the pieces of the archive, and its total size. Throws `ZipError` for an
 * unsafe or repeated name, too many entries or more than 4 GB.
 */
export function zipLayout(entries: readonly ZipEntry[], modified: Date): { size: number; parts: Part[] } {
  if (entries.length > MAX_ENTRIES) throw new ZipError('troppi file nello zip');
  const when = dosDateTime(modified);
  const parts: Part[] = [];
  const central: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name) || names.has(entry.name)) throw new ZipError(`nome non valido: ${entry.name}`);
    names.add(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const size = sizeOf(entry);
    const crc = crcOf(entry) >>> 0;
    if (size > MAX_32) throw new ZipError('file troppo grande per lo zip');
    const header = localHeader(name, crc, size, when);
    central.push(centralHeader(name, crc, size, offset, when));
    parts.push(header, 'data' in entry ? entry.data : { file: entry.file, size });
    offset += header.length + size;
    if (offset > MAX_32) throw new ZipError('zip troppo grande');
  }
  const directory = Buffer.concat(central);
  parts.push(directory, endRecord(entries.length, directory.length, offset));
  return { size: offset + directory.length + END_RECORD, parts };
}

/** Bytes read from a file at a time. */
const CHUNK = 256 * 1024;

async function* filePart(file: FileHandle, size: number): AsyncGenerator<Buffer> {
  let position = 0;
  while (position < size) {
    const buffer = Buffer.alloc(Math.min(CHUNK, size - position));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) throw new ZipError('file più corto del previsto');
    position += bytesRead;
    yield bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
  }
}

/**
 * The archive as a stream (files read in pieces from their handle, never all in memory) and its size. The handles
 * are not closed here: `done` of the caller runs once, when the stream ends, fails or is destroyed (even before the
 * first byte).
 */
export function zipStream(
  entries: readonly ZipEntry[],
  modified: Date,
  done: () => Promise<void> = () => Promise.resolve(),
): { size: number; stream: Readable } {
  const { size, parts } = zipLayout(entries, modified);
  let finished: Promise<void> | null = null;
  const finish = (): Promise<void> => (finished ??= done().catch(() => undefined));
  async function* generate(): AsyncGenerator<Buffer> {
    try {
      for (const part of parts) {
        if (Buffer.isBuffer(part)) yield part;
        else yield* filePart(part.file, part.size);
      }
    } finally {
      await finish();
    }
  }
  const stream = Readable.from(generate(), { objectMode: false });
  stream.once('close', () => void finish());
  return { size, stream };
}

/** CRC-32 of the first `size` bytes of an open file (read in pieces). */
export async function fileCrc32(file: FileHandle, size: number, onChunk?: (chunk: Buffer) => void): Promise<number> {
  let crc = 0;
  for await (const chunk of filePart(file, size)) {
    crc = crc32(chunk, crc);
    onChunk?.(chunk);
  }
  return crc >>> 0;
}
