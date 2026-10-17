import { count, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { agentRegistrations, agents, tenants } from './db/index.js';
import { HttpError } from './lib/errors.js';
import type { Tx } from './matchLock.js';
import { tenantScope } from './tenancy.js';

/**
 * Quota of agents of a client (`tenants.agent_quota`, given by the superadmin): the agents not revoked and not
 * expired, plus the registrations enabled and not collected yet (each one becomes an agent), never more than the
 * quota. Checked under a lock of the client, so two approvals at the same time cannot both take the last place.
 */

/** Key of the transaction lock (with a hash of the client) that serializes the changes to the agents of a client. */
const AGENT_LOCK_KEY = 0x53494147;

export async function lockTenantAgents(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AGENT_LOCK_KEY}, hashtext(${tenantId}))`);
}

/** Agents counted against the quota at `now` (without `exceptAgentId`, the one being changed). */
export async function agentsInUse(tx: Tx, tenantId: string, now: Date, exceptAgentId?: string): Promise<number> {
  const [active] = await tx
    .select({ n: count() })
    .from(agents)
    .where(
      tenantScope(
        agents,
        tenantId,
        eq(agents.revoked, false),
        or(isNull(agents.expiresAt), gt(agents.expiresAt, now)),
        exceptAgentId ? ne(agents.id, exceptAgentId) : undefined,
      ),
    );
  const [approved] = await tx
    .select({ n: count() })
    .from(agentRegistrations)
    .where(
      tenantScope(
        agentRegistrations,
        tenantId,
        eq(agentRegistrations.status, 'approved'),
        gt(agentRegistrations.expiresAt, now),
      ),
    );
  return (active?.n ?? 0) + (approved?.n ?? 0);
}

export async function agentQuotaOf(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx.select({ quota: tenants.agentQuota }).from(tenants).where(eq(tenants.id, tenantId));
  return row?.quota ?? 0;
}

/** Pure: the 409 of a client that has no free place for one more agent. */
export function quotaReached(quota: number): HttpError {
  const what = quota === 1 ? 'un agente' : `${quota} agenti`;
  return new HttpError(
    409,
    'AGENT_QUOTA',
    `Limite di agenti raggiunto: questo cliente può avere ${what}. Revoca un agente che non usi o chiedi al superadmin di aumentare il limite`,
  );
}

/** Under `lockTenantAgents`: 409 when one more agent would go past the quota of the client. */
export async function requireAgentSlot(tx: Tx, tenantId: string, now: Date, exceptAgentId?: string): Promise<void> {
  const quota = await agentQuotaOf(tx, tenantId);
  const used = await agentsInUse(tx, tenantId, now, exceptAgentId);
  if (used >= quota) throw quotaReached(quota);
}
