import { createHash } from 'node:crypto';
import type {
  AssetListResponse,
  AssetSummary,
  BrandingImageSlot,
  BrandingResponse,
  IntermissionsResponse,
  LayoutResponse,
  OverlaysResponse,
  PublicTenantResponse,
  TenantBranding,
} from '@sir/shared';
import {
  ASSET_MAX_BASE64_LENGTH,
  ASSET_MAX_BYTES,
  AssetMimeSchema,
  BRANDING_IMAGE_SLOTS,
  DEFAULT_BRAND_NAME,
  DEFAULT_TENANT_SLUG,
  IdParamSchema,
  intermissionImageIds,
  layoutImageIds,
  publicAssetPath,
  resolveBranding,
  resolveIntermissions,
  resolveLayout,
  resolveOverlays,
  TenantBrandingSchema,
  TenantIntermissionsSchema,
  TenantLayoutSchema,
  TenantOverlaysSchema,
  UploadAssetRequestSchema,
} from '@sir/shared';
import { desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readAssetFile, removeAssetFile, writeAssetFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, tenants } from '../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { ImageRejected, inspectImage } from '../lib/images.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { adminTenantId, findTenant, forgetTenants, hostTenant, tenantScope } from '../tenancy.js';

type AssetRow = typeof assets.$inferSelect;
type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

/** Body limit of the upload: the base64 text of a 2 MB image plus the rest of the JSON. */
const UPLOAD_BODY_LIMIT = ASSET_MAX_BASE64_LENGTH + 1024;
/**
 * Key of the transaction lock (with the client) that serializes uploads, deletions, branding, layout and pauses of a
 * client.
 */
const ASSET_LOCK_KEY = 0x53494153;
/** The id of an image changes when its file changes: the file can stay in any cache for a year. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** The graphics of a client change rarely and the server cache lasts 30 s as well. */
const TENANT_CACHE = 'public, max-age=30';
/** An SVG opened directly (not through <img>) runs nothing and loads nothing. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const RawDataSchema = z.object({ data: z.string() });
const tooLarge = (): HttpError => new HttpError(413, 'TOO_LARGE', 'Immagine troppo grande (massimo 2 MB)');
const imageRejected = (message: string): HttpError => new HttpError(422, 'IMAGE_REJECTED', message);

const assetSummary = (a: AssetRow): AssetSummary => ({
  id: a.id,
  kind: a.kind,
  mime: AssetMimeSchema.parse(a.mime),
  width: a.width,
  height: a.height,
  bytes: a.bytes,
  sha256: a.sha256,
  createdAt: a.createdAt.toISOString(),
  url: publicAssetPath(a.id),
});

const lockClient = (tx: Tx, tenantId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(${ASSET_LOCK_KEY}, hashtext(${tenantId}))`);

async function usedBytes(tx: Tx | AppContext['db'], tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${assets.bytes}), 0)::integer` })
    .from(assets)
    .where(tenantScope(assets, tenantId));
  return Number(row?.total ?? 0);
}

const SLOTS = Object.keys(BRANDING_IMAGE_SLOTS) as BrandingImageSlot[];

/** Under the lock of the client: every image of `ids` is of this client (400 otherwise). */
async function requireOwnImages(tx: Tx, tenantId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(tenantScope(assets, tenantId, inArray(assets.id, ids)));
  if (rows.length !== ids.length) throw badRequest('Richiesta non valida: immagine non trovata');
}

/** Images used by a branding. */
const brandingIds = (branding: TenantBranding): string[] =>
  SLOTS.map((slot) => branding[slot]).filter((id): id is string => id !== null);

/**
 * Public graphics of the client of the hostname: the branding and its images. No token: what is here is shown on
 * every page of the client (portal, login), never data of the matches.
 */
export function brandingPublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const config = perMinute(ctx.rateLimits.public);

  app.get('/api/public/tenant', { config }, async (request, reply): Promise<PublicTenantResponse> => {
    const tenant = await hostTenant(ctx, request);
    if (!tenant) throw notFound();
    const branding = resolveBranding(tenant.branding);
    void reply.header('cache-control', TENANT_CACHE);
    return {
      name: branding.displayName ?? (tenant.slug === DEFAULT_TENANT_SLUG ? DEFAULT_BRAND_NAME : tenant.name),
      branding,
      images: {
        logoMain: branding.logoMain ? publicAssetPath(branding.logoMain) : null,
        logoMark: branding.logoMark ? publicAssetPath(branding.logoMark) : null,
        sponsorLogo: branding.sponsorLogo ? publicAssetPath(branding.sponsorLogo) : null,
      },
      layout: resolveLayout(tenant.layout),
      intermissions: resolveIntermissions(tenant.intermissions),
      overlays: resolveOverlays(tenant.overlays),
    };
  });

  /**
   * File of an image of the client of the hostname (404 for an image of another client). Type from the database
   * (recognized from the bytes at upload), never sniffed; SVG with a CSP that blocks scripts and loads.
   */
  app.get('/api/public/assets/:id', { config }, async (request, reply) => {
    const params = IdParamSchema.safeParse(request.params);
    const tenant = params.success ? await hostTenant(ctx, request) : null;
    if (!params.success || !tenant) throw notFound();
    const [row] = await ctx.db
      .select()
      .from(assets)
      .where(tenantScope(assets, tenant.id, eq(assets.id, params.data.id)))
      .limit(1);
    const mime = row ? AssetMimeSchema.safeParse(row.mime) : null;
    if (!row || !mime?.success) throw notFound();
    const file = await readAssetFile(ctx.config.assetsDir, row.tenantId, row.sha256);
    if (!file) {
      request.log.warn({ assetId: row.id }, 'file di un’immagine mancante');
      throw notFound();
    }
    // SVG is text: always UTF-8 (the only encoding accepted at upload).
    void reply
      .header('content-type', mime.data === 'image/svg+xml' ? 'image/svg+xml; charset=utf-8' : mime.data)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('cache-control', IMMUTABLE);
    if (mime.data === 'image/svg+xml') void reply.header('content-security-policy', SVG_CSP);
    return reply.send(file);
  });
}

