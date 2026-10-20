import { describe, expect, it, vi } from 'vitest';
import { APP_BUILD, APP_VERSION, isOtherBuild, newBuildAvailable, versionLabel } from './version.ts';

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

describe('new build of the portal', () => {
  const file = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('isOtherBuild: only a valid file with another id; never without an id of this page', () => {
    expect(isOtherBuild({ build: 'b' }, 'a')).toBe(true);
    expect(isOtherBuild({ build: 'a' }, 'a')).toBe(false);
    expect(isOtherBuild({ build: '' }, 'a')).toBe(false);
    expect(isOtherBuild('<!doctype html>', 'a')).toBe(false);
    expect(isOtherBuild({ build: 'b' }, '')).toBe(false);
  });

  it('newBuildAvailable reads /version.json without cache; any failure is «no»', async () => {
    const other = file({ build: 'nuova' });
    expect(await newBuildAvailable(other, 'vecchia')).toBe(true);
    expect(other).toHaveBeenCalledWith('/version.json', { cache: 'no-store', credentials: 'omit' });
    expect(await newBuildAvailable(file({ build: 'vecchia' }), 'vecchia')).toBe(false);
    expect(await newBuildAvailable(file({ build: 'nuova' }, 404), 'vecchia')).toBe(false);
    expect(await newBuildAvailable(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('rete')), 'vecchia')).toBe(
      false,
    );
    const dev = file({ build: 'nuova' });
    expect(await newBuildAvailable(dev, '')).toBe(false);
    expect(dev).not.toHaveBeenCalled();
    expect(APP_BUILD).toBe('build-dei-test');
  });
});
