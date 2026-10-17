import type {
  AgentQuotaResponse,
  AgentRegistrationSummary,
  AgentSummary,
  CreateAgentResponse,
  CreateShareTokenResponse,
  MatchDetail,
  MatchSummary,
  ShareTokenSummary,
} from '@sir/shared';
import {
  AgentValidityRequestSchema,
  CreateAgentRequestSchema,
  CreateShareTokenRequestSchema,
  IdParamSchema,
} from '@sir/shared';
import { and, desc, eq, gt, notExists } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { agentQuotaOf, agentsInUse, lockTenantAgents, requireAgentSlot } from '../agentQuota.js';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { agentRegistrations, agents, matches, shareTokens } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { requireRole, sameOriginGuard } from '../security.js';
import { ensureShortCode, insertShareToken } from '../shareCodes.js';
import { attachLiveSocket, encodingOf, forgetShareToken } from '../state.js';
import { adminTenantId, findTenant, publicBaseUrlFor, tenantScope } from '../tenancy.js';

type MatchRow = typeof matches.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type ShareRow = typeof shareTokens.$inferSelect;
type RegistrationRow = typeof agentRegistrations.$inferSelect;

const iso = (d: Date): string => d.toISOString();
const MATCH_LIST_LIMIT = 200;

function matchSummary(m: MatchRow): MatchSummary {
  return {
    id: m.id,
    matchKey: m.matchKey,
    live: m.live,
    lineCount: m.lineCount,
    version: m.version,
    homeName: m.state?.teams.home.name ?? null,
    awayName: m.state?.teams.away.name ?? null,
    setsWon: m.state ? { home: m.state.setsWon.home, away: m.state.setsWon.away } : null,
    status: m.state?.status ?? null,
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
  };
}

const agentSummary = (a: AgentRow): AgentSummary => ({
  id: a.id,
  name: a.name,
  revoked: a.revoked,
  lastSeenAt: a.lastSeenAt ? iso(a.lastSeenAt) : null,
  createdAt: iso(a.createdAt),
  expiresAt: a.expiresAt ? iso(a.expiresAt) : null,
});

const registrationSummary = (r: RegistrationRow): AgentRegistrationSummary => ({
  id: r.id,
  name: r.name,
  pairingCode: r.pairingCode,
  ip: r.ip,
  createdAt: iso(r.createdAt),
  expiresAt: iso(r.expiresAt),
  status: r.status,
});

/** `code`: the short code of the link (null for a revoked one); `base`: public base URL of the client. */
const shareSummary = (s: ShareRow, code: string | null, base: string): ShareTokenSummary => ({
  id: s.id,
  label: s.label,
  matchId: s.matchId,
  clientFixtureId: s.clientFixtureId,
  expiresAt: s.expiresAt ? iso(s.expiresAt) : null,
  revoked: s.revoked,
  createdAt: iso(s.createdAt),
  shortCode: code,
  shortUrl: code ? `${base}/l/${code}` : null,
});

/**
 * Reserved area: reading for every logged-in user (`viewer` included: matches, agents, public links), every change and
 * the lists with personal data (addresses of the registrations; the users are in `users.ts`) only for `admin` (and
 * `superadmin`). Every
 * query is limited to the client of the session (`adminTenantId`) with `tenantScope`: an id of another client is a 404.
 */
