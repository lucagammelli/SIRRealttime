import type { WebManifest } from '@sir/shared';
import { AssetMimeSchema, publicAssetPath, resolveBranding, webManifest } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets } from '../db/index.js';
import { hostTenant, tenantDisplayName, tenantScope } from '../tenancy.js';

/** The graphics of a client change rarely (same time as `GET /api/public/tenant`). */
const MANIFEST_CACHE = 'public, max-age=300';

/**
 * Manifest of the installable app of the client of the hostname (`webManifest` of `@sir/shared`): name shown, colours
 * and square logo of its graphics; without a client the one of the portal. No token: public graphics only.
 */
export function manifestRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/public/manifest.webmanifest',
    { config: perMinute(ctx.rateLimits.public) },
    async (request, reply): Promise<WebManifest> => {
      const tenant = await hostTenant(ctx, request);
      const branding = resolveBranding(tenant?.branding);
      let logo = null;
      if (tenant && branding.logoMark) {
        const [row] = await ctx.db
          .select()
          .from(assets)
          .where(tenantScope(assets, tenant.id, eq(assets.id, branding.logoMark)))
          .limit(1);
        const mime = row ? AssetMimeSchema.safeParse(row.mime) : null;
        if (row && mime?.success)
          logo = { url: publicAssetPath(row.id), mime: mime.data, width: row.width, height: row.height };
      }
      void reply
        .header('content-type', 'application/manifest+json; charset=utf-8')
        .header('cache-control', MANIFEST_CACHE);
      return webManifest({
        name: tenant ? tenantDisplayName(tenant, branding) : 'SIRRealtime',
        colors: branding.colors,
        logo,
      });
    },
  );
}
