import type { TenantSummary } from '@sir/shared';
import { DEFAULT_TENANT_SLUG } from '@sir/shared';

/**
 * Pure: the client a superadmin enters for the test: the one with the hostname of `base`, otherwise the default one
 * (DEFAULT_TENANT_SLUG), otherwise null.
 */
export function tenantForBase(tenants: readonly TenantSummary[], base: string): TenantSummary | null {
  const host = new URL(base).hostname.toLowerCase();
  return tenants.find((t) => t.hostnames.includes(host)) ?? tenants.find((t) => t.slug === DEFAULT_TENANT_SLUG) ?? null;
}
