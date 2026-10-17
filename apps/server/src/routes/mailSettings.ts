import type { MailSettings, MailTestResponse } from '@sir/shared';
import { UpdateMailSettingsRequestSchema } from '@sir/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { unauthorized } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';

/**
 * Mail server of the portal (superadmin only): the same settings for every client. The answers never carry the
 * password, only whether it is set; it is replaced by sending a new one, removed with `clearPassword`.
 */
export function mailSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const superadmin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'superadmin') };

  app.get('/api/admin/mail-settings', superadmin, (): Promise<MailSettings> => ctx.mail.settings());

  app.put('/api/admin/mail-settings', superadmin, async (request): Promise<MailSettings> => {
    const body = validate(UpdateMailSettingsRequestSchema, request.body);
    const saved = await ctx.mail.save(body);
    request.log.info(
      { by: request.user?.id, passwordSet: saved.passwordSet, security: saved.security },
      'impostazioni di posta salvate',
    );
    return saved;
  });

  /** Sends a test mail to the address of the superadmin who asks; the outcome is always a 200 with a message. */
  app.post('/api/admin/mail-settings/test', superadmin, async (request): Promise<MailTestResponse> => {
    if (!request.user) throw unauthorized();
    return ctx.mail.test(request.user.email);
  });
}
