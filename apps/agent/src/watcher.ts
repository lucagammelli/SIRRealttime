import type { Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { errorCode } from './util.js';

export type WatchEvent =
  /** Nothing to do (no change, or a change not yet stable). */
  | { type: 'idle' }
  /** Path (or every `.dvw` in the folder) not found: USB stick removed? */
  | { type: 'missing'; reason: string }
  /** File locked by DataVolley (EBUSY/EPERM/EACCES): retried at the next poll. */
  | { type: 'busy'; path: string; code: string }
  /** Stable content read. */
  | { type: 'read'; path: string; bytes: Uint8Array };

export interface WatcherOptions {
  /** Size and mtime must stay the same for this long before the file is read. */
  stableMs: number;
  /** The file is read again after this long even if size and mtime did not change (FAT has a 2 s mtime). */
  rereadMs: number;
}

const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

interface Observed {
  path: string;
  size: number;
  mtimeMs: number;
}

const sameFile = (a: Observed | null, b: Observed): boolean =>
  a !== null && a.path === b.path && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Hidden files, Office-style lock files, temporary copies. */
const ignoredName = (name: string): boolean => name.startsWith('.') || name.startsWith('~') || !/\.dvw$/i.test(name);

/**
 * Polling watcher (plain `fs.stat`, reliable on USB/FAT where file system events are not): finds the `.dvw`
 * (the given file, or the most recently modified one in the folder) and returns its bytes once size and mtime
 * stayed the same for `stableMs`. Never throws for file system errors.
 */
export class FileWatcher {
  private observed: Observed | null = null;
  private observedSince = 0;
  private lastRead: (Observed & { at: number }) | null = null;
  private rereadRequested = false;

  constructor(
    readonly watchPath: string,
    private readonly options: WatcherOptions,
  ) {}

  /** Asks for a new read at the next stable poll, even if the file did not change (unconfirmed content). */
  requestReread(): void {
    this.rereadRequested = true;
  }

  /** Forgets the last read: the next stable poll reads the file again. */
  reset(): void {
    this.lastRead = null;
  }

  async poll(now: number): Promise<WatchEvent> {
    const located = await this.locate();
    if ('reason' in located) {
      this.observed = null;
      return { type: 'missing', reason: located.reason };
    }
    const current = located;
    if (!sameFile(this.observed, current)) {
      this.observed = current;
      this.observedSince = now;
      if (this.options.stableMs > 0) return { type: 'idle' };
    }
    if (now - this.observedSince < this.options.stableMs) return { type: 'idle' };

    const last = this.lastRead;
    const due =
      last === null ||
      !sameFile(last, current) ||
      (this.rereadRequested && now - last.at >= this.options.stableMs) ||
      now - last.at >= this.options.rereadMs;
    if (!due) return { type: 'idle' };

    let bytes: Uint8Array;
    try {
      bytes = await readFile(current.path);
    } catch (err) {
      const code = errorCode(err) ?? 'UNKNOWN';
      if (BUSY_CODES.has(code)) return { type: 'busy', path: current.path, code };
      this.observed = null;
      return { type: 'missing', reason: `${current.path}: ${code}` };
    }
    // The file changed while it was being read: wait for the next stable state.
    const after = await this.statOf(current.path);
    if (!after || !sameFile(current, after) || bytes.length !== current.size) {
      this.observed = after;
      this.observedSince = now;
      return { type: 'idle' };
    }
    this.lastRead = { ...current, at: now };
    this.rereadRequested = false;
    return { type: 'read', path: current.path, bytes };
  }

  private async statOf(path: string): Promise<Observed | null> {
    try {
      const s = await stat(path);
      return s.isFile() ? { path, size: s.size, mtimeMs: s.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private async locate(): Promise<Observed | { reason: string }> {
    let root: Stats;
    try {
      root = await stat(this.watchPath);
    } catch (err) {
      return { reason: `${this.watchPath} non raggiungibile (${errorCode(err) ?? 'errore'})` };
    }
    if (!root.isDirectory()) {
      return root.isFile()
        ? { path: this.watchPath, size: root.size, mtimeMs: root.mtimeMs }
        : { reason: `${this.watchPath} non è un file né una cartella` };
    }
    let names: string[];
    try {
      names = await readdir(this.watchPath);
    } catch (err) {
      return { reason: `${this.watchPath} non leggibile (${errorCode(err) ?? 'errore'})` };
    }
    let best: Observed | null = null;
    for (const name of names) {
      if (ignoredName(name)) continue;
      const s = await this.statOf(join(this.watchPath, name));
      if (s && (!best || s.mtimeMs > best.mtimeMs)) best = s;
    }
    return best ?? { reason: `nessun file .dvw in ${this.watchPath}` };
  }
}
