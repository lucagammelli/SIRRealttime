import { describe, expect, it } from 'vitest';
import {
  CreateAgentRequestSchema,
  CreateShareTokenRequestSchema,
  CreateUserRequestSchema,
  LoginRequestSchema,
  containsNul,
  hasNoControlChars,
  hasNoNul,
} from './index.js';

describe('string checks', () => {
  it('detects NUL and control characters', () => {
    expect(hasNoNul('a\tb')).toBe(true);
    expect(hasNoNul('a\u0000b')).toBe(false);
    expect(hasNoControlChars('Palazzetto Perugia è ok')).toBe(true);
    for (const c of ['\u0000', '\t', '\r', '\n', '\u001f', '\u007f']) expect(hasNoControlChars(`a${c}b`)).toBe(false);
  });

  it('finds NUL anywhere in a JSON value, keys included', () => {
    expect(containsNul({ a: [1, 'x', { b: null }] })).toBe(false);
    expect(containsNul({ a: [1, { b: 'x\u0000' }] })).toBe(true);
    expect(containsNul({ ['k\u0000']: 1 })).toBe(true);
    expect(containsNul('\u0000')).toBe(true);
    expect(containsNul(undefined)).toBe(false);
  });
});

describe('external strings in the schemas', () => {
  it('rejects NUL in the login fields', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.it\u0000', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.it', password: 'x\u0000' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.it', password: 'x' }).success).toBe(true);
  });

  it('rejects control characters in names, labels and emails', () => {
    expect(CreateAgentRequestSchema.safeParse({ name: 'any\r\nSet-cookie: Tamper=1' }).success).toBe(false);
    expect(CreateAgentRequestSchema.safeParse({ name: 'PC\u007f' }).success).toBe(false);
    expect(CreateAgentRequestSchema.safeParse({ name: '  PC palestra  ' })).toMatchObject({
      success: true,
      data: { name: 'PC palestra' },
    });
    const share = { matchId: null, expiresAt: null };
    expect(CreateShareTokenRequestSchema.safeParse({ ...share, label: 'Tri\tbuna' }).success).toBe(false);
    expect(CreateShareTokenRequestSchema.safeParse({ ...share, label: 'Tribuna' }).success).toBe(true);
    const user = { password: 'password-lunga-1', role: 'viewer' };
    expect(CreateUserRequestSchema.safeParse({ ...user, email: 'a\u0000@b.it' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.it\r\n', password: 'x' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: 'a\r\n@b.it', password: 'x' }).success).toBe(false);
  });
});
