import { HelloMessageSchema } from '@sir/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { helloText, makeHello, newVisitId, visitSource } from './visit.ts';

afterEach(() => vi.unstubAllGlobals());

describe('visit', () => {
  it('makes a random id valid for the server, different every time, and stores nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const ids = new Set(Array.from({ length: 20 }, newVisitId));
    expect(ids.size).toBe(20);
    for (const id of ids)
      expect(
        HelloMessageSchema.safeParse({ type: 'hello', visit: id, device: 'tv', source: 'qr', app: false }).success,
      ).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  it('tells the QR (?q=1) from every other way', () => {
    expect(visitSource('?q=1')).toBe('qr');
    expect(visitSource('?tv=1&q=1')).toBe('qr');
    expect(visitSource('')).toBe('link');
    expect(visitSource('?q=0')).toBe('link');
    expect(visitSource('?q=yes')).toBe('link');
  });

  it('builds a hello the server schema accepts, with device and app read when it is sent', () => {
    const text = helloText('a'.repeat(32), 'tablet', '?q=1', true);
    expect(HelloMessageSchema.parse(JSON.parse(text))).toEqual({
      type: 'hello',
      visit: 'a'.repeat(32),
      device: 'tablet',
      source: 'qr',
      app: true,
    });
    let device: 'tv' | 'phone' = 'phone';
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone') }));
    const hello = makeHello('b'.repeat(32), () => device, '');
    expect(JSON.parse(hello())).toMatchObject({ device: 'phone', source: 'link', app: true });
    device = 'tv';
    expect(JSON.parse(hello())).toMatchObject({ device: 'tv' });
  });
});
