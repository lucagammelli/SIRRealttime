import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { DisplayConfigFile, PlayerImageManifest } from '@arenalive/shared';
import { PLAYER_IMAGE_PART_FILES, PLAYER_IMAGE_SLOT_SIZE, PlayerImageManifestSchema } from '@arenalive/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { VerifiedFile } from './agentRelease.js';
import {
  DigestCache,
  openVerified,
  PLAYER_IMAGE_FILE,
  PLAYER_IMAGE_RELEASE_FILE,
  readManifest,
  releaseOf,
} from './agentRelease.js';

/** Largest second part (the slot of 8 KiB compressed is far smaller): it is read in memory. */
const MAX_SLOT_PART_BYTES = 64 * 1024;

/** The `.img.xz` of before (manifest without `format`): only the generic image. */
export interface LegacyPlayerImage {
  format: 1;
  version: string;
  builtAt: string;
  sha256: string;
  file: FileHandle;
  bytes: number;
}

/**
 * The image in three parts (format 2), open: the first and the third part as files (read exactly these, even if a
 * new image is published meanwhile), the second one (the slot with the placeholder, compressed) in memory.
 */
export interface PartedPlayerImage {
  format: 2;
  manifest: PlayerImageManifest;
  head: VerifiedFile;
  slotPart: Buffer;
  tail: VerifiedFile;
}

export type OpenPlayerImage = LegacyPlayerImage | PartedPlayerImage;

/** Closes the files of an open image (never fails). */
export async function closeImage(image: OpenPlayerImage): Promise<void> {
  const files = image.format === 1 ? [image.file] : [image.head.file, image.tail.file];
  await Promise.all(files.map((f) => f.close().catch(() => undefined)));
}

/**
 * Pure: the slot of an image with `file` (`arenalive-player.json`, as the download of `…/config`, then spaces up to
 * exactly PLAYER_IMAGE_SLOT_SIZE bytes); null when the JSON does not fit.
 */
export function configSlot(file: DisplayConfigFile): Buffer | null {
  const json = Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8');
  if (json.length > PLAYER_IMAGE_SLOT_SIZE) return null;
  const slot = Buffer.alloc(PLAYER_IMAGE_SLOT_SIZE, 0x20);
  json.copy(slot);
  json.fill(0);
  return slot;
}

/** The slot compressed as the middle member of the `.img.gz`. */
export const compressSlot = (slot: Buffer): Buffer => gzipSync(slot);

/** Bytes of the `.img.gz` of `image` with `middle` (a compressed slot) between the first and the third part. */
export const imageBytes = (image: PartedPlayerImage, middle: Buffer): number =>
  image.head.bytes + middle.length + image.tail.bytes;

/**
 * The `.img.gz` of `image` with `middle` as the second member, streamed (the parts never in memory); the files of the
 * image are closed at the end, on an error and when the client goes away.
 */
export function imageStream(image: PartedPlayerImage, middle: Buffer): Readable {
  let closed: Promise<void> | null = null;
  const close = (): Promise<void> => (closed ??= closeImage(image));
  async function* members(): AsyncGenerator<Buffer> {
    try {
      yield* image.head.file.createReadStream({ start: 0, autoClose: false });
      yield middle;
      yield* image.tail.file.createReadStream({ start: 0, autoClose: false });
    } finally {
      await close();
    }
  }
  const stream = Readable.from(members(), { objectMode: false });
  // A stream destroyed before its first read never enters the generator: the files are closed here.
  stream.once('close', () => void close());
  return stream;
}

/**
 * Image of the SD card of the players in PLAYER_DOWNLOAD_DIR, described by `arenalive-player-image.json`. With
 * `format: 2` the three parts of PLAYER_IMAGE_PART_FILES (only these names: none comes from the manifest), each one
 * of the size and sha256 of the manifest, the second one a gzip of exactly the slot; otherwise the `.img.xz` of before
 * (`version`, `builtAt`, `sha256`). The sha256 of every file is computed once per version of it (DigestCache).
 */
export class PlayerImageStore {
  private readonly digests = new DigestCache(4);

  constructor(private readonly dir: string) {}

  /** The image open, or null when it is missing or does not match its manifest (with a log). */
  async open(log: FastifyBaseLogger): Promise<OpenPlayerImage | null> {
    const raw = await readManifest(this.dir, PLAYER_IMAGE_RELEASE_FILE, log);
    if (raw === null) return null;
    if (typeof raw === 'object' && 'format' in raw && raw.format === 2) return this.openParts(raw, log);
    const release = releaseOf(raw, PLAYER_IMAGE_RELEASE_FILE, log);
    if (!release) return null;
    const verified = await openVerified(
      this.dir,
      PLAYER_IMAGE_FILE,
      { sha256: release.sha256, manifest: PLAYER_IMAGE_RELEASE_FILE },
      this.digests,
      log,
    );
    if (!verified) return null;
    return {
      format: 1,
      version: release.version,
      builtAt: release.builtAt,
      sha256: release.sha256,
      file: verified.file,
      bytes: verified.bytes,
    };
  }

  private async openParts(raw: unknown, log: FastifyBaseLogger): Promise<PartedPlayerImage | null> {
    const parsed = PlayerImageManifestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.parts[1].size > MAX_SLOT_PART_BYTES) {
      log.warn(`${PLAYER_IMAGE_RELEASE_FILE} non valido: download non disponibile`);
      return null;
    }
    const manifest = parsed.data;
    const opened: VerifiedFile[] = [];
    try {
      for (const [i, name] of PLAYER_IMAGE_PART_FILES.entries()) {
        const part = manifest.parts[i];
        if (!part) return null;
        const verified = await openVerified(
          this.dir,
          name,
          { sha256: part.sha256, size: part.size, manifest: PLAYER_IMAGE_RELEASE_FILE },
          this.digests,
          log,
        );
        if (!verified) return null;
        opened.push(verified);
      }
      const [head, slot, tail] = opened;
      if (!head || !slot || !tail) return null;
      const slotPart = Buffer.alloc(slot.bytes);
      await slot.file.read(slotPart, 0, slot.bytes, 0);
      if (!isSlotPart(slotPart)) {
        log.error(`${PLAYER_IMAGE_PART_FILES[1]} non contiene uno slot di ${PLAYER_IMAGE_SLOT_SIZE} byte`);
        return null;
      }
      await slot.file.close();
      opened.splice(0);
      return { format: 2, manifest, head, slotPart, tail };
    } catch (err) {
      log.warn({ err }, 'immagine del player illeggibile');
      return null;
    } finally {
      await Promise.all(opened.map((f) => f.file.close().catch(() => undefined)));
    }
  }
}

/** Pure: `data` is one gzip member of exactly PLAYER_IMAGE_SLOT_SIZE bytes. */
function isSlotPart(data: Buffer): boolean {
  try {
    return gunzipSync(data, { maxOutputLength: PLAYER_IMAGE_SLOT_SIZE + 1 }).length === PLAYER_IMAGE_SLOT_SIZE;
  } catch {
    return false;
  }
}
