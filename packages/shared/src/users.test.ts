import { describe, expect, it } from 'vitest';
import {
  AGENT_QUOTA_MAX,
  clampAgentQuota,
  CreateTenantRequestSchema,
  CreateUserRequestSchema,
  TenantSummarySchema,
  UpdateUserRequestSchema,
  UserSummarySchema,
} from './index.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('users of a client', () => {
  it('creates a user with an email in lower case and a password of at least 12 characters', () => {
    expect(CreateUserRequestSchema.parse({ email: 'A@B.it', password: 'x'.repeat(12), role: 'viewer' })).toEqual({
      email: 'a@b.it',
      password: 'x'.repeat(12),
      role: 'viewer',
    });
    expect(CreateUserRequestSchema.safeParse({ email: 'a@b.it', password: 'corta', role: 'admin' }).success).toBe(
      false,
    );
    expect(
      CreateUserRequestSchema.safeParse({ email: 'a@b.it', password: 'x'.repeat(12), role: 'superadmin' }).success,
    ).toBe(false);
  });

  it('changes role, password or state, at least one and never the superadmin role', () => {
    expect(UpdateUserRequestSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(UpdateUserRequestSchema.parse({ disabled: true })).toEqual({ disabled: true });
    expect(UpdateUserRequestSchema.parse({ password: 'y'.repeat(12) })).toEqual({ password: 'y'.repeat(12) });
    expect(UpdateUserRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateUserRequestSchema.safeParse({ role: 'superadmin' }).success).toBe(false);
    expect(UpdateUserRequestSchema.safeParse({ password: 'corta' }).success).toBe(false);
    expect(UpdateUserRequestSchema.safeParse({ email: 'altro@b.it' }).success).toBe(false);
  });

  it('reads an older user summary as active', () => {
    const old = { id: ID, email: 'a@b.it', role: 'admin', createdAt: '2026-10-01T10:00:00.000Z' };
    expect(UserSummarySchema.parse(old).disabled).toBe(false);
  });
});

describe('clients and their users', () => {
  it('takes an optional first user with the same rules of a new user', () => {
    const base = { slug: 'sir', name: 'Sir', hostnames: [] };
    expect(CreateTenantRequestSchema.parse(base).firstUser).toBeUndefined();
    expect(
      CreateTenantRequestSchema.parse({ ...base, firstUser: { email: 'Capo@Sir.it', password: 'p'.repeat(12) } })
        .firstUser,
    ).toEqual({ email: 'capo@sir.it', password: 'p'.repeat(12) });
    expect(
      CreateTenantRequestSchema.safeParse({ ...base, firstUser: { email: 'capo@sir.it', password: 'corta' } }).success,
    ).toBe(false);
  });

  it('brings a stored quota within the limits', () => {
    expect(clampAgentQuota(378)).toBe(AGENT_QUOTA_MAX);
    expect(clampAgentQuota(-2)).toBe(0);
    expect(clampAgentQuota(3)).toBe(3);
    expect(clampAgentQuota(Number.NaN)).toBe(1);
  });

  it('counts the users of a client (0 in an older answer)', () => {
    const t = { id: ID, slug: 'sir', name: 'Sir', hostnames: [], createdAt: '2026-10-01T10:00:00.000Z' };
    expect(TenantSummarySchema.parse(t).userCount).toBe(0);
    expect(TenantSummarySchema.parse({ ...t, userCount: 4 }).userCount).toBe(4);
  });
});
