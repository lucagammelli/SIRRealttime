import type { TenantBranding, TenantRef } from '@arenalive/shared';
import { DEFAULT_BRAND_NAME, DEFAULT_TENANT_SLUG, isValidHostname, TENANT_REQUIRED_MESSAGE } from '@arenalive/shared';
import type { SQL } from 'drizzle-orm';
import { and, arrayContains, eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from './context.js';
import { tenants } from './db/index.js';
import { HttpError } from './lib/errors.js';
import { refreshMatchLogos } from './state.js';

/** Client as needed by the routes (hostname resolution, Origin check, links). */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  hostnames: string[];
  /** Stored branding document (read it with `resolveBranding` of `@arenalive/shared`). */
  branding: Record<string, unknown>;
  /** Stored layout of the public page (read it with `resolveLayout` of `@arenalive/shared`). */
  layout: Record<string, unknown>;
  /** Stored pauses of the public page (read it with `resolveIntermissions` of `@arenalive/shared`). */
  intermissions: Record<string, unknown>;
  /** Stored overlays of the events of the match (read it with `resolveOverlays` of `@arenalive/shared`). */
  overlays: Record<string, unknown>;
  /** Stored profile of the club (read it with `resolveClubProfile` of `@arenalive/shared`). */
  clubProfile: Record<string, unknown>;
  /** «Link e QR per singola partita» (links of the matches of the calendar and «partita fissa»). */
  matchLinksEnabled: boolean;
}

/** Key of the transaction lock that serializes the writes of the clients (hostnames unique among all of them). */
const TENANT_LOCK_KEY = 0x53495254;

/**
 * Takes the lock of the clients until the end of the transaction: their changes (`routes/tenants.ts`) and what depends
 * on an option of a client (a link «partita fissa» against «Link e QR per singola partita» switched off). Lock order:
 * this one, then the one of the matches of a client (`lockTenantMatches`).
 */
