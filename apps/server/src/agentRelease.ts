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
/** Largest `arenalive-agent.json` read. */
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

/**
 * Executable of the agent offered for download, the same for every client. `arenalive-agent.json` must describe the
 * `arenalive-agent.exe` next to it (same sha256): otherwise nothing is offered. sha256 and CRC-32 of the executable are
 * computed once for every version of the file (identified by inode, size and modification time).
 */
export class AgentReleaseStore {
  private readonly digests = new Map<string, Promise<Digest>>();

  constructor(private readonly dir: string) {}

  /** The executable open, or null when it is missing or does not match `arenalive-agent.json` (with a log). */
  async open(log: FastifyBaseLogger): Promise<OpenRelease | null> {
    const release = await this.readRelease(log);
    if (!release) return null;
    let file: FileHandle;
    try {
      file = await open(join(this.dir, AGENT_EXE_FILE), 'r');
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') log.warn({ code: errorCode(err) }, 'eseguibile dell’agente illeggibile');
      return null;
    }
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size === 0) throw new Error('not a file');
      const key = `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
      let digest = this.digests.get(key);
      if (!digest) {
        digest = digestOf(file, stats.size);
        this.digests.clear();
        this.digests.set(key, digest);
        digest.catch(() => this.digests.delete(key));
      }
      const { sha256, crc32 } = await digest;
      if (sha256 !== release.sha256) {
        log.error('arenalive-agent.exe non corrisponde allo sha256 di arenalive-agent.json: download non disponibile');
        await file.close();
        return null;
      }
      return { release, file, bytes: stats.size, crc32 };
    } catch (err) {
      await file.close();
      log.warn({ code: errorCode(err) }, 'eseguibile dell’agente non valido');
      return null;
    }
  }

  private async readRelease(log: FastifyBaseLogger): Promise<AgentRelease | null> {
    const path = join(this.dir, AGENT_RELEASE_FILE);
    let text: string;
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.size > MAX_RELEASE_BYTES) {
        log.warn('arenalive-agent.json non valido: download dell’agente non disponibile');
        return null;
      }
      text = await readFile(path, 'utf8');
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') log.warn({ code: errorCode(err) }, 'arenalive-agent.json illeggibile');
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    const parsed = AgentReleaseSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('arenalive-agent.json non valido: download dell’agente non disponibile');
      return null;
    }
    return parsed.data;
  }
}

async function digestOf(file: FileHandle, size: number): Promise<Digest> {
  const hash = createHash('sha256');
  const crc32 = await fileCrc32(file, size, (chunk) => hash.update(chunk));
  return { sha256: hash.digest('hex'), crc32 };
}
