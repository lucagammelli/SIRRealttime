import { createHash } from 'node:crypto';
import type {
  AssetFileMime,
  AssetKind,
  AssetListResponse,
  AssetSummary,
  BrandingImageSlot,
  BrandingResponse,
  IntermissionsResponse,
  LayoutResponse,
  OverlaysResponse,
  PublicTenantResponse,
  TenantBranding,
} from '@arenalive/shared';
import {
  ASSET_MAX_BASE64_LENGTH,
  ASSET_MAX_BYTES,
  ASSET_NAME_MAX,
  AssetNameSchema,
  FILE_NAME_HEADER,
  adminAssetPath,
  AssetFileMimeSchema,
  isVideoMime,
  overlayBackgrounds,
  VIDEO_MAX_BYTES,
  VIDEO_UPLOAD_PATH,
  VideoUploadQuerySchema,
  BRANDING_IMAGE_SLOTS,
  IdParamSchema,
  intermissionImageIds,
  intermissionSponsorIds,
  isCustomTemplate,
  layoutImageIds,
  layoutSponsorIds,
  publicAssetPath,
  resolveBranding,
  resolveIntermissions,
  resolveLayout,
  resolveOverlays,
  TenantBrandingSchema,
  TenantIntermissionsSchema,
  TenantLayoutSchema,
  TenantOverlaysSchema,
  UpdateAssetRequestSchema,
  UploadAssetRequestSchema,
} from '@arenalive/shared';
import { desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readAssetFile, removeAssetFile, writeAssetFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, clientFixtures, tenants } from '../db/index.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { ImageRejected, inspectImage } from '../lib/images.js';
import { validate } from '../lib/validate.js';
import { inspectVideo, VideoRejected } from '../lib/videos.js';
import { BINARY_BODY, checkRole, requireBinaryBody, requireRole } from '../security.js';
import { playersUsingAsset, publicPlayerMedia } from '../roster.js';
import { publicSponsors, requireOwnSponsors, requireSponsorRoom } from '../sponsors.js';
import {
  adminTenantId,
  findTenant,
  tenantConfigChanged,
  hostTenant,
  tenantDisplayName,
  tenantScope,
} from '../tenancy.js';

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
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** The graphics of a client change rarely and the server cache lasts 30 s as well. */
const TENANT_CACHE = 'public, max-age=30';
/** File of an image for the reserved area: same id = same file, but only in the cache of the browser of the user. */
const PRIVATE_IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';
/** An SVG opened directly (not through <img>) runs nothing and loads nothing. */
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const RawDataSchema = z.object({ data: z.string() });
const tooLarge = (): HttpError => new HttpError(413, 'TOO_LARGE', 'Immagine troppo grande (massimo 2 MB)');
const imageRejected = (message: string): HttpError => new HttpError(422, 'IMAGE_REJECTED', message);
const videoTooLarge = (): HttpError =>
  new HttpError(413, 'TOO_LARGE', `Video troppo grande (massimo ${VIDEO_MAX_BYTES / (1024 * 1024)} MB)`);
const videoRejected = (message: string): HttpError => new HttpError(422, 'VIDEO_REJECTED', message);

const FileNameHeaderSchema = z
  .string()
  .max(ASSET_NAME_MAX * 12)
  .optional();

/**
 * The name of an uploaded video from its header (`encodeURIComponent` of the name): null when missing, 400 when it
 * cannot be decoded or is not a valid name (AssetNameSchema).
 */
export function uploadedFileName(header: unknown): string | null {
  const raw = validate(FileNameHeaderSchema, header);
  if (raw === undefined || raw === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw badRequest('Richiesta non valida: nome del file');
  }
  const parsed = AssetNameSchema.safeParse(decoded);
  if (!parsed.success) throw badRequest('Richiesta non valida: nome del file');
  return parsed.data;
}

export const assetSummary = (a: AssetRow): AssetSummary => ({
  id: a.id,
  kind: a.kind,
  mime: AssetFileMimeSchema.parse(a.mime),
  width: a.width,
  height: a.height,
  bytes: a.bytes,
  sha256: a.sha256,
  createdAt: a.createdAt.toISOString(),
  url: adminAssetPath(a.id),
  sponsorId: a.sponsorId,
  name: a.name,
});

