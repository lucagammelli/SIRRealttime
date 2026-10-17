import type { TenantSummary } from '@sir/shared';
import { describe, expect, it } from 'vitest';
import { tenantForBase } from './tenant.js';

const tenant = (slug: string, hostnames: string[]): TenantSummary => ({
  id: `${slug.length}f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c`,
  slug,
  name: slug,
  hostnames,
  createdAt: '2026-10-01T10:00:00.000Z',
  agentQuota: 1,
  userCount: 1,
});

describe('tenantForBase', () => {
  it('enters the client of the hostname, otherwise the default one, otherwise none', () => {
    const list = [tenant('predefinito', []), tenant('sir', ['live.sir.test'])];
    expect(tenantForBase(list, 'https://LIVE.sir.test:8443')?.slug).toBe('sir');
    expect(tenantForBase(list, 'http://127.0.0.1:8090')?.slug).toBe('predefinito');
    expect(tenantForBase([tenant('altro', ['x.test'])], 'http://127.0.0.1:8090')).toBeNull();
  });
});
