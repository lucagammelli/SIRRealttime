import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, parseEmptyMatch } from './index.js';

describe('@sir/volley-stats', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@sir/volley-stats');
  });

  it('resolves the parser workspace package', () => {
    expect(parseEmptyMatch().scout).toEqual([]);
  });
});