/** Lock of the images and of the graphics of a client (uploads, deletions, branding, profile of the club). */
export const lockClientAssets = (tx: Tx, tenantId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(${ASSET_LOCK_KEY}, hashtext(${tenantId}))`);

async function usedBytes(tx: Tx | AppContext['db'], tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${assets.bytes}), 0)::integer` })
    .from(assets)
    .where(tenantScope(assets, tenantId));
  return Number(row?.total ?? 0);
}

/**
 * Under the lock of the client: stores an inspected image (file named after its sha256, row of `assets`); the same
 * file of the same kind again returns the row already stored. 409 when the quota of the client would be exceeded.
 */
export async function storeAsset(
  ctx: AppContext,
  tx: Tx,
  tenantId: string,
  kind: AssetKind,
  data: Buffer,
  info: { mime: AssetFileMime; width: number; height: number },
  name: string | null = null,
): Promise<{ row: AssetRow; created: boolean }> {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const [existing] = await tx
    .select()
    .from(assets)
    .where(tenantScope(assets, tenantId, eq(assets.sha256, sha256), eq(assets.kind, kind)))
    .limit(1);
  if (existing) {
    // The same file again: it keeps its name; one uploaded before the names takes the one of now.
    if (existing.name !== null || name === null) return { row: existing, created: false };
    const [named] = await tx
      .update(assets)
      .set({ name })
      .where(tenantScope(assets, tenantId, eq(assets.id, existing.id)))
      .returning();
    return { row: named ?? existing, created: false };
  }
  if ((await usedBytes(tx, tenantId)) + data.length > ctx.config.assetsQuotaBytes) {
    const mb = Math.round(ctx.config.assetsQuotaBytes / (1024 * 1024));
    throw conflict(`Spazio per i file esaurito (${mb} MB): elimina quelli che non usi`);
  }
  await writeAssetFile(ctx.config.assetsDir, tenantId, sha256, data);
  const [inserted] = await tx
    .insert(assets)
    .values({
      tenantId,
      kind,
      sha256,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: data.length,
      name,
    })
    .returning();
  if (!inserted) throw new Error('asset not inserted');
  return { row: inserted, created: true };
}

const SLOTS = Object.keys(BRANDING_IMAGE_SLOTS) as BrandingImageSlot[];

/** Under the lock of the client: every image of `ids` is an image (not a video) of this client (400 otherwise). */
async function requireOwnImages(tx: Tx, tenantId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: assets.id, mime: assets.mime })
    .from(assets)
    .where(tenantScope(assets, tenantId, inArray(assets.id, ids)));
  if (rows.length !== ids.length || rows.some((r) => isVideoMime(r.mime)))
    throw badRequest('Richiesta non valida: immagine non trovata');
}

/**
 * Under the lock of the client: every background of the overlays is a file of this client uploaded for the overlays
 * (kind `overlay`), an image for `image` and a video for `video` (400 otherwise).
 */
