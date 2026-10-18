import { describe, expect, it } from 'vitest';
import { formatBuildVersion, HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts version with or without commit', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', version: '1.0.0' }).success).toBe(true);
    expect(HealthResponseSchema.safeParse({ status: 'ok', version: '1.0.0', commit: '85952d0' }).success).toBe(true);
  });
  it('rejects a bad version or commit', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', version: 'v1' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({ status: 'ok', version: '1.0.0', commit: 'locale' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});

describe('formatBuildVersion', () => {
  it('adds the commit in brackets when present', () => {
    expect(formatBuildVersion('1.0.0', '85952d0')).toBe('1.0.0 (85952d0)');
    expect(formatBuildVersion('1.0.0')).toBe('1.0.0');
    expect(formatBuildVersion('1.0.0', '')).toBe('1.0.0');
  });
});
