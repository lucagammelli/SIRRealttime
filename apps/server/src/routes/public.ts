import type { ServerMessage } from '@sir/shared';
import { ShareTokenParamSchema } from '@sir/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute, SERVER_FULL_RETRY_AFTER_S } from '../context.js';
import { notFound, serverFull, tooManyRequests } from '../lib/errors.js';
import { attachLiveSocket, currentMessage, encodingOf, resolveShareToken, targetOf } from '../state.js';
import { hostTenant } from '../tenancy.js';

const ipOf = (request: FastifyRequest): string => request.ip || 'sconosciuto';

/**
 * Read-only public access with a share token of the client of the hostname; any invalid, revoked or expired token,
 * a token of another client and a hostname without client are a plain 404. Those failures are counted per IP
 * (`rateLimits.publicInvalid` per minute, then 429 for every public request of that IP until the minute ends);
 * successful requests have only the generous per-route limits, made for many spectators behind one IP.
 * Known limit (accepted): many phones behind one NAT opening a revoked link (about 2 failures each) can block that
 * IP for up to a minute, valid links included.
 */
export function publicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const resolve = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = ipOf(request);
    const wait = ctx.publicFailures.blockedFor(ip);
    if (wait > 0) {
      void reply.header('retry-after', String(Math.ceil(wait / 1000)));
      throw tooManyRequests();
    }
    const parsed = ShareTokenParamSchema.safeParse(request.params);
    const tenant = parsed.success ? await hostTenant(ctx, request) : null;
    const share = parsed.success && tenant ? await resolveShareToken(ctx, tenant.id, parsed.data.token) : null;
    if (!share) {
      ctx.publicFailures.fail(ip);
      throw notFound();
    }
    request.shareToken = share;
  };

  /** 503 with Retry-After when the public WebSockets are at their limit, in total or from this IP. */
  const capacity = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const open = ctx.hub.publicSockets(ipOf(request));
    if (open.total >= ctx.socketLimits.total || open.fromIp >= ctx.socketLimits.perIp) {
      void reply.header('retry-after', String(SERVER_FULL_RETRY_AFTER_S));
      throw serverFull();
    }
    return Promise.resolve();
  };

  // The portal calls it when its WebSocket does not open: a 503 here tells it the server is full.
  app.get(
    '/api/public/:token/state',
    { config: perMinute(ctx.rateLimits.public), preValidation: [resolve, capacity] },
    async (request, reply): Promise<ServerMessage> => {
      if (!request.shareToken) throw notFound();
      void reply.header('cache-control', 'no-store');
      return currentMessage(ctx, targetOf(request.shareToken));
    },
  );

  app.get(
    '/ws/public/:token',
    { websocket: true, config: perMinute(ctx.rateLimits.publicWs), preValidation: [resolve, capacity] },
    (socket, request) => {
      const share = request.shareToken;
      if (!share) {
        socket.close(1008);
        return;
      }
      attachLiveSocket(
        ctx,
        {
          socket,
          target: targetOf(share),
          grant: { kind: 'share', shareTokenId: share.id },
          expiresAt: share.expiresAt,
          encoding: encodingOf(request.query),
          ip: ipOf(request),
        },
        request.log,
      );
    },
  );
}
