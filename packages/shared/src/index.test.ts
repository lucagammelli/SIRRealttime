import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@sir/shared', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@sir/shared');
  });
});
