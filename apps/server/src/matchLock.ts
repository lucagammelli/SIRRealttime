import { eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { matches } from './db/index.js';
import { tenantScope } from './tenancy.js';

/**
 * Key of the transaction advisory lock that serializes the ingests of one client and every other change of its live
 * matches and of their link to the calendar (one live match per match of the calendar; no deadlocks: a transaction
 * takes only this lock); the second key is a hash of the client id.
 */
const INGEST_LOCK_KEY = 0x53495231;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Takes the lock of the live matches of a client until the end of the transaction. */
export async function lockTenantMatches(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${INGEST_LOCK_KEY}, hashtext(${tenantId}))`);
}

/**
 * Under the lock: no other match of the same group stays live (the matches of one match of the calendar, or the ones
 * without a match of the calendar).
 */
export async function switchOffOthers(
  tx: Tx,
  tenantId: string,
  matchId: string,
  clientFixtureId: string | null,
): Promise<void> {
  await tx
    .update(matches)
    .set({ live: false })
    .where(
      tenantScope(
        matches,
        tenantId,
        eq(matches.live, true),
        ne(matches.id, matchId),
        clientFixtureId ? eq(matches.clientFixtureId, clientFixtureId) : isNull(matches.clientFixtureId),
      ),
    );
}

/**
 * Under the lock: whether a live `.dvw` moved by a confirmation (of the admin or of a later update of the calendar)
 * to the group of `clientFixtureId` can stay live. A confirmation never takes the place of the match already live in
 * that group (the court that is on air keeps its link): then the moved `.dvw` stops being live (its own next ingest
 * makes it live again, as for any agent that sends).
 */
export async function canStayLive(
  tx: Tx,
  tenantId: string,
  matchId: string,
  clientFixtureId: string | null,
): Promise<boolean> {
  const [other] = await tx
    .select({ id: matches.id })
    .from(matches)
    .where(
      tenantScope(
        matches,
        tenantId,
        eq(matches.live, true),
        ne(matches.id, matchId),
        clientFixtureId ? eq(matches.clientFixtureId, clientFixtureId) : isNull(matches.clientFixtureId),
      ),
    )
    .limit(1);
  return !other;
}
