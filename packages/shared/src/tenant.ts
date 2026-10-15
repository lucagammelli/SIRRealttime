import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { BRAND_COLOR_KEYS, HexColorSchema } from './colors.js';
import { TENANT_CONFIG_VERSION } from './configVersion.js';
import { TenantLayoutSchema } from './layout.js';
import { plainText } from './strings.js';

/** Slug of the client always present (created by the migration and by the seed). */
export const DEFAULT_TENANT_SLUG = 'predefinito';

/** Slug of a client: lower case letters, digits and inner dashes, 1-50 characters. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
export const TenantSlugSchema = z.string().regex(TENANT_SLUG_PATTERN);

/** Most hostnames of one client. */
export const TENANT_MAX_HOSTNAMES = 20;

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Pure: true for a lower case DNS name (or IPv4 address) without scheme, port, path or trailing dot:
 * labels of 1-63 characters `[a-z0-9-]` not starting or ending with a dash, 253 characters at most.
 */
export function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;
  return hostname.split('.').every((label) => HOSTNAME_LABEL.test(label));
}

/** Hostname typed by the admin: trimmed, lower case, then checked with `isValidHostname`. */
export const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidHostname, { message: 'hostname non valido (solo nome, senza schema né porta)' });

/** Hostnames of one client: each valid, no duplicates, at most TENANT_MAX_HOSTNAMES. */
export const HostnamesSchema = z
  .array(HostnameSchema)
  .max(TENANT_MAX_HOSTNAMES)
  .refine((list) => new Set(list).size === list.length, { message: 'hostname ripetuto' });

export { TENANT_CONFIG_VERSION };

/**
 * Configuration document of a client stored as jsonb (`{}` by default): versioned, strict (unknown keys rejected).
 * Version 1 of intermissions and overlays is still empty; the next jobs add their fields here, raising the version
 * when the shape changes. The layout has its own schema (layout.ts).
 */
const versionedConfig = () =>
  z.strictObject({ version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION) });

/** Colours chosen by the client: each one optional (missing: the portal default, see `resolveBrandColors`). */
export const BrandColorsSchema = z.strictObject(
  Object.fromEntries(BRAND_COLOR_KEYS.map((k) => [k, HexColorSchema.optional()])) as Record<
    (typeof BRAND_COLOR_KEYS)[number],
    z.ZodOptional<typeof HexColorSchema>
  >,
);

/**
 * Graphics of a client (jsonb `tenants.branding`): optional display name (otherwise the client name), colours and
 * images (ids of `assets` of the same client, checked by the server). Every field has a default, so the empty
 * document of the database reads as the portal defaults.
 */
export const TenantBrandingSchema = z.strictObject({
  version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION),
  displayName: plainText(100).nullable().default(null),
  colors: BrandColorsSchema.default({}),
  /** Horizontal logo (header). */
  logoMain: AssetIdSchema.nullable().default(null),
  /** Square logo (favicon, small spaces). */
  logoMark: AssetIdSchema.nullable().default(null),
  sponsorLogo: AssetIdSchema.nullable().default(null),
});
export type TenantBranding = z.output<typeof TenantBrandingSchema>;
export type TenantBrandingInput = z.input<typeof TenantBrandingSchema>;

/** Image slots of the branding and the kind of asset each one takes. */
export const BRANDING_IMAGE_SLOTS = { logoMain: 'logo', logoMark: 'logo', sponsorLogo: 'sponsor' } as const;
export type BrandingImageSlot = keyof typeof BRANDING_IMAGE_SLOTS;

/** Pure: the branding of the defaults (nothing chosen). */
export function defaultBranding(): TenantBranding {
  return TenantBrandingSchema.parse({});
}

/** Pure: a stored branding document with the missing fields filled; an invalid one reads as the defaults. */
export function resolveBranding(document: unknown): TenantBranding {
  const parsed = TenantBrandingSchema.safeParse(document ?? {});
  return parsed.success ? parsed.data : defaultBranding();
}

/** Path of the public file of an asset (served for the client of the hostname). */
export const publicAssetPath = (id: string): string => `/api/public/assets/${id}`;

/** Name shown for the default client without a display name (and when no graphics are loaded). */
export const DEFAULT_BRAND_NAME = 'SIRRealtime';

/** `GET /api/public/tenant`: graphics of the client of the hostname, for the portal before any page. */
export const PublicTenantResponseSchema = z.object({
  /** Display name (branding), otherwise name of the client (DEFAULT_BRAND_NAME for the default client). */
  name: z.string(),
  branding: TenantBrandingSchema,
  /** Paths of the images of the branding (null: none). */
  images: z.object({
    logoMain: z.string().nullable(),
    logoMark: z.string().nullable(),
    sponsorLogo: z.string().nullable(),
  }),
  /** Blocks of the public page for every device (missing in an older answer: the defaults). */
  layout: TenantLayoutSchema.prefault({}),
});
export type PublicTenantResponse = z.infer<typeof PublicTenantResponseSchema>;

/** `GET/PUT /api/admin/branding`: the branding of the client of the session (the body of PUT is the branding). */
export const BrandingResponseSchema = z.object({ tenantName: z.string(), branding: TenantBrandingSchema });
export type BrandingResponse = z.infer<typeof BrandingResponseSchema>;
export const TenantIntermissionsSchema = versionedConfig();
export type TenantIntermissions = z.infer<typeof TenantIntermissionsSchema>;
export const TenantOverlaysSchema = versionedConfig();
export type TenantOverlays = z.infer<typeof TenantOverlaysSchema>;

/** Short reference to a client (current client of the session in `MeResponse`). */
export const TenantRefSchema = z.object({ id: z.uuid(), slug: TenantSlugSchema, name: z.string() });
export type TenantRef = z.infer<typeof TenantRefSchema>;

/** Client as seen by the superadmin (`/api/admin/tenants`). */
export const TenantSummarySchema = TenantRefSchema.extend({
  hostnames: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type TenantSummary = z.infer<typeof TenantSummarySchema>;

export const CreateTenantRequestSchema = z.object({
  slug: TenantSlugSchema,
  name: plainText(100),
  hostnames: HostnamesSchema,
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

/** The slug never changes (DEFAULT_TENANT_SLUG refers to it); at least one field. */
export const UpdateTenantRequestSchema = z
  .object({ name: plainText(100).optional(), hostnames: HostnamesSchema.optional() })
  .refine((r) => r.name !== undefined || r.hostnames !== undefined, { message: 'nessun campo da modificare' });
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;

/** Client on which a superadmin works (`POST /api/admin/active-tenant`); null: the client of the hostname. */
export const SetActiveTenantRequestSchema = z.object({ tenantId: z.uuid().nullable() });
export type SetActiveTenantRequest = z.infer<typeof SetActiveTenantRequestSchema>;