export async function lockTenants(tx: { execute: (query: SQL) => Promise<unknown> }): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${TENANT_LOCK_KEY})`);
}

const TENANT_COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  hostnames: tenants.hostnames,
  branding: tenants.branding,
  layout: tenants.layout,
  intermissions: tenants.intermissions,
  overlays: tenants.overlays,
  clubProfile: tenants.clubProfile,
  matchLinksEnabled: tenants.matchLinksEnabled,
};

/**
 * Pure: hostname of a `Host` header (lower case, without port and trailing dot); null when missing or not valid
 * (IPv6 literals included: they never match a client).
 */
export function hostnameFromHeader(host: string | undefined): string | null {
  if (host === undefined) return null;
  let name = host.trim().toLowerCase();
  if (name.startsWith('[')) return null;
  const colon = name.lastIndexOf(':');
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(name.slice(colon + 1))) return null;
    name = name.slice(0, colon);
  }
  if (name.endsWith('.')) name = name.slice(0, -1);
  return isValidHostname(name) ? name : null;
}

/** Client with exactly this hostname, or the client of `slug`; null if none. */
export async function findTenant(
  ctx: AppContext,
  by: { hostname: string } | { slug: string } | { id: string },
): Promise<Tenant | null> {
  const where =
    'hostname' in by
      ? arrayContains(tenants.hostnames, [by.hostname])
      : 'slug' in by
        ? eq(tenants.slug, by.slug)
        : eq(tenants.id, by.id);
  const [row] = await ctx.db.select(TENANT_COLUMNS).from(tenants).where(where).limit(1);
  return row ?? null;
}

const resolved = new WeakMap<FastifyRequest, Promise<Tenant | null>>();

/**
 * Client of the request hostname (looked up once per request, cached 30 s): the client that lists the hostname, otherwise the
 * one of DEFAULT_TENANT_SLUG, otherwise null. The hostname is the `Host` header as forwarded by nginx
 * (`proxy_set_header Host $host`); `X-Forwarded-Host` is never read, so a client cannot choose it through the proxy.
 */
export function hostTenant(ctx: AppContext, request: FastifyRequest): Promise<Tenant | null> {
  let pending = resolved.get(request);
  if (!pending) {
    pending = resolveHost(ctx, hostnameFromHeader(request.headers.host));
    resolved.set(request, pending);
  }
  return pending;
}

/** Client of a hostname, cached 30 s (`forgetTenants` empties the cache when a client is created or changed). */
async function resolveHost(ctx: AppContext, hostname: string | null): Promise<Tenant | null> {
  const key = hostname ?? '';
  const cached = ctx.caches.hosts.get(key);
  if (cached !== undefined) return cached;
  const known = hostname ? await findTenant(ctx, { hostname }) : null;
  const slug = ctx.config.defaultTenantSlug;
  const tenant = known ?? (slug ? await findTenant(ctx, { slug }) : null);
  ctx.caches.hosts.set(key, tenant);
  return tenant;
}

/**
 * True when `hostname` (already normalized: lower case, no port) is listed by a client. Same lookup and cache as
 * `hostTenant` (an unknown hostname resolves to the default client, which does not list it).
 */
export async function isTenantHostname(ctx: AppContext, hostname: string): Promise<boolean> {
  const tenant = await resolveHost(ctx, hostname);
  return tenant?.hostnames.includes(hostname) ?? false;
}

/**
 * Empties the hostname cache: a new or changed client may take a hostname that resolved to another one, and a saved
 * branding or layout must reach the public pages at once.
 */
export function forgetTenants(ctx: AppContext): void {
  ctx.caches.hosts.clear();
  // Logos of the matches: the square logo and «nostra squadra» are in the branding.
  ctx.caches.logos.clear();
}

/**
 * The graphics of the client `tenantId` (branding, page, pauses, overlays, sponsors, profile) were saved: empties the
 * caches (`forgetTenants`) and sends `config` to the open pages of that client only, which read them again at once;
 * then, in the background, the logos of the matches on screen are chosen again (`refreshMatchLogos`: an error is
 * logged, the save stays good).
 */
export function tenantConfigChanged(ctx: AppContext, tenantId: string): void {
  forgetTenants(ctx);
  ctx.hub.notifyConfig(tenantId);
  void refreshMatchLogos(ctx, tenantId).catch((err: unknown) =>
    ctx.log?.error({ err, tenantId }, 'loghi delle partite non aggiornati'),
  );
}

/**
 * The one filter by client of every query on a table with `tenant_id`: `tenant_id = tenantId AND ...conditions`.
 * Rows of other clients are never read, changed or deleted, whatever id the request carries.
 */
export function tenantScope(
  table: { tenantId: AnyPgColumn },
  tenantId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(eq(table.tenantId, tenantId), ...conditions) ?? sql`false`;
}

/**
 * Client of an admin route (set by `requireRole`): the client of the user, or the client a superadmin has entered.
 * 409 TENANT_REQUIRED for a superadmin who has not entered a client (never the client of the hostname).
 */
export function adminTenantId(request: FastifyRequest): string {
  if (request.adminTenantId) return request.adminTenantId;
  throw new HttpError(409, 'TENANT_REQUIRED', TENANT_REQUIRED_MESSAGE);
}

export async function tenantRef(ctx: AppContext, id: string | null): Promise<TenantRef | null> {
  if (!id) return null;
  const tenant = await findTenant(ctx, { id });
  return tenant
    ? { id: tenant.id, slug: tenant.slug, name: tenant.name, matchLinksEnabled: tenant.matchLinksEnabled }
    : null;
}

/**
 * Pure: base URL of the public links of a client. PUBLIC_BASE_URL when its hostname belongs to the client (or the
 * client has no hostnames); otherwise the first hostname of the client, with scheme and port of PUBLIC_BASE_URL.
 */
export function publicBaseUrlFor(publicBaseUrl: string, hostnames: readonly string[]): string {
  const base = new URL(publicBaseUrl);
  const first = hostnames[0];
  if (first === undefined || hostnames.includes(base.hostname.toLowerCase())) return publicBaseUrl;
  base.hostname = first;
  return base.toString().replace(/\/+$/, '');
}

/** Pure: name shown for a client: display name of its branding, otherwise its name (the portal name for the default client). */
export function tenantDisplayName(tenant: Pick<Tenant, 'slug' | 'name'>, branding: TenantBranding): string {
  return branding.displayName ?? (tenant.slug === DEFAULT_TENANT_SLUG ? DEFAULT_BRAND_NAME : tenant.name);
}
