import type { SimulationResponse } from '@arenalive/shared';
import {
  SIMULATION_UPLOAD_MAX_BASE64_LENGTH,
  SimulationCommandParamSchema,
  StartSimulationRequestSchema,
} from '@arenalive/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import type { SimulationService } from '../simulation/service.js';
import { dvwTooLarge } from '../simulation/source.js';
import { adminTenantId } from '../tenancy.js';

/** Body of the start: the base64 of an uploaded `.dvw` plus the JSON around it. */
const START_BODY_LIMIT = SIMULATION_UPLOAD_MAX_BASE64_LENGTH + 64 * 1024;

/** Only the length of the uploaded text, read before the full validation (too long a text is a 413). */
const RawUploadSchema = z.object({ source: z.object({ kind: z.literal('upload'), data: z.string() }) });

/**
 * «Simulazione» (`/admin/simulazione`): the simulation of a match of the client of the session, for an admin (the
 * superadmin on the client chosen; a viewer gets 403), with the rate limit of the admin routes.
 * `GET` the simulation and the teams of the club, `POST` starts it, `POST /:command` pause, resume, stop, restart, `DELETE`
 * deletes match and link.
 */
export function simulationRoutes(app: FastifyInstance, ctx: AppContext, simulations: SimulationService): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  app.get('/api/admin/simulation', admin, async (request): Promise<SimulationResponse> =>
    simulations.describe(adminTenantId(request)),
  );

  // Up to ~2.8 MB of body: session and role are checked before it is read (preParsing, after the rate limit and the
  // Origin check of the scope), so a request without a valid admin session never makes the server read it.
  const adminBeforeBody = requireRole(ctx, 'admin');
  app.post(
    '/api/admin/simulation',
    {
      config: admin.config,
      bodyLimit: START_BODY_LIMIT,
      preParsing: async (request, reply, payload) => {
        await adminBeforeBody.call(app, request, reply);
        return payload;
      },
    },
    async (request, reply): Promise<SimulationResponse> => {
      const tenantId = adminTenantId(request);
      const raw = RawUploadSchema.safeParse(request.body);
      if (raw.success && raw.data.source.data.length > SIMULATION_UPLOAD_MAX_BASE64_LENGTH) throw dvwTooLarge();
      const body = validate(StartSimulationRequestSchema, request.body);
      const response = await simulations.start(tenantId, body);
      void reply.code(201);
      return response;
    },
  );

  app.post('/api/admin/simulation/:command', admin, async (request): Promise<SimulationResponse> => {
    const { command } = validate(SimulationCommandParamSchema, request.params);
    return simulations.command(adminTenantId(request), command);
  });

  app.delete('/api/admin/simulation', admin, async (request, reply) => {
    await simulations.remove(adminTenantId(request));
    return reply.code(204).send();
  });
}