export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const viewer = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'viewer') };
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  app.get('/api/admin/matches', viewer, async (request): Promise<MatchSummary[]> => {
    const tenantId = adminTenantId(request);
    const rows = await ctx.db
      .select()
      .from(matches)
      // A simulated match is not a match of the client: it is on the page «Simulazione» only.
      .where(tenantScope(matches, tenantId, eq(matches.simulated, false)))
      .orderBy(desc(matches.updatedAt))
      .limit(MATCH_LIST_LIMIT);
    return rows.map(matchSummary);
  });

  app.get('/api/admin/matches/:id', viewer, async (request): Promise<MatchDetail> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const [m] = await ctx.db
      .select()
      .from(matches)
      .where(tenantScope(matches, tenantId, eq(matches.id, id), eq(matches.simulated, false)))
      .limit(1);
    if (!m) throw notFound();
    return { ...matchSummary(m), lastSeq: m.lastSeq, contentHash: m.contentHash, state: m.state };
  });

  /** End of a validity chosen by the admin: null (no expiry) or a time in the future (400 otherwise). */
  const validityOf = (body: unknown): Date | null => {
    const { expiresAt } = validate(AgentValidityRequestSchema, body ?? {});
    const end = expiresAt === null ? null : new Date(expiresAt);
    if (end && end <= ctx.now()) throw badRequest('Richiesta non valida: la scadenza deve essere nel futuro');
    return end;
  };

  app.post('/api/admin/agents', admin, async (request, reply): Promise<CreateAgentResponse> => {
    const tenantId = adminTenantId(request);
    const body = validate(CreateAgentRequestSchema, request.body);
    const token = generateToken();
    const row = await ctx.db.transaction(async (tx) => {
      await lockTenantAgents(tx, tenantId);
      await requireAgentSlot(tx, tenantId, ctx.now());
      const [inserted] = await tx
        .insert(agents)
        .values({ tenantId, name: body.name, tokenHash: hashToken(token) })
        .returning();
      return inserted;
    });
    if (!row) throw new Error('agent not inserted');
    request.log.info({ agentId: row.id }, 'token agente creato');
    void reply.code(201);
    return { ...agentSummary(row), token };
  });

  app.get('/api/admin/agents', viewer, async (request): Promise<AgentSummary[]> => {
    const tenantId = adminTenantId(request);
    const rows = await ctx.db
      .select()
      .from(agents)
      .where(tenantScope(agents, tenantId))
      .orderBy(desc(agents.createdAt));
    return rows.map(agentSummary);
  });

  app.get('/api/admin/agent-quota', viewer, async (request): Promise<AgentQuotaResponse> => {
    const tenantId = adminTenantId(request);
    return ctx.db.transaction(async (tx) => ({
      quota: await agentQuotaOf(tx, tenantId),
      used: await agentsInUse(tx, tenantId, ctx.now()),
    }));
  });

  /**
   * New validity of an agent not revoked («Prolunga»: null for no expiry). An agent already expired that becomes
   * valid again takes a place of the quota (409 when there is none).
   */
  app.patch('/api/admin/agents/:id', admin, async (request): Promise<AgentSummary> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const expiresAt = validityOf(request.body);
    const row = await ctx.db.transaction(async (tx) => {
      await lockTenantAgents(tx, tenantId);
      const [agent] = await tx
        .select()
        .from(agents)
        .where(tenantScope(agents, tenantId, eq(agents.id, id), eq(agents.revoked, false)))
        .limit(1);
      if (!agent) throw notFound();
      const now = ctx.now();
      if (agent.expiresAt && agent.expiresAt <= now) await requireAgentSlot(tx, tenantId, now, agent.id);
      const [updated] = await tx
        .update(agents)
        .set({ expiresAt })
        .where(tenantScope(agents, tenantId, eq(agents.id, id)))
        .returning();
      return updated;
    });
    if (!row) throw notFound();
    request.log.info({ agentId: id, expiresAt: row.expiresAt, userId: request.user?.id }, 'validità agente cambiata');
    return agentSummary(row);
  });

  app.delete('/api/admin/agents/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const rows = await ctx.db
      .update(agents)
      .set({ revoked: true })
      .where(tenantScope(agents, tenantId, eq(agents.id, id)))
      .returning({ id: agents.id });
    if (rows.length === 0) throw notFound();
    request.log.info({ agentId: id }, 'token agente revocato');
    return reply.code(204).send();
  });

  app.get('/api/admin/agent-registrations', admin, async (request): Promise<AgentRegistrationSummary[]> => {
    const tenantId = adminTenantId(request);
    const rows = await ctx.db
      .select()
      .from(agentRegistrations)
      .where(
        tenantScope(
          agentRegistrations,
          tenantId,
          eq(agentRegistrations.status, 'pending'),
          gt(agentRegistrations.expiresAt, ctx.now()),
        ),
      )
      .orderBy(desc(agentRegistrations.createdAt));
    return rows.map(registrationSummary);
  });

  /**
   * Approves or rejects a pending, not expired request (404 otherwise); the agent collects its token later. The
   * approval carries the validity of the agent («Senza scadenza» or «Fino al») and needs a free place in the quota of
   * the client (409 otherwise).
   */
  const decide = (status: 'approved' | 'rejected', message: string) =>
    async function (request: FastifyRequest): Promise<AgentRegistrationSummary> {
      const tenantId = adminTenantId(request);
      const { id } = validate(IdParamSchema, request.params);
      const agentExpiresAt = status === 'approved' ? validityOf(request.body) : null;
      const now = ctx.now();
      const row = await ctx.db.transaction(async (tx) => {
        await lockTenantAgents(tx, tenantId);
        const pending = tenantScope(
          agentRegistrations,
          tenantId,
          eq(agentRegistrations.id, id),
          eq(agentRegistrations.status, 'pending'),
          gt(agentRegistrations.expiresAt, now),
        );
        const [found] = await tx.select({ id: agentRegistrations.id }).from(agentRegistrations).where(pending);
        if (!found) throw notFound();
        if (status === 'approved') await requireAgentSlot(tx, tenantId, now);
        const [updated] = await tx
          .update(agentRegistrations)
          .set({ status, decidedAt: now, agentExpiresAt })
          .where(pending)
          .returning();
        return updated;
      });
      if (!row) throw notFound();
      request.log.info({ registrationId: id, userId: request.user?.id }, message);
      return registrationSummary(row);
    };

  app.post('/api/admin/agent-registrations/:id/approve', admin, decide('approved', 'registrazione agente abilitata'));
  app.post('/api/admin/agent-registrations/:id/reject', admin, decide('rejected', 'registrazione agente rifiutata'));

  app.post('/api/admin/share-tokens', admin, async (request, reply): Promise<CreateShareTokenResponse> => {
    const tenantId = adminTenantId(request);
    const body = validate(CreateShareTokenRequestSchema, request.body);
    const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
    if (expiresAt && expiresAt <= ctx.now()) throw badRequest('Richiesta non valida: expiresAt');
    if (body.matchId) {
      const [m] = await ctx.db
        .select({ id: matches.id })
        .from(matches)
        .where(tenantScope(matches, tenantId, eq(matches.id, body.matchId), eq(matches.simulated, false)))
        .limit(1);
      if (!m) throw badRequest('Richiesta non valida: matchId');
    }
    const tenant = await findTenant(ctx, { id: tenantId });
    const token = generateToken();
    const { row, code } = await insertShareToken(ctx.db, ctx.config.shareCodeSecret, {
      tenantId,
      tokenHash: hashToken(token),
      matchId: body.matchId,
      label: body.label,
      expiresAt,
    });
    request.log.info({ shareTokenId: row.id }, 'link pubblico creato');
    void reply.code(201);
    // The link works only on a hostname of the client: its URL uses one of them.
    const base = publicBaseUrlFor(ctx.config.publicBaseUrl, tenant?.hostnames ?? []);
    return { ...shareSummary(row, code, base), token, url: `${base}/live/${token}` };
  });

  /** The short code of each link is derived again from its id (assigned first to a link that has none yet). */
  app.get('/api/admin/share-tokens', viewer, async (request): Promise<ShareTokenSummary[]> => {
    const tenantId = adminTenantId(request);
    const tenant = await findTenant(ctx, { id: tenantId });
    const base = publicBaseUrlFor(ctx.config.publicBaseUrl, tenant?.hostnames ?? []);
    const rows = await ctx.db
      .select()
      .from(shareTokens)
      // The link of a simulation is on the page «Simulazione» only (deleted with it).
      .where(
        tenantScope(
          shareTokens,
          tenantId,
          notExists(
            ctx.db
              .select({ id: matches.id })
              .from(matches)
              .where(and(eq(matches.id, shareTokens.matchId), eq(matches.simulated, true))),
          ),
        ),
      )
      .orderBy(desc(shareTokens.createdAt));
    const summaries: ShareTokenSummary[] = [];
    for (const row of rows) {
      if (row.revoked) {
        summaries.push(shareSummary(row, null, base));
        continue;
      }
      const ensured = await ensureShortCode(ctx.db, ctx.config.shareCodeSecret, row);
      summaries.push(shareSummary(ensured.row, ensured.code, base));
    }
    return summaries;
  });

  app.delete('/api/admin/share-tokens/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const rows = await ctx.db
      .update(shareTokens)
      .set({ revoked: true })
      .where(tenantScope(shareTokens, tenantId, eq(shareTokens.id, id)))
      .returning({ id: shareTokens.id });
    if (rows.length === 0) throw notFound();
    forgetShareToken(ctx, id);
    ctx.hub.closeShareToken(id);
    request.log.info({ shareTokenId: id }, 'link pubblico revocato');
    return reply.code(204).send();
  });

  // The browser does not apply CORS to WebSocket: a foreign Origin is refused here (CSWSH).
  const sameOrigin = sameOriginGuard(ctx);

  app.get(
    '/ws/admin',
    { config: viewer.config, preHandler: [sameOrigin, viewer.preHandler], websocket: true },
    (socket, request) => {
      const token = request.cookies[SESSION_COOKIE];
      const tenantId = request.adminTenantId;
      if (!token || !tenantId) {
        socket.close(1008);
        return;
      }
      // The live match of the client of the session (a superadmin who changes client reconnects).
      const target = { kind: 'live', tenantId } as const;
      const grant = { kind: 'session', sessionHash: hashToken(token) } as const;
      const encoding = encodingOf(request.query);
      attachLiveSocket(ctx, { socket, target, grant, expiresAt: request.sessionExpiresAt, encoding }, request.log);
    },
  );
}
