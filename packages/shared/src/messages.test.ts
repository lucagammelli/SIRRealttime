import { describe, expect, it } from 'vitest';
import {
  CreateShareTokenRequestSchema,
  CreateUserRequestSchema,
  LoginRequestSchema,
  MatchDetailSchema,
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
  it('accepts the config signal, without data', () => {
    expect(ServerMessageSchema.parse({ type: 'config' })).toEqual({ type: 'config' });
    // Extra fields are dropped: the signal never carries data of the client.
    expect(ServerMessageSchema.parse({ type: 'config', branding: { x: 1 } })).toEqual({ type: 'config' });
  });
  it('rejects unknown types and missing state', () => {
    expect(ServerMessageSchema.safeParse({ type: 'hello' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'state', matchId: ID, version: 1, state: null }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'state', matchId: 'x', version: 1, state: {} }).success).toBe(false);
  });
});

describe('MatchDetailSchema', () => {
  const detail = {
    id: ID,
    matchKey: 'partita-1',
    live: false,
    lineCount: 0,
    version: 0,
    homeName: null,
    awayName: null,
    setsWon: null,
    status: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    lastSeq: -1,
    contentHash: null,
    state: null,
  };
  it('accepts a match without state and one with a state', () => {
    expect(MatchDetailSchema.safeParse(detail).success).toBe(true);
    expect(MatchDetailSchema.safeParse({ ...detail, lastSeq: 3, contentHash: 'ab', state: { sets: [] } }).success).toBe(
      true,
    );
  });
  it('rejects a state that is not an object and a seq below -1', () => {
    expect(MatchDetailSchema.safeParse({ ...detail, state: [1] }).success).toBe(false);
    expect(MatchDetailSchema.safeParse({ ...detail, lastSeq: -2 }).success).toBe(false);
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
