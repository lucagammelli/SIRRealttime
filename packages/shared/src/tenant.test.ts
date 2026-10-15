import { describe, expect, it } from 'vitest';
import {
  CreateTenantRequestSchema,
  CreateUserRequestSchema,
  HostnamesSchema,
  isValidHostname,
  MeResponseSchema,
  SetActiveTenantRequestSchema,
  TENANT_CONFIG_VERSION,
  TENANT_MAX_HOSTNAMES,
  TenantBrandingSchema,
  TenantIntermissionsSchema,
  TenantLayoutSchema,
  TenantOverlaysSchema,
  TenantSlugSchema,
  UpdateTenantRequestSchema,
} from './index.js';

const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

describe('hostnames', () => {
  it('accepts plain DNS names and IPv4 addresses', () => {
    for (const ok of ['localhost', 'sir.example.org', 'live-a.club.it', '192.168.1.10', 'a'.repeat(63) + '.it']) {
      expect(isValidHostname(ok)).toBe(true);
    }
  });

  it('rejects scheme, port, path, upper case, IPv6 and bad labels', () => {
    for (const bad of [
      '',
      'https://sir.it',
      'sir.it:8080',
      'sir.it/live',
      'SIR.it',
      '[::1]',
      '-sir.it',
      'sir-.it',
      'sir..it',
      'sir.it.',
      'sir_a.it',
      'a'.repeat(64) + '.it',
      `${'a'.repeat(60)}.`.repeat(5) + 'it',
    ]) {
      expect(isValidHostname(bad)).toBe(false);
    }
  });

  it('normalizes to lower case and refuses duplicates and too many entries', () => {
    expect(HostnamesSchema.parse([' Live.Sir.IT ', 'b.it'])).toEqual(['live.sir.it', 'b.it']);
    expect(HostnamesSchema.safeParse(['a.it', 'A.it']).success).toBe(false);
    expect(HostnamesSchema.safeParse(['a.it:80']).success).toBe(false);
    const many = Array.from({ length: TENANT_MAX_HOSTNAMES + 1 }, (_, i) => `h${i}.it`);
    expect(HostnamesSchema.safeParse(many).success).toBe(false);
    expect(HostnamesSchema.safeParse([]).success).toBe(true);
  });
});

describe('tenant requests', () => {
  it('checks the slug', () => {
    for (const ok of ['predefinito', 'sir-susa', 'a', 'club2'])
      expect(TenantSlugSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'Sir', 'sir_susa', '-sir', 'sir-', 'a'.repeat(51), 'sir susa']) {
      expect(TenantSlugSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('creates a client with a plain name and valid hostnames', () => {
    const body = CreateTenantRequestSchema.parse({ slug: 'sir', name: '  Sir Safety  ', hostnames: ['Live.Sir.it'] });
    expect(body).toEqual({ slug: 'sir', name: 'Sir Safety', hostnames: ['live.sir.it'] });
    expect(CreateTenantRequestSchema.safeParse({ slug: 'sir', name: 'a\nb', hostnames: [] }).success).toBe(false);
    expect(CreateTenantRequestSchema.safeParse({ slug: 'sir', name: 'Sir' }).success).toBe(false);
  });

  it('updates at least one field and never the slug', () => {
    expect(UpdateTenantRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateTenantRequestSchema.parse({ name: 'Nuovo' })).toEqual({ name: 'Nuovo' });
    expect(UpdateTenantRequestSchema.parse({ hostnames: [] })).toEqual({ hostnames: [] });
    expect(UpdateTenantRequestSchema.parse({ slug: 'altro', name: 'X' })).toEqual({ name: 'X' });
  });

  it('chooses an active client by id or null', () => {
    expect(SetActiveTenantRequestSchema.safeParse({ tenantId: ID }).success).toBe(true);
    expect(SetActiveTenantRequestSchema.safeParse({ tenantId: null }).success).toBe(true);
    expect(SetActiveTenantRequestSchema.safeParse({ tenantId: 'predefinito' }).success).toBe(false);
  });
});

describe('tenant configuration documents', () => {
  const schemas = [TenantBrandingSchema, TenantLayoutSchema, TenantIntermissionsSchema, TenantOverlaysSchema];

  it('read the empty database default as the current version', () => {
    for (const schema of schemas) expect(schema.parse({})).toEqual({ version: TENANT_CONFIG_VERSION });
  });

  it('reject unknown keys and other versions', () => {
    for (const schema of schemas) {
      expect(schema.safeParse({ version: 1, extra: true }).success).toBe(false);
      expect(schema.safeParse({ version: 2 }).success).toBe(false);
    }
  });
});

describe('users and roles', () => {
  it('never creates a superadmin from the admin area', () => {
    const base = { email: 'a@b.it', password: 'password-lunga-1' };
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'admin' }).success).toBe(true);
    expect(CreateUserRequestSchema.safeParse({ ...base, role: 'superadmin' }).success).toBe(false);
  });

  it('describes the current client of the session', () => {
    const me = { id: ID, email: 'a@b.it', role: 'superadmin' };
    expect(MeResponseSchema.safeParse({ ...me, tenant: null }).success).toBe(true);
    expect(MeResponseSchema.safeParse({ ...me, tenant: { id: ID, slug: 'sir', name: 'Sir' } }).success).toBe(true);
    expect(MeResponseSchema.safeParse(me).success).toBe(false);
  });
});
