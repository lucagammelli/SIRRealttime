import type { OnboardingStatus } from '@sir/shared';
import { eq, isNull, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { tenants } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { requireRole } from '../security.js';
import { adminTenantId } from '../tenancy.js';

/**
 * Guided first setup: whether the client has finished (or dismissed) it. The portal opens it by itself to the first
 * admin of a client with `completed: false`; the flag is the column `tenants.onboarded_at`.
 */
export function onboardingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };
  const viewer = { config: admin.config, preHandler: requireRole(ctx, 'viewer') };

  const statusOf = async (tenantId: string): Promise<OnboardingStatus> => {
    const [row] = await ctx.db
      .select({ at: tenants.onboardedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) throw notFound();
    return { completed: row.at !== null, completedAt: row.at ? row.at.toISOString() : null };
  };

  app.get('/api/admin/onboarding', viewer, async (request): Promise<OnboardingStatus> => {
    return statusOf(adminTenantId(request));
  });

  /** «Fine»: sets the flag once (a second call keeps the first time). */
  app.post('/api/admin/onboarding/complete', admin, async (request): Promise<OnboardingStatus> => {
    const tenantId = adminTenantId(request);
    await ctx.db
      .update(tenants)
      .set({ onboardedAt: ctx.now() })
      .where(and(eq(tenants.id, tenantId), isNull(tenants.onboardedAt)));
    request.log.info({ tenantId, userId: request.user?.id }, 'configurazione guidata completata');
    return statusOf(tenantId);
  });
}
