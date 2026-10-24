export { generateMatch, DEFAULT_START_TIME, DEFAULT_HOME_NAME, DEFAULT_AWAY_NAME } from './generate.js';
export { DEFAULT_PROFILE, PROFILE_LIMITS, resolveProfile } from './profile.js';
export { renderDvw, scoutLineText } from './render.js';
export type { RenderOptions } from './render.js';
export { applyCorrection } from './correction.js';
export { play, playGapMs } from './play.js';
export type { PlayOptions } from './play.js';
export { Rng } from './rng.js';
export type * from './types.js';
export {
  AVERAGE_GAP_SECONDS,
  MAX_REAL_GAP_SECONDS,
  MIN_SPEED_BREAK_SECONDS,
  matchSeconds,
  planPlayback,
  timeSeconds,
} from './schedule.js';
export type { PlaybackLine, PlaybackOptions, PlaybackPace, PlaybackPlan, PlaybackSet } from './schedule.js';
