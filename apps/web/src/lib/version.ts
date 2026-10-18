import { formatBuildVersion } from '@sir/shared';

// Replaced at build time by Vite (`define` in vite.config.ts and vitest.config.ts) with the version of the root
// package.json and the short commit (empty when unknown).
declare const __SIR_VERSION__: string | undefined;
declare const __SIR_COMMIT__: string | undefined;

/** Version of the portal, from the root package.json (`0.0.0` if the build did not set it). */
export const APP_VERSION: string = typeof __SIR_VERSION__ === 'string' ? __SIR_VERSION__ : '0.0.0';
/** Short commit of the build, or empty. */
export const APP_COMMIT: string = typeof __SIR_COMMIT__ === 'string' ? __SIR_COMMIT__ : '';

/** Pure: «SIRRealtime 1.0.0», with the commit in brackets only when asked for and known. */
export function versionLabel(version: string, commit: string, withCommit: boolean): string {
  return `SIRRealtime ${formatBuildVersion(version, withCommit ? commit : '')}`;
}
