import type {
  AgentRegistrationSummary,
  AgentSummary,
  CreateAgentResponse,
  CreateShareTokenResponse,
  MatchDetail,
  MatchSummary,
  ShareTokenSummary,
  UserSummary,
} from '@sir/shared';
import {
  CreateAgentRequestSchema,
  CreateShareTokenRequestSchema,
  CreateUserRequestSchema,
  IdParamSchema,
} from '@sir/shared';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute, SESSION_COOKIE } from '../context.js';
import { agentRegistrations, agents, matches, shareTokens, users } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/passwords.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { requireRole, sameOriginGuard } from '../security.js';
import { currentMessage } from '../state.js';

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

const shareSummary = (s: ShareRow): ShareTokenSummary => ({
  id: s.id,
  label: s.label,
  matchId: s.matchId,
  expiresAt: s.expiresAt ? iso(s.expiresAt) : null,
  revoked: s.revoked,
  createdAt: iso(s.createdAt),
});

/** Reserved area: matches for every logged-in user, everything else only for `admin`. */
export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const viewer = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'viewer') };
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  app.get('/api/admin/matches', viewer, async (): Promise<MatchSummary[]> => {
    const rows = await ctx.db.select().from(matches).orderBy(desc(matches.updatedAt)).limit(MATCH_LIST_LIMIT);
    return rows.map(matchSummary);
  });

  app.get('/api/admin/matches/:id', viewer, async (request): Promise<MatchDetail> => {
    const { id } = validate(IdParamSchema, request.params);
    const [m] = await ctx.db.select().from(matches).where(eq(matches.id, id)).limit(1);
    if (!m) throw notFound();
    return { ...matchSummary(m), lastSeq: m.lastSeq, contentHash: m.contentHash, state: m.state };
  });

  app.post('/api/admin/agents', admin, async (request, reply): Promise<CreateAgentResponse> => {
    const body = validate(CreateAgentRequestSchema, request.body);
    const token = generateToken();
    const [row] = await ctx.db
      .insert(agents)
      .values({ name: body.name, tokenHash: hashToken(token) })
      .returning();
    if (!row) throw new Error('agent not inserted');
    request.log.info({ agentId: row.id }, 'token agente creato');
    void reply.code(201);
    return { ...agentSummary(row), token };
  });

  app.get('/api/admin/agents', admin, async (): Promise<AgentSummary[]> => {
    const rows = await ctx.db.select().from(agents).orderBy(desc(agents.createdAt));
    return rows.map(agentSummary);
  });

  app.delete('/api/admin/agents/:id', admin, async (request, reply) => {
    const { id } = validate(IdParamSchema, request.params);
    const rows = await ctx.db
      .update(agents)
      .set({ revoked: true })
      .where(eq(agents.id, id))
      .returning({ id: agents.id });
    if (rows.length === 0) throw notFound();
    request.log.info({ agentId: id }, 'token agente revocato');
    return reply.code(204).send();
  });

  app.get('/api/admin/agent-registrations', admin, async (): Promise<AgentRegistrationSummary[]> => {
    const rows = await ctx.db
      .select()
      .from(agentRegistrations)
      .where(and(eq(agentRegistrations.status, 'pending'), gt(agentRegistrations.expiresAt, ctx.now())))
      .orderBy(desc(agentRegistrations.createdAt));
    return rows.map(registrationSummary);
  });

  /** Approves or rejects a pending, not expired request (404 otherwise); the agent collects its token later. */
  const decide = (status: 'approved' | 'rejected', message: string) =>
    async function (request: FastifyRequest): Promise<AgentRegistrationSummary> {
      const { id } = validate(IdParamSchema, request.params);
      const now = ctx.now();
      const [row] = await ctx.db
        .update(agentRegistrations)
        .set({ status, decidedAt: now })
        .where(
          and(
            eq(agentRegistrations.id, id),
            eq(agentRegistrations.status, 'pending'),
            gt(agentRegistrations.expiresAt, now),
          ),
        )
        .returning();
      if (!row) throw notFound();
      request.log.info({ registrationId: id, userId: request.user?.id }, message);
      return registrationSummary(row);
    };

  app.post('/api/admin/agent-registrations/:id/approve', admin, decide('approved', 'registrazione agente abilitata'));
  app.post('/api/admin/agent-registrations/:id/reject', admin, decide('rejected', 'registrazione agente rifiutata'));

  app.post('/api/admin/share-tokens', admin, async (request, reply): Promise<CreateShareTokenResponse> => {
    const body = validate(CreateShareTokenRequestSchema, request.body);
    const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
    if (expiresAt && expiresAt <= ctx.now()) throw badRequest('Richiesta non valida: expiresAt');
    if (body.matchId) {
      const [m] = await ctx.db.select({ id: matches.id }).from(matches).where(eq(matches.id, body.matchId)).limit(1);
      if (!m) throw badRequest('Richiesta non valida: matchId');
    }
    const token = generateToken();
    const [row] = await ctx.db
      .insert(shareTokens)
      .values({ tokenHash: hashToken(token), matchId: body.matchId, label: body.label, expiresAt })
      .returning();
    if (!row) throw new Error('share token not inserted');
    request.log.info({ shareTokenId: row.id }, 'link pubblico creato');
    void reply.code(201);
    return { ...shareSummary(row), token, url: `${ctx.config.publicBaseUrl}/live/${token}` };
  });

  app.get('/api/admin/share-tokens', admin, async (): Promise<ShareTokenSummary[]> => {
    const rows = await ctx.db.select().from(shareTokens).orderBy(desc(shareTokens.createdAt));
    return rows.map(shareSummary);
  });

  app.delete('/api/admin/share-tokens/:id', admin, async (request, reply) => {
    const { id } = validate(IdParamSchema, request.params);
    const rows = await ctx.db
      .update(shareTokens)
      .set({ revoked: true })
      .where(eq(shareTokens.id, id))
      .returning({ id: shareTokens.id });
    if (rows.length === 0) throw notFound();
    ctx.hub.closeShareToken(id);
    request.log.info({ shareTokenId: id }, 'link pubblico revocato');
    return reply.code(204).send();
  });

  app.post('/api/admin/users', admin, async (request, reply): Promise<UserSummary> => {
    const body = validate(CreateUserRequestSchema, request.body);
    const [existing] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw conflict('Utente già esistente');
    const passwordHash = await hashPassword(body.password);
    const [row] = await ctx.db
      .insert(users)
      .values({ email: body.email, passwordHash, role: body.role })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (!row) throw conflict('Utente già esistente');
    request.log.info({ userId: row.id, role: row.role }, 'utente creato');
    void reply.code(201);
    return { id: row.id, email: row.email, role: row.role, createdAt: iso(row.createdAt) };
  });

  app.get('/api/admin/users', admin, async (): Promise<UserSummary[]> => {
    const rows = await ctx.db.select().from(users).orderBy(users.createdAt);
    return rows.map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: iso(u.createdAt) }));
  });

  // The browser does not apply CORS to WebSocket: a foreign Origin is refused here (CSWSH).
  const sameOrigin = sameOriginGuard(ctx);

  app.get(
    '/ws/admin',
    { config: viewer.config, preHandler: [sameOrigin, viewer.preHandler], websocket: true },
    (socket, request) => {
      const token = request.cookies[SESSION_COOKIE];
      if (!token) {
        socket.close(1008);
        return;
      }
      const target = { kind: 'live' } as const;
      const grant = { kind: 'session', sessionHash: hashToken(token) } as const;
      ctx.hub.add({ socket, target, grant, expiresAt: request.sessionExpiresAt });
      currentMessage(ctx, target).then(
        (message) => ctx.hub.send(socket, message),
        (err: unknown) => {
          request.log.error({ err }, 'stato iniziale non disponibile');
          ctx.hub.send(socket, { type: 'error', message: 'Errore interno' });
        },
      );
    },
  );
}
