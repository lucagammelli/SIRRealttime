import { z } from 'zod';
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

/** Version of the configuration documents of a client (branding, layout, intermissions, overlays). */
export const TENANT_CONFIG_VERSION = 1;

/**
 * Configuration document of a client stored as jsonb (`{}` by default): versioned, strict (unknown keys rejected).
 * Version 1 is still empty; the next jobs add their fields here, raising the version when the shape changes.
 */
const versionedConfig = () =>
  z.strictObject({ version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION) });

export const TenantBrandingSchema = versionedConfig();
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;
export const TenantLayoutSchema = versionedConfig();
export type TenantLayout = z.infer<typeof TenantLayoutSchema>;
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
