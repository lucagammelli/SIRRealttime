import { describe, expect, it } from 'vitest';
import {
  CreateShareTokenRequestSchema,
  CreateUserRequestSchema,
  LoginRequestSchema,
  ServerMessageSchema,
  ShareTokenParamSchema,
} from './index.js';

const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

describe('ServerMessageSchema', () => {
  it('accepts the three message types', () => {
    expect(ServerMessageSchema.safeParse({ type: 'state', matchId: ID, version: 1, state: { sets: [] } }).success).toBe(
      true,
    );
    expect(ServerMessageSchema.safeParse({ type: 'noMatch' }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'error', message: 'x' }).success).toBe(true);
  });
  it('rejects unknown types and missing state', () => {
    expect(ServerMessageSchema.safeParse({ type: 'hello' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'state', matchId: ID, version: 1, state: null }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'state', matchId: 'x', version: 1, state: {} }).success).toBe(false);
  });
});

describe('admin schemas', () => {
  it('validates the login body', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.it', password: 'x' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.it' }).success).toBe(false);
  });
  it('normalizes the email of a new user and requires a long password', () => {
    const ok = CreateUserRequestSchema.parse({ email: 'Luca@Example.IT', password: 'x'.repeat(12), role: 'viewer' });
    expect(ok.email).toBe('luca@example.it');
    expect(CreateUserRequestSchema.safeParse({ email: 'a@b.it', password: 'short', role: 'viewer' }).success).toBe(
      false,
    );
    expect(CreateUserRequestSchema.safeParse({ email: 'a@b.it', password: 'x'.repeat(12), role: 'root' }).success).toBe(
      false,
    );
  });
  it('validates share token requests and parameters', () => {
    expect(CreateShareTokenRequestSchema.safeParse({ label: 'Tribuna', matchId: null, expiresAt: null }).success).toBe(
      true,
    );
    expect(
      CreateShareTokenRequestSchema.safeParse({ label: 'x', matchId: ID, expiresAt: '2026-01-01T00:00:00Z' }).success,
    ).toBe(true);
    expect(CreateShareTokenRequestSchema.safeParse({ label: '', matchId: null, expiresAt: null }).success).toBe(false);
    expect(ShareTokenParamSchema.safeParse({ token: 'A'.repeat(43) }).success).toBe(true);
    expect(ShareTokenParamSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(ShareTokenParamSchema.safeParse({ token: `${'A'.repeat(40)}/..` }).success).toBe(false);
  });
});