async function requireOwnBackgrounds(tx: Tx, tenantId: string, list: { kind: string; assetId: string }[]) {
  if (list.length === 0) return;
  const ids = [...new Set(list.map((b) => b.assetId))];
  const rows = await tx
    .select({ id: assets.id, kind: assets.kind, mime: assets.mime })
    .from(assets)
    .where(tenantScope(assets, tenantId, inArray(assets.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const background of list) {
    const row = byId.get(background.assetId);
    if (!row || row.kind !== 'overlay') throw badRequest('Richiesta non valida: sfondo dell’avviso non trovato');
    if (isVideoMime(row.mime) !== (background.kind === 'video'))
      throw badRequest('Richiesta non valida: il tipo dello sfondo non corrisponde al file');
  }
}

/**
 * Under the lock of the client: an image (of kind `sponsor`) becomes one of the images of a sponsor of the client. 409
 * when it already belongs to another sponsor or the sponsor has SPONSOR_IMAGES_MAX images.
 */
async function giveToSponsor(tx: Tx, tenantId: string, row: AssetRow, sponsorId: string): Promise<AssetRow> {
  if (row.sponsorId !== null && row.sponsorId !== sponsorId)
    throw conflict('Questa immagine è già di un altro sponsor: toglila da quello prima');
  await requireSponsorRoom(tx, tenantId, sponsorId);
  const [updated] = await tx
    .update(assets)
    .set({ sponsorId })
    .where(tenantScope(assets, tenantId, eq(assets.id, row.id)))
    .returning();
  if (!updated) throw notFound();
  return updated;
}

/**
 * Under the lock of the client: why an image cannot be deleted (used by the branding, a sponsor block, a sponsor
 * slide or a match of the calendar), as the text of the 409; null when nothing uses it.
 */
export async function assetUse(tx: Tx, tenantId: string, id: string): Promise<string | null> {
  const [tenant] = await tx
    .select({
      branding: tenants.branding,
      layout: tenants.layout,
      intermissions: tenants.intermissions,
      overlays: tenants.overlays,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (brandingIds(resolveBranding(tenant?.branding)).includes(id))
    return 'Immagine in uso nella grafica: toglila prima di eliminarla';
  if (layoutImageIds(resolveLayout(tenant?.layout)).includes(id))
    return 'Immagine in uso nella pagina pubblica: toglila dal blocco sponsor prima di eliminarla';
  if (intermissionImageIds(resolveIntermissions(tenant?.intermissions)).includes(id))
    return 'Immagine in uso nelle pause: toglila dalla diapositiva sponsor o da «Dopo la partita» prima di eliminarla';
  if (overlayBackgrounds(resolveOverlays(tenant?.overlays)).some((b) => b.assetId === id))
    return 'File in uso come sfondo di un avviso: toglilo dall’avviso prima di eliminarlo';
  const [player] = await playersUsingAsset(tx, tenantId, id);
  if (player)
    return `File in uso da ${player.lastName} ${player.firstName} della rosa: toglilo da «Foto e video» del giocatore prima di eliminarlo`;
  const [fixture] = await tx
    .select({ id: clientFixtures.id })
    .from(clientFixtures)
    .where(
      tenantScope(
        clientFixtures,
        tenantId,
        or(eq(clientFixtures.ourLogoAssetId, id), eq(clientFixtures.opponentLogoAssetId, id)),
      ),
    )
    .limit(1);
  return fixture ? 'Immagine in uso come logo di una partita del calendario: toglila prima di eliminarla' : null;
}

/** Under the lock of the client: deletes the row of an image; the file goes when no other row of the client uses it. */
export async function deleteAssetRow(ctx: AppContext, tx: Tx, row: AssetRow): Promise<void> {
  await tx.delete(assets).where(tenantScope(assets, row.tenantId, eq(assets.id, row.id)));
  const [twin] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(tenantScope(assets, row.tenantId, eq(assets.sha256, row.sha256), ne(assets.id, row.id)))
    .limit(1);
  // Still under the lock: an upload of the same file waits and writes it again.
  if (!twin) await removeAssetFile(ctx.config.assetsDir, row.tenantId, row.sha256);
}

/** Images used by a branding. */
const brandingIds = (branding: TenantBranding): string[] =>
  SLOTS.map((slot) => branding[slot]).filter((id): id is string => id !== null);

/**
 * Sends the file of an image of the client `tenantId` (404 for an image of another client or a missing file). Type
 * from the database (recognized from the bytes at upload), never sniffed; SVG with a CSP that blocks scripts and loads.
 */
async function sendAsset(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  id: string,
  cache: string,
): Promise<FastifyReply> {
  const [row] = await ctx.db
    .select()
    .from(assets)
    .where(tenantScope(assets, tenantId, eq(assets.id, id)))
    .limit(1);
  const mime = row ? AssetFileMimeSchema.safeParse(row.mime) : null;
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
    .header('cache-control', cache)
    .header('accept-ranges', 'bytes');
  if (mime.data === 'image/svg+xml') void reply.header('content-security-policy', SVG_CSP);
  // A part of the file (Safari asks the videos this way, a byte range at a time).
  const range = byteRange(request.headers.range, file.length);
  if (range === 'invalid') return reply.code(416).header('content-range', `bytes */${file.length}`).send();
  if (range)
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${file.length}`)
      .send(file.subarray(range.start, range.end + 1));
  return reply.send(file);
}

/**
 * Pure: the one byte range of a `Range` header (`bytes=a-b`, `bytes=a-`, `bytes=-n`) within a file of `length` bytes,
 * ends included; null without a header or with one not understood (the whole file is sent), `invalid` when it does
 * not fit the file (416).
 */
export function byteRange(
  header: string | undefined,
  length: number,
): { start: number; end: number } | null | 'invalid' {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const [, from = '', to = ''] = match;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0 || length === 0) return 'invalid';
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(from);
  const end = to === '' ? length - 1 : Math.min(Number(to), length - 1);
  if (start >= length || end < start) return 'invalid';
  return { start, end };
}

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
    // A device never saved by the client: the default page of its template.
    const layout = resolveLayout(tenant.layout, branding.template);
    const intermissions = resolveIntermissions(tenant.intermissions);
    const chosen = [...new Set([...layoutSponsorIds(layout), ...intermissionSponsorIds(intermissions)])];
    const sponsorList = await publicSponsors(ctx.db, tenant.id, chosen);
    void reply.header('cache-control', TENANT_CACHE);
    return {
      name: tenantDisplayName(tenant, branding),
      branding,
      images: {
        logoMain: branding.logoMain ? publicAssetPath(branding.logoMain) : null,
        logoMark: branding.logoMark ? publicAssetPath(branding.logoMark) : null,
        sponsorLogo: branding.sponsorLogo ? publicAssetPath(branding.sponsorLogo) : null,
      },
      layout,
      intermissions,
      overlays: resolveOverlays(tenant.overlays),
      sponsors: sponsorList,
      players: await publicPlayerMedia(ctx.db, tenant.id),
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
    return sendAsset(ctx, request, reply, tenant.id, params.data.id, IMMUTABLE_CACHE);
  });
}

/** Branding and images of the client of the session (admin; a superadmin works on its active client). */
export function brandingAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };
  // Reading for every user of the client (`viewer` included), changes only for `admin`.
  const viewer = { config: admin.config, preHandler: requireRole(ctx, 'viewer') };

  const brandingOf = async (tenantId: string): Promise<BrandingResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, branding: resolveBranding(tenant.branding) };
  };

  app.get('/api/admin/branding', viewer, async (request): Promise<BrandingResponse> =>
    brandingOf(adminTenantId(request)),
  );

  /** Replaces the branding; every image must be of this client and of the kind of its slot. */
  app.put('/api/admin/branding', admin, async (request): Promise<BrandingResponse> => {
    const tenantId = adminTenantId(request);
    const branding = validate(TenantBrandingSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      // A custom theme is assigned by the superadmin: a client can only keep the one it already has.
      if (isCustomTemplate(branding.template) && request.user?.role !== 'superadmin') {
        const [current] = await tx.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, tenantId));
        if (resolveBranding(current?.branding).template !== branding.template) throw forbidden();
      }
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
    tenantConfigChanged(ctx, tenantId);
    request.log.info({ tenantId, userId: request.user?.id }, 'grafica del cliente salvata');
    return brandingOf(tenantId);
  });

  const layoutOf = async (tenantId: string): Promise<LayoutResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, layout: resolveLayout(tenant.layout, resolveBranding(tenant.branding).template) };
  };

  app.get('/api/admin/layout', viewer, async (request): Promise<LayoutResponse> => layoutOf(adminTenantId(request)));

  /**
   * Replaces the layout of the public page (closed list of block types, options checked by the shared schema); every
   * image and every sponsor of the blocks must be of this client.
   */
  app.put('/api/admin/layout', admin, async (request): Promise<LayoutResponse> => {
    const tenantId = adminTenantId(request);
    const layout = validate(TenantLayoutSchema, request.body);
    const images = layoutImageIds(layout);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      await requireOwnImages(tx, tenantId, images);
      await requireOwnSponsors(tx, tenantId, layoutSponsorIds(layout));
      const updated = await tx
        .update(tenants)
        .set({ layout })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) throw notFound();
    });
    tenantConfigChanged(ctx, tenantId);
    request.log.info({ tenantId, userId: request.user?.id }, 'pagina pubblica del cliente salvata');
    return layoutOf(tenantId);
  });

  const intermissionsOf = async (tenantId: string): Promise<IntermissionsResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, intermissions: resolveIntermissions(tenant.intermissions) };
  };

  app.get('/api/admin/intermissions', viewer, async (request): Promise<IntermissionsResponse> =>
    intermissionsOf(adminTenantId(request)),
  );

  /**
   * Replaces the pauses of the public page (closed list of slide types, options, durations and delays checked by the
   * shared schema); every image and sponsor of the sponsor slides must be of this client.
   */
  app.put('/api/admin/intermissions', admin, async (request): Promise<IntermissionsResponse> => {
    const tenantId = adminTenantId(request);
    const intermissions = validate(TenantIntermissionsSchema, request.body);
    const images = intermissionImageIds(intermissions);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      await requireOwnImages(tx, tenantId, images);
      await requireOwnSponsors(tx, tenantId, intermissionSponsorIds(intermissions));
      const updated = await tx
        .update(tenants)
        .set({ intermissions })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) throw notFound();
    });
    tenantConfigChanged(ctx, tenantId);
    request.log.info({ tenantId, userId: request.user?.id }, 'pause della pagina pubblica salvate');
    return intermissionsOf(tenantId);
  });

  const overlaysOf = async (tenantId: string): Promise<OverlaysResponse> => {
    const tenant = await findTenant(ctx, { id: tenantId });
    if (!tenant) throw notFound();
    return { tenantName: tenant.name, overlays: resolveOverlays(tenant.overlays) };
  };

  app.get('/api/admin/overlays', viewer, async (request): Promise<OverlaysResponse> =>
    overlaysOf(adminTenantId(request)),
  );

  /**
   * Replaces the overlays of the events of the match (closed list of events and placeholders, durations, devices and
   * priorities checked by the shared schema); every background is a file of this client for the overlays, of the
   * kind declared (image or video).
   */
  app.put('/api/admin/overlays', admin, async (request): Promise<OverlaysResponse> => {
    const tenantId = adminTenantId(request);
    const overlays = validate(TenantOverlaysSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      await requireOwnBackgrounds(tx, tenantId, overlayBackgrounds(overlays));
      const updated = await tx
        .update(tenants)
        .set({ overlays })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
      if (updated.length === 0) throw notFound();
    });
    tenantConfigChanged(ctx, tenantId);
    request.log.info({ tenantId, userId: request.user?.id }, 'avvisi della pagina pubblica salvati');
    return overlaysOf(tenantId);
  });

  /**
   * File of an image of the client of the session (thumbnails and previews of the reserved area): unlike
   * `/api/public/assets/:id` it does not depend on the hostname, which in the reserved area may belong to another
   * client (an IP address resolved to the default client, a superadmin on another client).
   */
  app.get('/api/admin/assets/:id/file', viewer, async (request, reply) => {
    const { id } = validate(IdParamSchema, request.params);
    return sendAsset(ctx, request, reply, adminTenantId(request), id, PRIVATE_IMMUTABLE_CACHE);
  });

  app.get('/api/admin/assets', viewer, async (request): Promise<AssetListResponse> => {
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
   * sha256; the same file again returns the image already stored (200). With `sponsorId` (a sponsor of the client)
   * the image becomes one of its images (409 when it has SPONSOR_IMAGES_MAX, or when the same file is already an image
   * of another sponsor).
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
      const sponsorId = body.sponsorId;
      if (sponsorId !== undefined && body.kind !== 'sponsor') throw badRequest('Richiesta non valida: sponsorId');
      const { row, created } = await ctx.db.transaction(async (tx) => {
        await lockClientAssets(tx, tenantId);
        const name = body.name ?? null;
        if (sponsorId === undefined) return storeAsset(ctx, tx, tenantId, body.kind, data, info, name);
        await requireOwnSponsors(tx, tenantId, [sponsorId]);
        const stored = await storeAsset(ctx, tx, tenantId, body.kind, data, info, name);
        if (stored.row.sponsorId === sponsorId) return stored;
        return { ...stored, row: await giveToSponsor(tx, tenantId, stored.row, sponsorId) };
      });
      if (created) request.log.info({ assetId: row.id, mime: row.mime, bytes: row.bytes }, 'immagine caricata');
      void reply.code(created ? 201 : 200);
      return assetSummary(row);
    },
  );

  // The body of the upload of a video: its bytes as they are (only the route with BINARY_BODY accepts this type).
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body),
  );
  const adminBeforeBody = checkRole(ctx, 'admin');

  /**
   * Upload of a video for the backgrounds of the overlays, or for the players of the roster with `?kind=player`
   * (VideoUploadQuerySchema): the bytes of the file as the body
   * (`application/octet-stream`), type recognized from the bytes (MP4 with an ISO brand or WebM, anything else 422),
   * at most VIDEO_MAX_BYTES (413, checked before reading when the length is declared), within the quota of the client
   * (409). Session and role are checked before the body is read. Same file again: the video already stored (200).
   * The name of the file comes in the header FILE_NAME_HEADER (encoded, AssetNameSchema: 400 when not valid).
   */
  app.post(
    VIDEO_UPLOAD_PATH,
    {
      config: { ...admin.config, ...BINARY_BODY },
      bodyLimit: VIDEO_MAX_BYTES,
      preParsing: async (request, _reply, payload) => {
        await adminBeforeBody(request);
        requireBinaryBody(request);
        // A use not valid is refused before the bytes are read.
        validate(VideoUploadQuerySchema, request.query);
        if (Number(request.headers['content-length']) > VIDEO_MAX_BYTES) throw videoTooLarge();
        return payload;
      },
    },
    async (request, reply): Promise<AssetSummary> => {
      const tenantId = adminTenantId(request);
      const { kind } = validate(VideoUploadQuerySchema, request.query);
      const name = uploadedFileName(request.headers[FILE_NAME_HEADER]);
      const data = request.body;
      if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest('Richiesta non valida: nessun file');
      if (data.length > VIDEO_MAX_BYTES) throw videoTooLarge();
      let info;
      try {
        info = inspectVideo(data);
      } catch (err) {
        if (err instanceof VideoRejected) {
          request.log.info({ reason: err.message }, 'video rifiutato');
          throw videoRejected(err.message);
        }
        throw err;
      }
      const { row, created } = await ctx.db.transaction(async (tx) => {
        await lockClientAssets(tx, tenantId);
        return storeAsset(ctx, tx, tenantId, kind, data, info, name);
      });
      if (created) request.log.info({ assetId: row.id, mime: row.mime, bytes: row.bytes }, 'video caricato');
      void reply.code(created ? 201 : 200);
      return assetSummary(row);
    },
  );

  /**
   * Gives a sponsor image to a sponsor of the client (409 when it has SPONSOR_IMAGES_MAX), or takes it away (null);
   * renames a file (`name`, null: no name). A logo never belongs to a sponsor (400).
   */
  app.patch('/api/admin/assets/:id', admin, async (request): Promise<AssetSummary> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(UpdateAssetRequestSchema, request.body);
    const row = await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const [found] = await tx
        .select()
        .from(assets)
        .where(tenantScope(assets, tenantId, eq(assets.id, id)))
        .limit(1);
      if (!found) throw notFound();
      let current = found;
      if (body.name !== undefined && body.name !== current.name) {
        const [renamed] = await tx
          .update(assets)
          .set({ name: body.name })
          .where(tenantScope(assets, tenantId, eq(assets.id, id)))
          .returning();
        current = renamed ?? current;
      }
      if (body.sponsorId === undefined) return current;
      if (body.sponsorId === null) {
        const [updated] = await tx
          .update(assets)
          .set({ sponsorId: null })
          .where(tenantScope(assets, tenantId, eq(assets.id, id)))
          .returning();
        return updated ?? current;
      }
      if (current.kind !== 'sponsor') throw badRequest('Solo le immagini sponsor si assegnano a uno sponsor');
      if (current.sponsorId === body.sponsorId) return current;
      await requireOwnSponsors(tx, tenantId, [body.sponsorId]);
      return giveToSponsor(tx, tenantId, { ...current, sponsorId: null }, body.sponsorId);
    });
    if (body.name !== undefined) request.log.info({ assetId: id, userId: request.user?.id }, 'file rinominato');
    if (body.sponsorId !== undefined)
      request.log.info(
        { assetId: id, sponsorId: row.sponsorId, userId: request.user?.id },
        'sponsor dell’immagine cambiato',
      );
    return assetSummary(row);
  });

  /**
   * Deletes an image not used by the branding, the blocks or the pauses of the public page (409 otherwise); the file goes when
   * no other row of the client uses it.
   */
  app.delete('/api/admin/assets/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const [row] = await tx
        .select()
        .from(assets)
        .where(tenantScope(assets, tenantId, eq(assets.id, id)))
        .limit(1);
      if (!row) throw notFound();
      const inUse = await assetUse(tx, tenantId, id);
      if (inUse) throw conflict(inUse);
      await deleteAssetRow(ctx, tx, row);
    });
    request.log.info({ assetId: id }, 'immagine eliminata');
    return reply.code(204).send();
  });
}
