import { describe, expect, it } from 'vitest';
import { midMatchState } from '../test/fixtures.ts';
import { loadSampleMatch } from './sampleMatch.ts';

describe('example match of the editor', () => {
  it('is the synthetic match of today (run `pnpm --filter @arenalive/web sample-match` when this fails)', async () => {
    expect(await loadSampleMatch()).toEqual(midMatchState());
  });
});
