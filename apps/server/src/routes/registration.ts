import type { CreateRegistrationResponse, RegistrationStatusResponse } from '@sir/shared';
import { CreateRegistrationRequestSchema } from '@sir/shared';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { agentRegistrations, agents } from '../db/index.js';
import { HttpError, notFound, unauthorized } from '../lib/errors.js';
import { generatePairingCode, generateToken, hashesEqual, hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { bearerHash, browserWriteGuard } from '../security.js';
import { hostTenant, tenantScope } from '../tenancy.js';

/** A request not approved and collected within this time expires. */
export const REGISTRATION_TTL_MS = 24 * 3_600_000;
/** Most pending (not expired) requests of one client at the same time: over it, a new request gets 429. */
export const MAX_PENDING_REGISTRATIONS = 20;
/** Requests expired for longer than this are deleted when a new one arrives. */
const RETENTION_MS = 7 * 24 * 3_600_000;
/** Key of the transaction lock that serializes the check of MAX_PENDING_REGISTRATIONS (with a hash of the client). */
const CREATE_LOCK_KEY = 4_172_026;

/** Body of the status query: no fields (the secret travels in the Authorization header). */
const StatusRequestSchema = z.object({});

type RegistrationRow = typeof agentRegistrations.$inferSelect;

const tooManyPending = (): HttpError =>
  new HttpError(429, 'TOO_MANY_PENDING', 'Troppe richieste di registrazione in attesa, riprova più tardi');

/**
 * Public routes of the agent self-registration (pairing): the agent asks with a name and polls with its secret;
 * the admin approves or rejects from `/api/admin/agent-registrations`. JSON only and no foreign Origin, as for the
 * browser routes (the agent sends no Origin). The request belongs to the client of the hostname (404 without one):
 * only the admins of that client see it, and the agent is created there.
 */
export function registrationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const guard = browserWriteGuard(ctx);

  app.post(
    '/api/agents/registrations',
    { config: perMinute(ctx.rateLimits.register), preParsing: guard },
    async (request, reply): Promise<CreateRegistrationResponse> => {
      const tenant = await hostTenant(ctx, request);
      if (!tenant) throw notFound();
      const tenantId = tenant.id;
      const body = validate(CreateRegistrationRequestSchema, request.body);
      const now = ctx.now();
      const secret = generateToken();
      const pairingCode = generatePairingCode();
      const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS);
      const row = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${CREATE_LOCK_KEY}, hashtext(${tenantId}))`);
        await tx
          .delete(agentRegistrations)
          .where(
            tenantScope(
              agentRegistrations,
              tenantId,
              lt(agentRegistrations.expiresAt, new Date(now.getTime() - RETENTION_MS)),
            ),
          );
        const [pending] = await tx
          .select({ n: count() })
          .from(agentRegistrations)
          .where(
            tenantScope(
              agentRegistrations,
              tenantId,
              eq(agentRegistrations.status, 'pending'),
              gt(agentRegistrations.expiresAt, now),
            ),
          );
        if ((pending?.n ?? 0) >= MAX_PENDING_REGISTRATIONS) return null;
        const [inserted] = await tx
          .insert(agentRegistrations)
          .values({
            tenantId,
            name: body.name,
            secretHash: hashToken(secret),
            pairingCode,
            ip: request.ip || null,
            createdAt: now,
            expiresAt,
          })
          .returning({ id: agentRegistrations.id });
        return inserted ?? null;
      });
      if (!row) {
        request.log.warn('registrazione agente rifiutata: troppe richieste in attesa');
        throw tooManyPending();
      }
      request.log.info({ registrationId: row.id }, 'richiesta di registrazione agente');
      void reply.code(201);
      return { registrationId: row.id, secret, pairingCode, expiresAt: expiresAt.toISOString() };
    },
  );

  app.post(
    '/api/agents/registrations/status',
    // Polled by the agent every few seconds: same budget as the ingest.
    { config: perMinute(ctx.rateLimits.ingest), preParsing: guard },
    async (request): Promise<RegistrationStatusResponse> => {
      const hash = bearerHash(request);
      validate(StatusRequestSchema, request.body);
      const row = await findBySecret(ctx, hash);
      if (!row) throw unauthorized();
      return statusOf(ctx, request, row);
    },
  );
}

/** The secret identifies the request, and so its client (as the agent token does for the ingest). */
async function findBySecret(ctx: AppContext, hash: string): Promise<RegistrationRow | null> {
  const [row] = await ctx.db.select().from(agentRegistrations).where(eq(agentRegistrations.secretHash, hash)).limit(1);
  return row && hashesEqual(row.secretHash, hash) ? row : null;
}

/** State seen by the agent; an approved request is consumed here, creating the agent and returning its token once. */
async function statusOf(
  ctx: AppContext,
  request: FastifyRequest,
  row: RegistrationRow,
  claim = true,
): Promise<RegistrationStatusResponse> {
  const now = ctx.now();
  if (row.status === 'rejected') return { status: 'rejected' };
  if (row.status === 'consumed') return { status: 'consumed' };
  if (row.expiresAt <= now) return { status: 'expired' };
  if (row.status === 'pending') return { status: 'pending', expiresAt: row.expiresAt.toISOString() };
  if (!claim) return { status: 'consumed' };

  const token = generateToken();
  const agentId = await ctx.db.transaction(async (tx) => {
    // Conditional update: of two concurrent queries only one claims the request.
    const [claimed] = await tx
      .update(agentRegistrations)
      .set({ status: 'consumed' })
      .where(
        and(
          eq(agentRegistrations.id, row.id),
          eq(agentRegistrations.status, 'approved'),
          gt(agentRegistrations.expiresAt, now),
        ),
      )
      .returning({ name: agentRegistrations.name, tenantId: agentRegistrations.tenantId });
    if (!claimed) return null;
    const [agent] = await tx
      .insert(agents)
      .values({ tenantId: claimed.tenantId, name: claimed.name, tokenHash: hashToken(token) })
      .returning({ id: agents.id });
    if (!agent) throw new Error('agent not inserted');
    await tx.update(agentRegistrations).set({ agentId: agent.id }).where(eq(agentRegistrations.id, row.id));
    return agent.id;
  });
  if (!agentId) {
    const [fresh] = await ctx.db.select().from(agentRegistrations).where(eq(agentRegistrations.id, row.id)).limit(1);
    return fresh ? statusOf(ctx, request, fresh, false) : { status: 'expired' };
  }
  request.log.info({ registrationId: row.id, agentId }, 'agente registrato: token consegnato');
  return { status: 'approved', token, agentId };
}
