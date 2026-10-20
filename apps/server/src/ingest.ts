import { parseDvw } from '@sir/dvw-parser';
import type { IngestRequest, IngestResponse, StateMessage } from '@sir/shared';
import { buildDvwText, hashScoutLines } from '@sir/shared';
import { computeMatchState } from '@sir/volley-stats';
import { and, asc, eq, gte } from 'drizzle-orm';
import { evaluateFixtureLink } from './club.js';
import type { AppContext } from './context.js';
import type { Db } from './db/index.js';
import { matches, scoutLines } from './db/index.js';
import type { PublishRoute } from './hub.js';
import { conflict, HttpError } from './lib/errors.js';
import type { Tx } from './matchLock.js';
import { lockTenantMatches, switchOffOthers } from './matchLock.js';
import { channelAllowed, withLogos } from './state.js';
import { tenantScope } from './tenancy.js';

const INSERT_CHUNK = 1000;
const CACHE_SIZE = 4;

type MatchRow = typeof matches.$inferSelect;
interface CacheEntry {
  matchId: string;
  version: number;
  lines: string[];
}

/**
 * Who sends the lines: an agent of the client (`agentId`), or the simulation of the server (`simulated`: no agent;
 * the match is never live nor linked to the calendar, see `src/simulation/`).
 */
export interface IngestSource {
  tenantId: string;
  agentId: string | null;
  simulated: boolean;
}

export interface IngestOutcome {
  response: IngestResponse;
  /** State to push to the WebSocket clients (only when something changed). */
  published: StateMessage | null;
  /** Where the state goes (match of the calendar, live link); with `published`. */
  route?: PublishRoute;
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
    /** Clock of the server (`ctx.now`): `updated_at` and `live_since` decide when a match leaves the channel. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The match is `req.matchKey` of the client of the source: agents of other clients never touch it, and an agent
   * never touches a simulated match (nor the simulation a match of an agent): 409.
   */
  async ingest(source: IngestSource, req: IngestRequest): Promise<IngestOutcome> {
    const { tenantId, agentId, simulated } = source;
    let result: { outcome: IngestOutcome; cache?: CacheEntry };
    try {
      result = await this.db.transaction(async (tx): Promise<{ outcome: IngestOutcome; cache?: CacheEntry }> => {
        await lockTenantMatches(tx, tenantId);
        await tx
          .insert(matches)
          .values({ tenantId, matchKey: req.matchKey, simulated })
          .onConflictDoNothing({ target: [matches.tenantId, matches.matchKey] });
        const [row] = await tx
          .select()
          .from(matches)
          .where(tenantScope(matches, tenantId, eq(matches.matchKey, req.matchKey)))
          .for('update');
        if (!row) throw new Error('match row not found after insert');
        if (row.simulated !== simulated) throw conflict('Partita già usata da un’altra sorgente');

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

        const unchanged =
          contentHash === row.contentHash && header === row.header && (row.live || simulated) && row.state !== null;
        if (unchanged) {
          await tx.update(matches).set({ lastSeq: req.seq, agentId }).where(eq(matches.id, row.id));
          const response: IngestResponse = { status: 'ok', seq: req.seq, lineCount: lines.length, contentHash };
          return { outcome: { response, published: null } };
        }

        await this.writeLines(tx, row.id, previous, lines, req.kind === 'append');
        const parsed = parseDvw(buildDvwText(header, lines));
        const state = computeMatchState(parsed);
        const version = row.version + 1;
        // The match of the calendar is looked for when the header arrives or changes, until it is decided.
        let link = {
          clientFixtureId: row.clientFixtureId,
          fixtureLink: row.fixtureLink,
          fixtureCandidates: row.fixtureCandidates,
        };
        // A simulated match is never linked to the calendar and never live: the live matches stay as they are.
        if (!simulated && header !== row.header && (row.fixtureLink === null || row.fixtureLink === 'pending')) {
          link = (await evaluateFixtureLink(tx, tenantId, parsed)) ?? link;
        }
        const now = this.now();
        if (!simulated) await switchOffOthers(tx, tenantId, row.id, link.clientFixtureId);
        await tx
          .update(matches)
          .set({
            header,
            lineCount: lines.length,
            contentHash,
            lastSeq: req.seq,
            agentId,
            live: !simulated,
            liveSince: simulated ? null : row.live ? row.liveSince : now,
            state,
            version,
            ...link,
            updatedAt: now,
          })
          .where(eq(matches.id, row.id));
        return {
          outcome: {
            response: { status: 'ok', seq: req.seq, lineCount: lines.length, contentHash },
            published: { type: 'state', matchId: row.id, version, state, ...(simulated ? { simulated: true } : {}) },
            route: simulated
              ? { clientFixtureId: null, becameLive: false, channel: false, isolated: true }
              : { clientFixtureId: link.clientFixtureId, becameLive: !row.live },
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

/**
 * The pipeline of the ingest, the same for `POST /api/ingest` and for the simulation of the server: applies the
 * request (`IngestService.ingest`) and pushes the new state to the WebSocket clients (logos, channel, route). A match
 * that starts or ends changes «Prossima partita»: the public schedule is read again (not for a simulated match).
 */
export async function applyIngest(ctx: AppContext, source: IngestSource, req: IngestRequest): Promise<IngestOutcome> {
  const outcome = await ctx.ingest.ingest(source, req);
  const { published, route } = outcome;
  if (published) {
    const fixtureId = route?.clientFixtureId ?? null;
    const message = await withLogos(ctx, source.tenantId, published, fixtureId);
    const channel = source.simulated ? false : await channelAllowed(ctx, source.tenantId, fixtureId);
    ctx.publisher.publish(source.tenantId, message, route ? { ...route, channel } : route);
    if (!source.simulated && (route?.becameLive || published.state.status === 'finished'))
      ctx.caches.schedule.delete(source.tenantId);
  }
  return outcome;
}