/** Branding and images of the client of the session (admin; a superadmin works on its active client). */
export function brandingAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  const brandingOf = async (tenantId: string): Promise<BrandingResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, branding: resolveBranding(tenant.branding) };
  };

  app.get('/api/admin/branding', admin, async (request): Promise<BrandingResponse> =>
    brandingOf(adminTenantId(request)),
  );

  /** Replaces the branding; every image must be of this client and of the kind of its slot. */
  app.put('/api/admin/branding', admin, async (request): Promise<BrandingResponse> => {
    const tenantId = adminTenantId(request);
    const branding = validate(TenantBrandingSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockClient(tx, tenantId);
      for (const slot of SLOTS) {
        const id = branding[slot];
        if (id === null) continue;
        const [row] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(tenantScope(assets, tenantId, eq(assets.id, id), eq(assets.kind, BRANDING_IMAGE_SLOTS[slot])))
          .limit(1);
        if (!row) throw badRequest(`Richiesta non valida: ${slot}`);
      }
      const updated = await tx
        .update(tenants)
        .set({ branding })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) throw notFound();
    });
    // The public pages read the branding through the cache of the hostnames.
    forgetTenants(ctx);
    request.log.info({ tenantId, userId: request.user?.id }, 'grafica del cliente salvata');
    return brandingOf(tenantId);
  });

  const layoutOf = async (tenantId: string): Promise<LayoutResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, layout: resolveLayout(tenant.layout) };
  };

  app.get('/api/admin/layout', admin, async (request): Promise<LayoutResponse> => layoutOf(adminTenantId(request)));

  /**
   * Replaces the layout of the public page (closed list of block types, options checked by the shared schema); every
   * image of the blocks must be of this client.
   */
  app.put('/api/admin/layout', admin, async (request): Promise<LayoutResponse> => {
    const tenantId = adminTenantId(request);
    const layout = validate(TenantLayoutSchema, request.body);
    const images = layoutImageIds(layout);
    await ctx.db.transaction(async (tx) => {
      await lockClient(tx, tenantId);
      await requireOwnImages(tx, tenantId, images);
      const updated = await tx
        .update(tenants)
        .set({ layout })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) throw notFound();
    });
    forgetTenants(ctx);
    request.log.info({ tenantId, userId: request.user?.id }, 'pagina pubblica del cliente salvata');
    return layoutOf(tenantId);
  });

  const intermissionsOf = async (tenantId: string): Promise<IntermissionsResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, intermissions: resolveIntermissions(tenant.intermissions) };
  };

  app.get('/api/admin/intermissions', admin, async (request): Promise<IntermissionsResponse> =>
    intermissionsOf(adminTenantId(request)),
  );

  /**
   * Replaces the pauses of the public page (closed list of slide types, options, durations and delays checked by the
   * shared schema); every image of the sponsor slides must be of this client.
   */
  app.put('/api/admin/intermissions', admin, async (request): Promise<IntermissionsResponse> => {
    const tenantId = adminTenantId(request);
    const intermissions = validate(TenantIntermissionsSchema, request.body);
    const images = intermissionImageIds(intermissions);
    await ctx.db.transaction(async (tx) => {
      await lockClient(tx, tenantId);
      await requireOwnImages(tx, tenantId, images);
      const updated = await tx
        .update(tenants)
        .set({ intermissions })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) throw notFound();
    });
    forgetTenants(ctx);
    request.log.info({ tenantId, userId: request.user?.id }, 'pause della pagina pubblica salvate');
    return intermissionsOf(tenantId);
  });

  const overlaysOf = async (tenantId: string): Promise<OverlaysResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, overlays: resolveOverlays(tenant.overlays) };
  };

  app.get('/api/admin/overlays', admin, async (request): Promise<OverlaysResponse> =>
    overlaysOf(adminTenantId(request)),
  );

  /**
   * Replaces the overlays of the events of the match (closed list of events and placeholders, durations, devices and
   * priorities checked by the shared schema). No images: no check of the assets.
   */
  app.put('/api/admin/overlays', admin, async (request): Promise<OverlaysResponse> => {
    const tenantId = adminTenantId(request);
    const overlays = validate(TenantOverlaysSchema, request.body);
    const updated = await ctx.db
      .update(tenants)
      .set({ overlays })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id });
    if (updated.length === 0) throw notFound();
    forgetTenants(ctx);
    request.log.info({ tenantId, userId: request.user?.id }, 'avvisi della pagina pubblica salvati');
    return overlaysOf(tenantId);
  });

  app.get('/api/admin/assets', admin, async (request): Promise<AssetListResponse> => {
    const tenantId = adminTenantId(request);
    const rows = await ctx.db
      .select()
      .from(assets)
      .where(tenantScope(assets, tenantId))
      .orderBy(desc(assets.createdAt));
    return {
      assets: rows.map(assetSummary),
      usedBytes: await usedBytes(ctx.db, tenantId),
      quotaBytes: ctx.config.assetsQuotaBytes,
    };
  });

  /**
   * Upload of an image as base64 JSON: type and size recognized from the bytes (PNG, JPEG, WebP, strictly checked
   * SVG; anything else 422), at most 2 MB (413), within the quota of the client (409). The file is named after its
   * sha256; the same file again returns the image already stored (200).
   */
  app.post(
    '/api/admin/assets',
    { ...admin, bodyLimit: UPLOAD_BODY_LIMIT },
    async (request, reply): Promise<AssetSummary> => {
      const tenantId = adminTenantId(request);
      // Too long a text is a 413 like a too large image, before the base64 check.
      const raw = RawDataSchema.safeParse(request.body);
      if (raw.success && raw.data.data.length > ASSET_MAX_BASE64_LENGTH) throw tooLarge();
      const body = validate(UploadAssetRequestSchema, request.body);
      const data = Buffer.from(body.data, 'base64');
      if (data.length > ASSET_MAX_BYTES) throw tooLarge();
      let info;
      try {
        info = inspectImage(data);
      } catch (err) {
        if (err instanceof ImageRejected) {
          request.log.info({ reason: err.message }, 'immagine rifiutata');
          throw imageRejected(err.message);
        }
        throw err;
      }
      const sha256 = createHash('sha256').update(data).digest('hex');
      const { row, created } = await ctx.db.transaction(async (tx) => {
        await lockClient(tx, tenantId);
        const [existing] = await tx
          .select()
          .from(assets)
          .where(tenantScope(assets, tenantId, eq(assets.sha256, sha256), eq(assets.kind, body.kind)))
          .limit(1);
        if (existing) return { row: existing, created: false };
        if ((await usedBytes(tx, tenantId)) + data.length > ctx.config.assetsQuotaBytes) {
          const mb = Math.round(ctx.config.assetsQuotaBytes / (1024 * 1024));
          throw conflict(`Spazio per le immagini esaurito (${mb} MB): elimina quelle che non usi`);
        }
        await writeAssetFile(ctx.config.assetsDir, tenantId, sha256, data);
        const [inserted] = await tx
          .insert(assets)
          .values({
            tenantId,
            kind: body.kind,
            sha256,
            mime: info.mime,
            width: info.width,
            height: info.height,
            bytes: data.length,
          })
          .returning();
        if (!inserted) throw new Error('asset not inserted');
        return { row: inserted, created: true };
      });
      if (created) request.log.info({ assetId: row.id, mime: row.mime, bytes: row.bytes }, 'immagine caricata');
      void reply.code(created ? 201 : 200);
      return assetSummary(row);
    },
  );

  /**
   * Deletes an image not used by the branding, the blocks or the pauses of the public page (409 otherwise); the file goes when
   * no other row of the client uses it.
   */
  app.delete('/api/admin/assets/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    await ctx.db.transaction(async (tx) => {
      await lockClient(tx, tenantId);
      const [row] = await tx
        .select()
        .from(assets)
        .where(tenantScope(assets, tenantId, eq(assets.id, id)))
        .limit(1);
      if (!row) throw notFound();
      const [tenant] = await tx
        .select({ branding: tenants.branding, layout: tenants.layout, intermissions: tenants.intermissions })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (brandingIds(resolveBranding(tenant?.branding)).includes(id))
        throw conflict('Immagine in uso nella grafica: toglila prima di eliminarla');
      if (layoutImageIds(resolveLayout(tenant?.layout)).includes(id))
        throw conflict('Immagine in uso nella pagina pubblica: toglila dal blocco sponsor prima di eliminarla');
      if (intermissionImageIds(resolveIntermissions(tenant?.intermissions)).includes(id))
        throw conflict('Immagine in uso nelle pause: toglila dalla diapositiva sponsor prima di eliminarla');
      await tx.delete(assets).where(tenantScope(assets, tenantId, eq(assets.id, id)));
      const [twin] = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(tenantScope(assets, tenantId, eq(assets.sha256, row.sha256), ne(assets.id, id)))
        .limit(1);
      // Still under the lock: an upload of the same file waits and writes it again.
      if (!twin) await removeAssetFile(ctx.config.assetsDir, tenantId, row.sha256);
    });
    request.log.info({ assetId: id }, 'immagine eliminata');
    return reply.code(204).send();
  });
}
