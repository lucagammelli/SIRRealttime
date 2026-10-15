import type { ServerMessage } from '@sir/shared';
import { ShareTokenParamSchema } from '@sir/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { notFound } from '../lib/errors.js';
import { currentMessage, resolveShareToken, targetOf } from '../state.js';
import { hostTenant } from '../tenancy.js';

/**
 * Read-only public access with a share token of the client of the hostname; any invalid, revoked or expired token,
 * a token of another client and a hostname without client are a plain 404.
 */
export function publicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const resolve = async (request: FastifyRequest): Promise<void> => {
    const parsed = ShareTokenParamSchema.safeParse(request.params);
    const tenant = parsed.success ? await hostTenant(ctx, request) : null;
    const share = parsed.success && tenant ? await resolveShareToken(ctx, tenant.id, parsed.data.token) : null;
    if (!share) throw notFound();
    request.shareToken = share;
  };

  app.get(
    '/api/public/:token/state',
    { config: perMinute(ctx.rateLimits.public), preValidation: resolve },
    async (request, reply): Promise<ServerMessage> => {
      if (!request.shareToken) throw notFound();
      void reply.header('cache-control', 'no-store');
      return currentMessage(ctx, targetOf(request.shareToken));
    },
  );

  app.get(
    '/ws/public/:token',
    { websocket: true, config: perMinute(ctx.rateLimits.public), preValidation: resolve },
    (socket, request) => {
      const share = request.shareToken;
      if (!share) {
        socket.close(1008);
        return;
      }
      const target = targetOf(share);
      ctx.hub.add({ socket, target, grant: { kind: 'share', shareTokenId: share.id }, expiresAt: share.expiresAt });
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
