import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { lstat, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRelease } from '@arenalive/shared';
import { AgentReleaseSchema } from '@arenalive/shared';
import type { FastifyBaseLogger } from 'fastify';
import { fileCrc32 } from './lib/zip.js';

/** Files written by `scripts/costruisci-agente.sh` in AGENT_DOWNLOAD_DIR. */
export const AGENT_EXE_FILE = 'arenalive-agent.exe';
export const AGENT_RELEASE_FILE = 'arenalive-agent.json';
/** Files written by the build of the player (`ArenaLive-Player`) in PLAYER_DOWNLOAD_DIR. */
export const PLAYER_DEB_FILE = 'arenalive-player.deb';
export const PLAYER_RELEASE_FILE = 'arenalive-player.json';

/**
 * Image of the SD card of the players: its manifest `arenalive-player-image.json` and, before the three parts of
 * format 2 (`PLAYER_IMAGE_PART_FILES` of the shared package, read by `playerImage.ts`), this one `.img.xz`.
 */
export const PLAYER_IMAGE_FILE = 'arenalive-player.img.xz';
export const PLAYER_IMAGE_RELEASE_FILE = 'arenalive-player-image.json';

/** The file on offer and the manifest that describes it, in the folder of the store. */
export interface ReleaseFiles {
  binary: string;
  release: string;
}
const AGENT_FILES: ReleaseFiles = { binary: AGENT_EXE_FILE, release: AGENT_RELEASE_FILE };
/** Software of the players: the `.deb` and its manifest (same fields of `arenalive-agent.json`). */
export const PLAYER_FILES: ReleaseFiles = { binary: PLAYER_DEB_FILE, release: PLAYER_RELEASE_FILE };

/** Largest manifest (`arenalive-agent.json`) read. */
const MAX_RELEASE_BYTES = 4096;

/** The executable on offer, open (the zip reads exactly this file, even if it is replaced meanwhile). */
export interface OpenRelease {
  release: AgentRelease;
  file: FileHandle;
  bytes: number;
  crc32: number;
}

interface Digest {
  sha256: string;
  crc32: number;
}

const errorCode = (err: unknown): unknown => (err instanceof Error && 'code' in err ? err.code : undefined);

/** An open file whose sha256 matches its manifest. */
export interface VerifiedFile {
  file: FileHandle;
  bytes: number;
  crc32: number;
}

/**
 * sha256 and CRC-32 of the files on offer, computed once for every version of a file (identified by inode, size and
 * modification time) and in the background (never blocking the server); at most `entries` versions are kept.
 */
export class DigestCache {
  private readonly digests = new Map<string, Promise<Digest>>();

  constructor(private readonly entries = 1) {}

  of(file: FileHandle, stats: { ino: number; size: number; mtimeMs: number }): Promise<Digest> {
    const key = `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
    let digest = this.digests.get(key);
    if (!digest) {
      digest = digestOf(file, stats.size);
      while (this.digests.size >= this.entries) {
        const oldest = this.digests.keys().next();
        if (oldest.done) break;
        this.digests.delete(oldest.value);
      }
      this.digests.set(key, digest);
      digest.catch(() => this.digests.delete(key));
    }
    return digest;
  }
}

/**
 * `name` in `dir` open, if it is a non-empty file whose sha256 is `sha256` (and of `size` bytes, when given); null
 * otherwise (with a log, none for a missing file).
 */
export async function openVerified(
  dir: string,
  name: string,
  expected: { sha256: string; size?: number; manifest: string },
  digests: DigestCache,
  log: FastifyBaseLogger,
): Promise<VerifiedFile | null> {
  let file: FileHandle;
  try {
    file = await open(join(dir, name), 'r');
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') log.warn({ code: errorCode(err), file: name }, 'file illeggibile');
    return null;
  }
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size === 0) throw new Error('not a file');
    if (expected.size !== undefined && stats.size !== expected.size) {
      log.error(`${name} non ha la dimensione scritta in ${expected.manifest}: download non disponibile`);
      await file.close();
      return null;
    }
    const { sha256, crc32 } = await digests.of(file, stats);
    if (sha256 !== expected.sha256) {
      log.error(`${name} non corrisponde allo sha256 di ${expected.manifest}: download non disponibile`);
      await file.close();
      return null;
    }
    return { file, bytes: stats.size, crc32 };
  } catch (err) {
    await file.close();
    log.warn({ code: errorCode(err), file: name }, 'file non valido');
    return null;
  }
}

/**
 * The manifest `name` in `dir`, parsed as JSON (null when missing, too big or not JSON: with a log, none for a missing
 * file). Its shape is checked by the caller.
 */
export async function readManifest(dir: string, name: string, log: FastifyBaseLogger): Promise<unknown> {
  const path = join(dir, name);
  let text: string;
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAX_RELEASE_BYTES) {
      log.warn(`${name} non valido: download non disponibile`);
      return null;
    }
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') log.warn({ code: errorCode(err) }, `${name} illeggibile`);
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    log.warn(`${name} non valido: download non disponibile`);
    return null;
  }
}

/** `raw` as an AgentRelease, or null with a log (nothing to log for a missing manifest). */
export function releaseOf(raw: unknown, manifest: string, log: FastifyBaseLogger): AgentRelease | null {
  if (raw === null) return null;
  const parsed = AgentReleaseSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn(`${manifest} non valido: download non disponibile`);
    return null;
  }
  return parsed.data;
}

/**
 * Executable of the agent offered for download, the same for every client. `arenalive-agent.json` must describe the
 * `arenalive-agent.exe` next to it (same sha256): otherwise nothing is offered. sha256 and CRC-32 of the executable are
 * computed once for every version of the file (DigestCache). With PLAYER_FILES the same for the `.deb` of the players.
 */
export class AgentReleaseStore {
  private readonly digests = new DigestCache();

  constructor(
    private readonly dir: string,
    private readonly files: ReleaseFiles = AGENT_FILES,
  ) {}

  /** The executable open, or null when it is missing or does not match `arenalive-agent.json` (with a log). */
  async open(log: FastifyBaseLogger): Promise<OpenRelease | null> {
    const raw = await readManifest(this.dir, this.files.release, log);
    const release = releaseOf(raw, this.files.release, log);
    if (!release) return null;
    const verified = await openVerified(
      this.dir,
      this.files.binary,
      { sha256: release.sha256, manifest: this.files.release },
      this.digests,
      log,
    );
    return verified ? { release, ...verified } : null;
  }
}

async function digestOf(file: FileHandle, size: number): Promise<Digest> {
  const hash = createHash('sha256');
  const crc32 = await fileCrc32(file, size, (chunk) => hash.update(chunk));
  return { sha256: hash.digest('hex'), crc32 };
}
