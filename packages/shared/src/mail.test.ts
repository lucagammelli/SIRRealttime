import { describe, expect, it } from 'vitest';
import {
  CreateTenantRequestSchema,
  CreateUserRequestSchema,
  UpdateMailSettingsRequestSchema,
  UserSummarySchema,
} from './index.js';

const settings = {
  host: 'smtp.club.it',
  port: 587,
  security: 'starttls',
  fromName: 'Club',
  fromEmail: 'No-Reply@Club.it',
};

describe('mail settings', () => {
  it('accepts a valid body, lower-cases the sender and defaults the username', () => {
    expect(UpdateMailSettingsRequestSchema.parse(settings)).toMatchObject({
      fromEmail: 'no-reply@club.it',
      username: '',
    });
  });

  it('rejects a wrong port, security, sender and unknown fields', () => {
    for (const bad of [
      { port: 0 },
      { port: 65536 },
      { security: 'ssl' },
      { fromEmail: 'x' },
      { host: ' ' },
      { extra: 1 },
    ]) {
      expect(UpdateMailSettingsRequestSchema.safeParse({ ...settings, ...bad }).success).toBe(false);
    }
  });
});

describe('invited users', () => {
  it('lets the password out of a new user and of the first user of a client', () => {
    expect(CreateUserRequestSchema.parse({ email: 'A@B.it', role: 'viewer' })).toEqual({
      email: 'a@b.it',
      role: 'viewer',
    });
    expect(CreateUserRequestSchema.safeParse({ email: 'a@b.it', role: 'viewer', password: 'corta' }).success).toBe(
      false,
    );
    const tenant = { slug: 'club', name: 'Club', hostnames: [] };
    expect(CreateTenantRequestSchema.parse({ ...tenant, firstUser: { email: 'c@b.it' } }).firstUser).toEqual({
      email: 'c@b.it',
    });
  });

  it('reads an older user summary as with no invitation', () => {
    const old = {
      id: '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c',
      email: 'a@b.it',
      role: 'admin',
      createdAt: '2026-10-15T10:00:00.000Z',
    };
    expect(UserSummarySchema.parse(old).invite).toBeNull();
  });
});
