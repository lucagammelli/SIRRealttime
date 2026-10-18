import { z } from 'zod';
import { AssetIdSchema, AssetKindSchema, AssetMimeSchema, ASSET_MAX_BASE64_LENGTH } from './assets.js';
import { allIntermissions, intermissionImageIds, TenantIntermissionsSchema } from './intermissions.js';
import { LAYOUT_DEVICES, layoutImageIds, TenantLayoutSchema } from './layout.js';
import { TenantOverlaysSchema } from './overlays.js';
import { BRANDING_IMAGE_SLOTS, TenantBrandingSchema } from './tenant.js';

/** Value of `format` of an export package of the graphics. */
export const GRAPHICS_EXPORT_FORMAT = 'sirrealtime-grafica';
/** Version of the package layout; a package of another version is refused (never guessed). */
export const GRAPHICS_EXPORT_VERSION = 1;
/** Most images of a package: logos, plus the sponsor images of the page and of every pause. */
export const GRAPHICS_EXPORT_MAX_IMAGES = 30;
/** Body limit of the import: the images in base64 plus the documents (a package is a few MB at most). */
export const GRAPHICS_IMPORT_BODY_LIMIT = 24 * 1024 * 1024;
/** Most base64 characters of all the images of a package: the body limit minus room for the documents. */
export const GRAPHICS_EXPORT_MAX_BASE64 = GRAPHICS_IMPORT_BODY_LIMIT - 1024 * 1024;

/** An image of the package: original id (only to link the documents), kind, declared type and bytes as base64. */
export const GraphicsExportImageSchema = z.strictObject({
  id: AssetIdSchema,
  kind: AssetKindSchema,
  mime: AssetMimeSchema,
  data: z.base64().min(4).max(ASSET_MAX_BASE64_LENGTH),
});
export type GraphicsExportImage = z.infer<typeof GraphicsExportImageSchema>;

/** Pure: ids of every image the four documents of a package refer to (each once). */
export function graphicsImageIds(docs: {
  branding: z.output<typeof TenantBrandingSchema>;
  layout: z.output<typeof TenantLayoutSchema>;
  intermissions: z.output<typeof TenantIntermissionsSchema>;
}): string[] {
  const ids = new Set<string>();
  for (const slot of Object.keys(BRANDING_IMAGE_SLOTS) as (keyof typeof BRANDING_IMAGE_SLOTS)[]) {
    const id = docs.branding[slot];
    if (id !== null) ids.add(id);
  }
  for (const id of layoutImageIds(docs.layout)) ids.add(id);
  for (const id of intermissionImageIds(docs.intermissions)) ids.add(id);
  return [...ids];
}

/**
 * Pure: copy of branding, layout and pauses with every image id replaced through `map` (ids of the package to ids of
 * the client). An id missing from `map` is an error: the documents never keep an id of another client.
 */
export function remapGraphicsImageIds<
  T extends {
    branding: z.output<typeof TenantBrandingSchema>;
    layout: z.output<typeof TenantLayoutSchema>;
    intermissions: z.output<typeof TenantIntermissionsSchema>;
  },
>(docs: T, map: ReadonlyMap<string, string>): T {
  const to = (id: string): string => {
    const mapped = map.get(id);
    if (mapped === undefined) throw new Error('image id not in the map');
    return mapped;
  };
  const out = structuredClone(docs);
  for (const slot of Object.keys(BRANDING_IMAGE_SLOTS) as (keyof typeof BRANDING_IMAGE_SLOTS)[]) {
    const id = out.branding[slot];
    if (id !== null) out.branding[slot] = to(id);
  }
  for (const device of LAYOUT_DEVICES)
    for (const block of out.layout[device])
      if (block.type === 'sponsor') block.options.images = block.options.images.map(to);
  for (const pause of allIntermissions(out.intermissions))
    for (const slide of pause.slides) if (slide.type === 'sponsor') slide.options.images = slide.options.images.map(to);
  return out;
}

/**
 * Export package of the graphics of a client («Esporta / Importa configurazione»): branding, page layout, pauses and
 * overlays with the images they use. Nothing of matches, users, agents, links or hostnames.
 */
export const GraphicsExportSchema = z
  .strictObject({
    format: z.literal(GRAPHICS_EXPORT_FORMAT),
    version: z.literal(GRAPHICS_EXPORT_VERSION),
    exportedAt: z.iso.datetime(),
    /** Name of the client the package comes from (informative). */
    sourceName: z.string().trim().min(1).max(200),
    branding: TenantBrandingSchema,
    layout: TenantLayoutSchema,
    intermissions: TenantIntermissionsSchema,
    overlays: TenantOverlaysSchema,
    images: z.array(GraphicsExportImageSchema).max(GRAPHICS_EXPORT_MAX_IMAGES),
  })
  .superRefine((pkg, ctx) => {
    const have = new Map(pkg.images.map((i) => [i.id, i]));
    if (have.size !== pkg.images.length) ctx.addIssue({ code: 'custom', path: ['images'], message: 'id ripetuto' });
    const used = graphicsImageIds(pkg);
    for (const id of used)
      if (!have.has(id)) ctx.addIssue({ code: 'custom', path: ['images'], message: 'immagine usata ma mancante' });
    for (const slot of Object.keys(BRANDING_IMAGE_SLOTS) as (keyof typeof BRANDING_IMAGE_SLOTS)[]) {
      const id = pkg.branding[slot];
      if (id !== null && have.get(id) && have.get(id)?.kind !== BRANDING_IMAGE_SLOTS[slot])
        ctx.addIssue({ code: 'custom', path: ['branding', slot], message: 'tipo di immagine non adatto' });
    }
    const usedSet = new Set(used);
    if (pkg.images.some((i) => !usedSet.has(i.id)))
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'immagine non usata' });
  });
export type GraphicsExport = z.output<typeof GraphicsExportSchema>;

/** `POST /api/admin/branding/import`: what was imported. */
export const GraphicsImportResponseSchema = z.object({
  images: z.number().int().nonnegative(),
  template: z.string(),
});
export type GraphicsImportResponse = z.infer<typeof GraphicsImportResponseSchema>;
