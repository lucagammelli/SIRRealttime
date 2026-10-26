import type { DisplayHeartbeatResponse } from '@arenalive/shared';
import {
  DISPLAY_CLOSE_INVALID,
  DISPLAY_CLOSE_NO_AUTH,
  DisplayAckMessageSchema,
  DisplayAuthMessageSchema,
  DisplayHeartbeatRequestSchema,
  displayUpdateWanted,
} from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { AgentReleaseStore, PLAYER_FILES } from '../agentRelease.js';
import type { AppContext } from '../context.js';
import { perMinute, SERVER_FULL_RETRY_AFTER_S } from '../context.js';
import { displays } from '../db/index.js';
import { acknowledgeCommand, hubTargetOf, showDisplay } from '../displays.js';
import { HttpError, notFound, serverFull, tooManyRequests, unauthorized } from '../lib/errors.js';
import { hashToken } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { authenticateDisplay, findDisplay, sameOriginGuard } from '../security.js';
import { attachLiveSocket, encodingOf } from '../state.js';
import { hostTenant } from '../tenancy.js';

/** The first message of `/ws/display` (the token) must arrive within this time. */
export const DISPLAY_AUTH_TIMEOUT_MS = 10_000;

const ipOf = (request: FastifyRequest): string => request.ip || 'sconosciuto';

const notPublished = (): HttpError =>
  new HttpError(404, 'DISPLAY_UPDATE_MISSING', 'Il software del player non è pubblicato sul server');

/**
 * Routes of the players (Raspberry Pi of the big screens), outside the browser scope: the heartbeat and the update of
 * the device with its bearer token, and the WebSocket of the page `/schermo` with the token in the first message.
 */
