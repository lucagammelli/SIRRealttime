import { describe, expect, it } from 'vitest';
import { DEPENDS_ON, PACKAGE_NAME } from './index.js';

describe('@sir/volley-stats', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@sir/volley-stats');
  });

  it('resolves the parser workspace package', () => {
    expect(DEPENDS_ON).toEqual(['@sir/dvw-parser']);
  });
});
