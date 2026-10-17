import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from './messages.js';
import { HelloMessageSchema, StatsPeriodQuerySchema } from './stats.js';

const hello = { type: 'hello', visit: 'a1b2c3d4e5f6a7b8', device: 'tv', source: 'qr', app: true };

describe('hello', () => {
  it('accepts a valid hello, also as a client message, and refuses anything else', () => {
    expect(HelloMessageSchema.safeParse(hello).success).toBe(true);
    expect(ClientMessageSchema.safeParse(hello).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'resync' }).success).toBe(true);
    for (const bad of [
      { ...hello, visit: 'corto' },
      { ...hello, visit: 'a'.repeat(65) },
      { ...hello, visit: 'ha spazi ha spazi!' },
      { ...hello, device: 'desktop' },
      { ...hello, source: 'sms' },
      { ...hello, app: 'si' },
      { ...hello, ip: '1.2.3.4' },
      { type: 'hello' },
    ])
      expect(HelloMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe('period', () => {
  it('accepts days, a missing period, and refuses wrong dates, inverted or too long periods', () => {
    expect(StatsPeriodQuerySchema.safeParse({}).success).toBe(true);
    expect(StatsPeriodQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-17' }).success).toBe(true);
    for (const bad of [
      { from: '2026-02-30' },
      { from: '17/10/2026' },
      { from: '2026-10-17', to: '2026-10-01' },
      { from: '2025-01-01', to: '2026-10-01' },
      { from: '2026-10-01', other: 1 },
    ])
      expect(StatsPeriodQuerySchema.safeParse(bad).success).toBe(false);
  });
});
