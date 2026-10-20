import { z } from 'zod';
import { AssetIdSchema } from './assets.js';
import { BRAND_COLOR_KEYS, HexColorSchema } from './colors.js';
import { InvitableUserSchema, InviteDeliverySchema } from './credentials.js';
import { TENANT_CONFIG_VERSION } from './configVersion.js';
import { TenantIntermissionsSchema } from './intermissions.js';
import { TenantLayoutSchema } from './layout.js';
import { OurTeamSchema } from './ourTeam.js';
import { TenantOverlaysSchema } from './overlays.js';
import { plainText } from './strings.js';
import { DEFAULT_TEMPLATE, TemplateIdSchema } from './templates.js';

/** Agents of a new client (`tenants.agent_quota`). */
export const DEFAULT_AGENT_QUOTA = 1;
/** Most agents a superadmin can give to one client. */
export const AGENT_QUOTA_MAX = 100;
export const AgentQuotaSchema = z.number().int().min(0).max(AGENT_QUOTA_MAX);

/**
 * Pure: a stored quota brought within [0, AGENT_QUOTA_MAX] (a value out of range, as the 378 left by the migration
 * 0007, reads as the nearest bound, so the list of the clients stays readable); not a number: DEFAULT_AGENT_QUOTA.
 */
export function clampAgentQuota(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_AGENT_QUOTA;
  return Math.min(AGENT_QUOTA_MAX, Math.max(0, Math.trunc(n)));
}

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

/** Colours chosen by the client: each one optional (missing: the portal default, see `resolveBrandColors`). */
export const BrandColorsSchema = z.strictObject(
  Object.fromEntries(BRAND_COLOR_KEYS.map((k) => [k, HexColorSchema.optional()])) as Record<
    (typeof BRAND_COLOR_KEYS)[number],
    z.ZodOptional<typeof HexColorSchema>
  >,
);

/**
 * Graphics of a client (jsonb `tenants.branding`): graphic template (base look, see templates.ts), optional display
 * name (otherwise the client name), colours over the template, the team of the client in the `.dvw` files and images
 * (ids of `assets` of the same client, checked by the server). Every field has a default, so the empty document of
 * the database reads as the portal defaults.
 */
export const TenantBrandingSchema = z.strictObject({
  version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION),
  template: TemplateIdSchema.default(DEFAULT_TEMPLATE),
  displayName: plainText(100).nullable().default(null),
  colors: BrandColorsSchema.default({}),
  /** Team of the client («nostra squadra»): our colour when it is on court, whatever its side in the file. */
  ourTeam: OurTeamSchema.prefault({}),
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
  /** Pauses of the public page (missing in an older answer: the defaults). */
  intermissions: TenantIntermissionsSchema.prefault({}),
  /** Overlays of the events of the match (missing in an older answer: the defaults). */
  overlays: TenantOverlaysSchema.prefault({}),
});
export type PublicTenantResponse = z.infer<typeof PublicTenantResponseSchema>;

/** `GET/PUT /api/admin/branding`: the branding of the client of the session (the body of PUT is the branding). */
export const BrandingResponseSchema = z.object({ tenantName: z.string(), branding: TenantBrandingSchema });
export type BrandingResponse = z.infer<typeof BrandingResponseSchema>;
/** Short reference to a client (current client of the session in `MeResponse`). */
export const TenantRefSchema = z.object({
  id: z.uuid(),
  slug: TenantSlugSchema,
  name: z.string(),
  /**
   * «Link e QR per singola partita» (only the superadmin changes it): links of the matches of the calendar and «partita
   * fissa». Off (missing in an older answer): only the channel of the club with its QR.
   */
  matchLinksEnabled: z.boolean().default(false),
});
export type TenantRef = z.infer<typeof TenantRefSchema>;

/** Client as seen by the superadmin (`/api/admin/tenants`). */
export const TenantSummarySchema = TenantRefSchema.extend({
  hostnames: z.array(z.string()),
  createdAt: z.iso.datetime(),
  /** Most agents of the client (missing in an older answer: the default). */
  agentQuota: AgentQuotaSchema.default(DEFAULT_AGENT_QUOTA),
  /** Users of the client, disabled ones included (missing in an older answer: 0). */
  userCount: z.number().int().min(0).default(0),
});
export type TenantSummary = z.infer<typeof TenantSummarySchema>;

export const CreateTenantRequestSchema = z.object({
  slug: TenantSlugSchema,
  name: plainText(100),
  hostnames: HostnamesSchema,
  agentQuota: AgentQuotaSchema.default(DEFAULT_AGENT_QUOTA),
  /** First user of the client, created with the role `admin` in the same transaction (optional). */
  firstUser: InvitableUserSchema.optional(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

/** Answer of the creation of a client: with an invited first user (no password) also the delivery of the invitation. */
export const CreateTenantResponseSchema = TenantSummarySchema.extend({
  firstUserInvite: InviteDeliverySchema.nullable().default(null),
});
export type CreateTenantResponse = z.infer<typeof CreateTenantResponseSchema>;

/** The slug never changes (DEFAULT_TENANT_SLUG refers to it); at least one field. */
export const UpdateTenantRequestSchema = z
  .object({
    name: plainText(100).optional(),
    hostnames: HostnamesSchema.optional(),
    agentQuota: AgentQuotaSchema.optional(),
    /** Off: the links of single matches of the client are revoked for good; on again: new links are created. */
    matchLinksEnabled: z.boolean().optional(),
  })
  .refine(
    (r) =>
      r.name !== undefined ||
      r.hostnames !== undefined ||
      r.agentQuota !== undefined ||
      r.matchLinksEnabled !== undefined,
    { message: 'nessun campo da modificare' },
  );
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;

/**
 * Client on which a superadmin works (`POST /api/admin/active-tenant`): an id enters that client, null leaves it
 * (back to the pages of the superadmin, with no client: never the client of the hostname).
 */
export const SetActiveTenantRequestSchema = z.object({ tenantId: z.uuid().nullable() });
export type SetActiveTenantRequest = z.infer<typeof SetActiveTenantRequestSchema>;

/** Error (403 MATCH_LINKS_DISABLED) of a link of one match asked for a client without «Link e QR per singola partita». */
export const MATCH_LINKS_DISABLED_MESSAGE = 'Link per singola partita non attivi: usa il canale del club';

/** Error (409 TENANT_REQUIRED) of every route with data of a client called by a superadmin with no client chosen. */
export const TENANT_REQUIRED_MESSAGE = 'Scegli prima un cliente';
