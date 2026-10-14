import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { IngestRequestSchema, MatchKeySchema } from '@sir/shared';
import { z } from 'zod';
import { errorCode, sleep } from './util.js';

const QueuedSchema = z.object({
  request: IngestRequestSchema,
  /** Global order of the queue (across matches). */
  order: z.int().min(0),
});
export type Queued = z.infer<typeof QueuedSchema>;

const ContentSchema = z.object({ header: z.string(), lines: z.array(z.string()) });

/** What is persisted for each match in `<dataDir>/matches/<matchKey>.json`. */
export const MatchRecordSchema = z.object({
  version: z.literal(1),
  matchKey: MatchKeySchema,
  /** Next `seq` to use: never decreases. */
  nextSeq: z.int().min(0),
  /** Content the server will have once the queue is delivered (base of the next diff). */
  base: ContentSchema.nullable(),
  /** Last answer of the server. */
  confirmed: z
    .object({
      seq: z.int().min(-1),
      lineCount: z.int().min(0),
      contentHash: z.string().optional(),
      at: z.string(),
    })
    .nullable(),
  /** The next change is sent as a snapshot (after a refused request). */
  forceSnapshot: z.boolean(),
  queue: z.array(QueuedSchema),
  sourceFile: z.string().optional(),
  /** Epoch ms of the next attempt of a snapshot refused by the server (with `forceSnapshot`). */
  retrySnapshotAt: z.number().optional(),
  /** ISO time of the last save (retention). */
  updatedAt: z.string().optional(),
});
export type MatchRecord = z.infer<typeof MatchRecordSchema>;

export const newRecord = (matchKey: string): MatchRecord => ({
  version: 1,
  matchKey,
  nextSeq: 0,
  base: null,
  confirmed: null,
  forceSnapshot: false,
  queue: [],
});

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Writes `data` to `file` atomically: temporary file flushed to disk, then renamed over the old one. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.datasync();
  } finally {
    await handle.close();
  }
  // On Windows an antivirus or indexer can hold the target for a moment.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 5 || !RETRY_CODES.has(errorCode(err) ?? '')) throw err;
      await sleep(50 * (attempt + 1));
    }
  }
}

export interface StoreWarning {
  file: string;
  reason: string;
}

/** Persistent state and queue of every match, one JSON file each. */
export class MatchStore {
  private readonly records = new Map<string, MatchRecord>();
  private order = 0;
  readonly dir: string;

  constructor(
    dataDir: string,
    private readonly retention: { days: number; now: () => number } = { days: 30, now: Date.now },
  ) {
    this.dir = join(dataDir, 'matches');
  }

  /** True for a record with an empty queue not updated for more than the retention days. */
  private expired(record: MatchRecord): boolean {
    if (record.queue.length > 0 || !record.updatedAt) return false;
    const updated = Date.parse(record.updatedAt);
    return Number.isFinite(updated) && this.retention.now() - updated > this.retention.days * 86_400_000;
  }

  /**
   * Loads the records; unreadable files are renamed `.corrupt` and reported, expired ones (see `expired`)
   * are deleted and not loaded.
   */
  async load(): Promise<StoreWarning[]> {
    await mkdir(this.dir, { recursive: true });
    const warnings: StoreWarning[] = [];
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.json')) continue;
      const file = join(this.dir, name);
      let record: MatchRecord | null = null;
      try {
        const parsed = MatchRecordSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (parsed.success && `${parsed.data.matchKey}.json` === name) record = parsed.data;
      } catch {
        record = null;
      }
      if (!record) {
        warnings.push({ file, reason: 'file di stato non valido: rinominato in .corrupt' });
        await rename(file, `${file}.corrupt`).catch(() => undefined);
        continue;
      }
      if (this.expired(record)) {
        warnings.push({ file, reason: 'partita non aggiornata da troppo tempo: stato cancellato' });
        await rm(file, { force: true });
        continue;
      }
      this.records.set(record.matchKey, record);
      for (const q of record.queue) this.order = Math.max(this.order, q.order + 1);
    }
    return warnings;
  }

  get(matchKey: string): MatchRecord | undefined {
    return this.records.get(matchKey);
  }

  all(): MatchRecord[] {
    return [...this.records.values()];
  }

  nextOrder(): number {
    return this.order++;
  }

  queueSize(): number {
    let n = 0;
    for (const r of this.records.values()) n += r.queue.length;
    return n;
  }

  /** Record whose first queued message is the oldest. */
  nextToSend(): MatchRecord | undefined {
    let best: MatchRecord | undefined;
    for (const r of this.records.values()) {
      const head = r.queue[0];
      if (!head) continue;
      const bestHead = best?.queue[0];
      if (!bestHead || head.order < bestHead.order) best = r;
    }
    return best;
  }

  async save(record: MatchRecord): Promise<void> {
    const stamped = { ...record, updatedAt: new Date(this.retention.now()).toISOString() };
    this.records.set(record.matchKey, stamped);
    await writeFileAtomic(join(this.dir, `${record.matchKey}.json`), JSON.stringify(stamped));
  }

  async remove(matchKey: string): Promise<void> {
    this.records.delete(matchKey);
    await rm(join(this.dir, `${matchKey}.json`), { force: true });
  }
}
