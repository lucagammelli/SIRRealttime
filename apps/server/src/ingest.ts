import { parseDvw } from '@sir/dvw-parser';
import type { IngestRequest, IngestResponse, StateMessage } from '@sir/shared';
import { buildDvwText, hashScoutLines } from '@sir/shared';
import { computeMatchState } from '@sir/volley-stats';
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { matches, scoutLines } from './db/index.js';
import { HttpError } from './lib/errors.js';

/** Key of the transaction advisory lock that serializes ingests (one live match, no deadlocks). */
const INGEST_LOCK_KEY = 0x53495231;
const INSERT_CHUNK = 1000;
const CACHE_SIZE = 4;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type MatchRow = typeof matches.$inferSelect;
interface CacheEntry {
  matchId: string;
  version: number;
  lines: string[];
}

export interface IngestOutcome {
  response: IngestResponse;
  /** State to push to the WebSocket clients (only when something changed). */
  published: StateMessage | null;
}

const tooManyLines = (max: number): HttpError =>
  new HttpError(413, 'MATCH_TOO_MANY_LINES', `Troppe righe per una partita (massimo ${max})`);

/** Thrown inside the transaction to roll it back and answer `needSnapshot`. */
class NeedSnapshot extends Error {
  constructor(readonly response: IngestResponse) {
    super('needSnapshot');
  }
}

const describe = (row: MatchRow, status: IngestResponse['status']): IngestResponse => ({
  status,
  seq: row.lastSeq,
  lineCount: row.lineCount,
  ...(row.contentHash ? { contentHash: row.contentHash } : {}),
});

/**
 * Applies `append`/`snapshot` requests: the database is the source of truth, a small in-memory cache
 * (checked against the row version) avoids reading all lines back at every request.
 */
export class IngestService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: Db,
    private readonly maxLines: number,
  ) {}

  async ingest(agentId: string, req: IngestRequest): Promise<IngestOutcome> {
    let result: { outcome: IngestOutcome; cache?: CacheEntry };
    try {
      result = await this.db.transaction(async (tx): Promise<{ outcome: IngestOutcome; cache?: CacheEntry }> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${INGEST_LOCK_KEY})`);
        await tx.insert(matches).values({ matchKey: req.matchKey }).onConflictDoNothing({ target: matches.matchKey });
        const [row] = await tx.select().from(matches).where(eq(matches.matchKey, req.matchKey)).for('update');
        if (!row) throw new Error('match row not found after insert');

        if (req.seq <= row.lastSeq) return { outcome: { response: describe(row, 'duplicate'), published: null } };
        if (req.kind === 'append' && req.fromIndex !== row.lineCount)
          throw new NeedSnapshot(describe(row, 'needSnapshot'));
        const header = req.header ?? row.header;
        if (header === null) throw new NeedSnapshot(describe(row, 'needSnapshot'));

        const previous = await this.linesOf(tx, row);
        const lines = req.kind === 'append' ? [...previous, ...req.lines] : req.lines;
        if (lines.length > this.maxLines) throw tooManyLines(this.maxLines);
        const contentHash = await hashScoutLines(lines);
        if (contentHash !== req.contentHash) throw new NeedSnapshot(describe(row, 'needSnapshot'));

        const unchanged = contentHash === row.contentHash && header === row.header && row.live && row.state !== null;
        if (unchanged) {
          await tx.update(matches).set({ lastSeq: req.seq, agentId }).where(eq(matches.id, row.id));
          const response: IngestResponse = { status: 'ok', seq: req.seq, lineCount: lines.length, contentHash };
          return { outcome: { response, published: null } };
        }

        await this.writeLines(tx, row.id, previous, lines, req.kind === 'append');
        const state = computeMatchState(parseDvw(buildDvwText(header, lines)));
        const version = row.version + 1;
        await tx
          .update(matches)
          .set({ live: false })
          .where(and(eq(matches.live, true), ne(matches.id, row.id)));
        await tx
          .update(matches)
          .set({
            header,
            lineCount: lines.length,
            contentHash,
            lastSeq: req.seq,
            agentId,
            live: true,
            state,
            version,
            updatedAt: new Date(),
          })
          .where(eq(matches.id, row.id));
        return {
          outcome: {
            response: { status: 'ok', seq: req.seq, lineCount: lines.length, contentHash },
            published: { type: 'state', matchId: row.id, version, state },
          },
          cache: { matchId: row.id, version, lines },
        };
      });
    } catch (err) {
      if (err instanceof NeedSnapshot) return { response: err.response, published: null };
      throw err;
    }
    if (result.cache) this.remember(result.cache);
    return result.outcome;
  }

  private async linesOf(tx: Tx, row: MatchRow): Promise<string[]> {
    const cached = this.cache.get(row.id);
    if (cached && cached.version === row.version && cached.lines.length === row.lineCount) return cached.lines;
    const rows = await tx
      .select({ text: scoutLines.text })
      .from(scoutLines)
      .where(eq(scoutLines.matchId, row.id))
      .orderBy(asc(scoutLines.idx));
    return rows.map((r) => r.text);
  }

  /** Rewrites only what changed: lines after the common prefix are deleted and inserted again. */
  private async writeLines(
    tx: Tx,
    matchId: string,
    previous: string[],
    lines: string[],
    append: boolean,
  ): Promise<void> {
    let prefix = append ? previous.length : 0;
    if (!append) {
      const max = Math.min(previous.length, lines.length);
      while (prefix < max && previous[prefix] === lines[prefix]) prefix++;
      if (prefix < previous.length) {
        await tx.delete(scoutLines).where(and(eq(scoutLines.matchId, matchId), gte(scoutLines.idx, prefix)));
      }
    }
    for (let start = prefix; start < lines.length; start += INSERT_CHUNK) {
      const values = lines.slice(start, start + INSERT_CHUNK).map((text, i) => ({ matchId, idx: start + i, text }));
      await tx.insert(scoutLines).values(values);
    }
  }

  private remember(entry: CacheEntry): void {
    this.cache.delete(entry.matchId);
    this.cache.set(entry.matchId, entry);
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}
