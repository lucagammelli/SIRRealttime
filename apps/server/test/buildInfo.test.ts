import { describe, expect, it } from 'vitest';
import { buildInfo, parseBuildInfo } from '../src/buildInfo.js';

describe('parseBuildInfo', () => {
  it('reads version and commit', () => {
    expect(parseBuildInfo('{"version":"1.0.0","commit":"85952d0"}')).toEqual({ version: '1.0.0', commit: '85952d0' });
  });
  it('reads a package.json (version only) and drops a commit that is not hexadecimal', () => {
    expect(parseBuildInfo('{"name":"x","version":"1.2.3"}')).toEqual({ version: '1.2.3' });
    expect(parseBuildInfo('{"version":"1.2.3","commit":"locale"}')).toEqual({ version: '1.2.3' });
  });
  it('returns null for invalid input', () => {
    for (const text of ['', 'nope', '[]', 'null', '{}', '{"version":"1.0"}', '{"version":1}']) {
      expect(parseBuildInfo(text)).toBeNull();
    }
  });
});

describe('buildInfo', () => {
  it('finds the version of the root package.json when run from the sources', () => {
    expect(buildInfo().version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(buildInfo().version).not.toBe('0.0.0');
  });
});