export function displayRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = new AgentReleaseStore(ctx.config.playerDownloadDir, PLAYER_FILES);
  const device = { config: perMinute(ctx.rateLimits.display), preHandler: authenticateDisplay(ctx) };

  /**
   * Every 15 s: what the device is (software, screen) and the last command it executed (`ackSeq`); the answer has the
   * pending command and, when a newer software is on offer, its version, sha256 and size.
   */
  app.post('/api/displays/heartbeat', device, async (request): Promise<DisplayHeartbeatResponse> => {
    const display = request.display;
    if (!display) throw unauthorized();
    const body = validate(DisplayHeartbeatRequestSchema, request.body);
    if (body.ackSeq !== undefined) await acknowledgeCommand(ctx.db, display.id, body.ackSeq);
    const [row] = await ctx.db
      .update(displays)
      .set({
        lastSeenAt: ctx.now(),
        lastIp: ipOf(request),
        version: body.version,
        resolution: body.resolution ?? null,
      })
      .where(eq(displays.id, display.id))
      .returning({ command: displays.command, commandSeq: displays.commandSeq });
    if (!row) throw unauthorized();
    const answer: DisplayHeartbeatResponse = { command: row.command, commandSeq: row.commandSeq };
    const opened = await store.open(request.log);
    if (opened) {
      await opened.file.close();
      if (displayUpdateWanted(body.version, opened.release.version))
        answer.update = { version: opened.release.version, sha256: opened.release.sha256, size: opened.bytes };
    }
    return answer;
  });

  /** The `.deb` on offer (the device checks its sha256 against the heartbeat before installing it). */
  app.get('/api/displays/update', device, async (request, reply) => {
    const opened = await store.open(request.log);
    if (!opened) throw notPublished();
    const { release, file, bytes } = opened;
    request.log.info(
      { displayId: request.display?.id, version: release.version },
      'aggiornamento del player scaricato',
    );
    return reply
      .header('content-type', 'application/vnd.debian.binary-package')
      .header('content-disposition', `attachment; filename="arenalive-player-${release.version}.deb"`)
      .header('content-length', String(bytes))
      .header('cache-control', 'no-store')
      .send(file.createReadStream({ autoClose: true }));
  });

  /** 429 for an IP with too many wrong tokens; 503 when the live sockets are at their limit; 404 without client. */
  const admit = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = ipOf(request);
    const wait = ctx.displayFailures.blockedFor(ip);
    if (wait > 0) {
      void reply.header('retry-after', String(Math.ceil(wait / 1000)));
      throw tooManyRequests();
    }
    const open = ctx.hub.publicSockets(ip);
    if (open.total >= ctx.socketLimits.total || open.fromIp >= ctx.socketLimits.perIp) {
      void reply.header('retry-after', String(SERVER_FULL_RETRY_AFTER_S));
      throw serverFull();
    }
    if (!(await hostTenant(ctx, request))) throw notFound();
  };

  // The browser does not apply CORS to WebSocket: a foreign Origin is refused here (CSWSH).
  const sameOrigin = sameOriginGuard(ctx);

  /**
   * Page `/schermo` of a player: the first message is `{type:'auth', token}` (the token stays in the fragment of the
   * page, never in a URL); then the socket is a live socket of what the player shows (`standby` for nothing), moved
   * by the admin, closed with 4404 when the player is revoked or its token replaced. Wrong tokens count for the IP.
   */
  app.get(
    '/ws/display',
    { websocket: true, config: perMinute(ctx.rateLimits.displayWs), preValidation: admit, preHandler: sameOrigin },
    (socket: WebSocket, request) => {
      const ip = ipOf(request);
      const log = request.log;
      const timer = setTimeout(() => socket.close(DISPLAY_CLOSE_NO_AUTH), DISPLAY_AUTH_TIMEOUT_MS);
      socket.on('close', () => clearTimeout(timer));
      socket.once('message', (data: Buffer, isBinary: boolean) => {
        clearTimeout(timer);
        let value: unknown = null;
        try {
          if (!isBinary) value = JSON.parse(data.toString('utf8'));
        } catch {
          value = null;
        }
        const auth = DisplayAuthMessageSchema.safeParse(value);
        if (!auth.success) {
          ctx.displayFailures.fail(ip);
          socket.close(DISPLAY_CLOSE_NO_AUTH);
          return;
        }
        void (async () => {
          const tenant = await hostTenant(ctx, request);
          const row = tenant ? await findDisplay(ctx, hashToken(auth.data.token), tenant.id) : null;
          if (row && socket.readyState !== socket.OPEN) return;
          if (!row) {
            ctx.displayFailures.fail(ip);
            socket.close(DISPLAY_CLOSE_INVALID);
            return;
          }
          const hash = hashToken(auth.data.token);
          attachLiveSocket(
            ctx,
            {
              socket,
              target: hubTargetOf(row),
              grant: { kind: 'display', displayId: row.id },
              expiresAt: null,
              encoding: encodingOf(request.query),
              ip,
            },
            log,
          );
          socket.on('message', (next: Buffer, binary: boolean) => {
            if (binary) return;
            let message: unknown;
            try {
              message = JSON.parse(next.toString('utf8'));
            } catch {
              return;
            }
            const ack = DisplayAckMessageSchema.safeParse(message);
            if (!ack.success) return;
            acknowledgeCommand(ctx.db, row.id, ack.data.commandSeq).catch((err: unknown) =>
              log.error({ err }, 'conferma del comando non salvata'),
            );
          });
          // A new download (or a revocation) between the lookup and the attach closed the sockets of the player before
          // this one was in the hub: the token is read again now that it is.
          const fresh = await findDisplay(ctx, hash, row.tenantId);
          if (!fresh) {
            socket.close(DISPLAY_CLOSE_INVALID);
            return;
          }
          // A change of target in the same moment did not reach this socket either.
          if (JSON.stringify(hubTargetOf(fresh)) !== JSON.stringify(hubTargetOf(row))) showDisplay(ctx, fresh, log);
        })().catch((err: unknown) => {
          log.error({ err }, 'autenticazione del player non riuscita');
          socket.close(1011);
        });
      });
    },
  );
}
