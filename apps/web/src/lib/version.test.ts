import { describe, expect, it } from 'vitest';
import { APP_VERSION, versionLabel } from './version.ts';

describe('versionLabel', () => {
  it('shows the commit only when asked for and known', () => {
    expect(versionLabel('1.0.0', '85952d0', false)).toBe('SIRRealtime 1.0.0');
    expect(versionLabel('1.0.0', '85952d0', true)).toBe('SIRRealtime 1.0.0 (85952d0)');
    expect(versionLabel('1.0.0', '', true)).toBe('SIRRealtime 1.0.0');
  });
});

describe('APP_VERSION', () => {
  it('comes from the root package.json at build time', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).not.toBe('0.0.0');
  });
});
