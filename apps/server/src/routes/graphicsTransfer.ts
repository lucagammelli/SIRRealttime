import type { GraphicsExport, GraphicsExportImage, GraphicsImportResponse } from '@sir/shared';
import {
  ASSET_MAX_BYTES,
  AssetMimeSchema,
  GRAPHICS_EXPORT_FORMAT,
  GRAPHICS_EXPORT_MAX_BASE64,
  GRAPHICS_EXPORT_MAX_IMAGES,
  GRAPHICS_EXPORT_VERSION,
  GRAPHICS_IMPORT_BODY_LIMIT,
  GraphicsExportSchema,
  graphicsImageIds,
  isCustomTemplate,
  remapGraphicsImageIds,
  resolveBranding,
  resolveIntermissions,
  resolveLayout,
  resolveOverlays,
} from '@sir/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { readAssetFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, tenants } from '../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import type { ImageInfo } from '../lib/images.js';
import { ImageRejected, inspectImage } from '../lib/images.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { adminTenantId, findTenant, forgetTenants, tenantScope } from '../tenancy.js';
import { lockClientAssets, storeAsset } from './branding.js';

const imageRejected = (message: string): HttpError => new HttpError(422, 'IMAGE_REJECTED', message);

/**
 * Clear errors for a package that is not ours or of another version, before the full validation (whose answer only
 * lists field paths).
 */
function checkEnvelope(body: unknown): void {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (record.format !== GRAPHICS_EXPORT_FORMAT)
    throw badRequest('Il file non è una configurazione grafica di SIRRealtime');
  if (record.version !== GRAPHICS_EXPORT_VERSION)
    throw badRequest('Versione della configurazione non supportata: esportala di nuovo da un portale aggiornato');
}

interface CheckedImage {
  source: GraphicsExportImage;
  data: Buffer;
  info: ImageInfo;
}

/** Every image checked as an upload is (type from the bytes, SVG strictly checked, size and measures). */
function checkImages(images: GraphicsExport['images']): CheckedImage[] {
  return images.map((source) => {
    const data = Buffer.from(source.data, 'base64');
    if (data.length > ASSET_MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Immagine troppo grande (massimo 2 MB)');
    let info: ImageInfo;
    try {
      info = inspectImage(data);
    } catch (err) {
      if (err instanceof ImageRejected) throw imageRejected(err.message);
      throw err;
    }
    if (info.mime !== source.mime)
      throw imageRejected('Il tipo dichiarato di un’immagine non corrisponde al suo contenuto');
    return { source, data, info };
  });
}

/**
 * Export / import of the whole graphics of a client (branding, page, pauses, overlays and the images they use) as one
 * versioned JSON package, to move it from a portal to another.
 */
export function graphicsTransferRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  app.get('/api/admin/branding/export', admin, async (request, reply): Promise<GraphicsExport> => {
    const tenantId = adminTenantId(request);
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    const branding = resolveBranding(tenant.branding);
    const docs = {
      branding,
      layout: resolveLayout(tenant.layout, branding.template),
      intermissions: resolveIntermissions(tenant.intermissions),
    };
    const ids = graphicsImageIds(docs);
    const rows =
      ids.length === 0
        ? []
        : await ctx.db
            .select()
            .from(assets)
            .where(tenantScope(assets, tenantId, inArray(assets.id, ids)));
    if (ids.length > GRAPHICS_EXPORT_MAX_IMAGES)
      throw conflict(
        `La grafica usa ${ids.length} immagini, ma un file ne può contenere al massimo ${GRAPHICS_EXPORT_MAX_IMAGES}: togline alcune e riprova`,
      );
    const base64Length = rows.reduce((sum, r) => sum + Math.ceil(r.bytes / 3) * 4, 0);
    if (base64Length > GRAPHICS_EXPORT_MAX_BASE64) {
      const mb = (n: number): string => (n / (1024 * 1024)).toLocaleString('it-IT', { maximumFractionDigits: 1 });
      throw conflict(
        `Le immagini usate pesano ${mb(rows.reduce((sum, r) => sum + r.bytes, 0))} MB, troppo per un solo file (massimo circa ${mb((GRAPHICS_EXPORT_MAX_BASE64 / 4) * 3)} MB): usa immagini più leggere e riprova`,
      );
    }
    const images: GraphicsExportImage[] = [];
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      const mime = row ? AssetMimeSchema.safeParse(row.mime) : null;
      const file = row ? await readAssetFile(ctx.config.assetsDir, tenantId, row.sha256) : null;
      if (!row || !mime?.success || !file)
        throw conflict('Un’immagine della grafica manca: caricala di nuovo prima di esportare');
      images.push({ id, kind: row.kind, mime: mime.data, data: file.toString('base64') });
    }
    const now = ctx.now();
    const pkg = GraphicsExportSchema.parse({
      format: GRAPHICS_EXPORT_FORMAT,
      version: GRAPHICS_EXPORT_VERSION,
      exportedAt: now.toISOString(),
      sourceName: tenant.name,
      ...docs,
      overlays: resolveOverlays(tenant.overlays),
      images,
    });
    void reply
      .header(
        'content-disposition',
        `attachment; filename="grafica-${tenant.slug}-${now.toISOString().slice(0, 10)}.json"`,
      )
      .header('cache-control', 'no-store');
    request.log.info({ tenantId, images: images.length, userId: request.user?.id }, 'grafica del cliente esportata');
    return pkg;
  });

  /**
   * Replaces branding, page, pauses and overlays with the ones of the package. Images are checked as at upload and
   * stored for this client with new ids (the same file again reuses the image already stored); one transaction, so a
   * failure leaves the graphics as they were. A custom theme only for the superadmin (or a client that already has it).
   */
  app.post(
    '/api/admin/branding/import',
    { ...admin, bodyLimit: GRAPHICS_IMPORT_BODY_LIMIT },
    async (request): Promise<GraphicsImportResponse> => {
      const tenantId = adminTenantId(request);
      checkEnvelope(request.body);
      const pkg = validate(GraphicsExportSchema, request.body);
      const checked = checkImages(pkg.images);
      const isSuperadmin = request.user?.role === 'superadmin';
      await ctx.db.transaction(async (tx) => {
        await lockClientAssets(tx, tenantId);
        if (isCustomTemplate(pkg.branding.template) && !isSuperadmin) {
          const [current] = await tx
            .select({ branding: tenants.branding })
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          if (resolveBranding(current?.branding).template !== pkg.branding.template)
            throw new HttpError(
              403,
              'FORBIDDEN',
              'Questa configurazione usa un tema personalizzato, che può essere assegnato solo dal superadmin',
            );
        }
        const map = new Map<string, string>();
        for (const image of checked) {
          const { row } = await storeAsset(ctx, tx, tenantId, image.source.kind, image.data, image.info);
          map.set(image.source.id, row.id);
        }
        const docs = remapGraphicsImageIds(
          { branding: pkg.branding, layout: pkg.layout, intermissions: pkg.intermissions },
          map,
        );
        const updated = await tx
          .update(tenants)
          .set({ ...docs, overlays: pkg.overlays })
          .where(eq(tenants.id, tenantId))
          .returning({ id: tenants.id });
        if (updated.length === 0) throw notFound();
      });
      forgetTenants(ctx);
      request.log.info(
        { tenantId, images: checked.length, userId: request.user?.id },
        'grafica del cliente importata da un pacchetto',
      );
      return { images: checked.length, template: pkg.branding.template };
    },
  );
}
