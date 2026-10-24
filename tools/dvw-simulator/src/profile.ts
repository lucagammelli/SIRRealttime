import type { MatchProfile } from './types.js';

/**
 * Limits of every field of a {@link MatchProfile} (the same as the contract of the server, `@arenalive/shared`,
 * checked by a test there). Averages per team and per set, except the two percentages.
 */
export const PROFILE_LIMITS: Readonly<Record<keyof MatchProfile, { min: number; max: number }>> = {
  homeStrength: { min: 0, max: 100 },
  variability: { min: 0, max: 100 },
  acesPerSet: { min: 0, max: 8 },
  serveErrorsPerSet: { min: 0, max: 10 },
  blocksPerSet: { min: 0, max: 8 },
  substitutionsPerSet: { min: 0, max: 6 },
  timeoutsPerSet: { min: 0, max: 2 },
};

/** Realistic averages of a men's match (per team and per set): teams on a par, average variability. */
export const DEFAULT_PROFILE: Readonly<MatchProfile> = {
  homeStrength: 50,
  variability: 50,
  acesPerSet: 1.5,
  serveErrorsPerSet: 3.5,
  blocksPerSet: 2,
  substitutionsPerSet: 2,
  timeoutsPerSet: 1.5,
};

/** Pure: the profile with the defaults for the missing fields; a value out of its limits is brought inside them. */
export function resolveProfile(partial: Partial<MatchProfile> = {}): MatchProfile {
  const out = { ...DEFAULT_PROFILE };
  for (const key of Object.keys(PROFILE_LIMITS) as (keyof MatchProfile)[]) {
    const value = partial[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const { min, max } = PROFILE_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  return out;
}
