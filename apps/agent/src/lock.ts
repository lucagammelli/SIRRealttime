import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { uptime } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { errorCode, sleep } from './util.js';

/** Another agent (service, console or window) is reading with the same `dataDir`. */
export class LockError extends Error {
  readonly code = 'LOCK_HELD';
  constructor(
    readonly pid: number,
    message: string,
  ) {
    super(message);
    this.name = 'LockError';
  }
}

const LockFileSchema = z.object({ pid: z.int().min(1), startedAt: z.string() });
export type LockInfo = z.infer<typeof LockFileSchema>;

export interface Lock {
  readonly file: string;
  /** Removes the lock file, only if it is still ours. */
  release: () => Promise<void>;
}

export interface LockOptions {
  pid?: number;
  now?: () => Date;
  /** True when a process with this pid exists. Default: `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Epoch ms of the start of the operating system. Default: `Date.now() - os.uptime() * 1000`. */
  bootTime?: () => number;
}

/** A lock written up to this long before the computed boot time still counts (clock adjustments). */
const BOOT_SLACK_MS = 60_000;

export const lockFile = (dataDir: string): string => join(dataDir, 'agent.lock');

/** Default liveness check. A pid reused by another program in the same boot looks alive: known limit. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === 'EPERM';
  }
}

async function readLock(file: string): Promise<LockInfo | null> {
  try {
    const parsed = LockFileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Takes `dataDir/agent.lock` (created with the exclusive flag, it holds pid and start time). A lock whose process
 * is no longer alive, or an unreadable one, is stale and replaced. Throws `LockError` when another agent holds it.
 */
export async function acquireLock(dataDir: string, options: LockOptions = {}): Promise<Lock> {
  const pid = options.pid ?? process.pid;
  const now = options.now ?? (() => new Date());
  const isAlive = options.isAlive ?? isProcessAlive;
  const bootTime = options.bootTime ?? (() => Date.now() - uptime() * 1000);
  /**
   * Stale: our own pid (no second legitimate holder in the same process; also a pid reused after a reboot), a
   * lock written before the system started (blackout, forced shutdown) or a process that no longer exists.
   */
  const isHeld = (holder: LockInfo): boolean => {
    if (holder.pid === pid) return false;
    const started = Date.parse(holder.startedAt);
    if (Number.isNaN(started) || started < bootTime() - BOOT_SLACK_MS) return false;
    return isAlive(holder.pid);
  };
  const file = lockFile(dataDir);
  await mkdir(dataDir, { recursive: true });
  const content = JSON.stringify({ pid, startedAt: now().toISOString() } satisfies LockInfo);
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(file, 'wx');
      try {
        await handle.writeFile(content, 'utf8');
      } finally {
        await handle.close();
      }
      return { file, release: () => releaseLock(file, pid) };
    } catch (err) {
      if (errorCode(err) !== 'EEXIST') throw err;
    }
    const holder = await readLock(file);
    if (holder && isHeld(holder)) {
      throw new LockError(
        holder.pid,
        `Un'altra istanza dell'agente è già in lettura (pid ${holder.pid}, per esempio il servizio SIRAgent): fermala prima di avviare questa`,
      );
    }
    if (attempt >= 2) {
      throw new LockError(holder?.pid ?? 0, `Impossibile prendere il lucchetto ${file}: riprova`);
    }
    // Stale (or unreadable). Known limit: two processes replacing the same stale lock at the same moment can
    // race between `rm` and `wx`; with one service and one window per PC it is not a real case.
    await rm(file, { force: true });
  }
}

async function releaseLock(file: string, pid: number): Promise<void> {
  const holder = await readLock(file);
  if (holder?.pid === pid) await rm(file, { force: true });
}

/**
 * Console and service: waits for the lock instead of exiting (NSSM would restart the process in a loop).
 * Tries again every `retryMs`; `onWait` is called at the first refusal. Resolves `null` if `signal` is aborted.
 */
export async function waitForLock(
  dataDir: string,
  options: LockOptions & { signal: AbortSignal; retryMs?: number; onWait?: (pid: number) => void },
): Promise<Lock | null> {
  const retryMs = options.retryMs ?? 30_000;
  let warned = false;
  while (!options.signal.aborted) {
    try {
      return await acquireLock(dataDir, options);
    } catch (err) {
      if (!(err instanceof LockError)) throw err;
      if (!warned) options.onWait?.(err.pid);
      warned = true;
    }
    await sleep(retryMs, options.signal);
  }
  return null;
}
