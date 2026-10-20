import { formatBuildVersion } from '@sir/shared';
import { z } from 'zod';

// Replaced at build time by Vite (`define` in vite.config.ts and vitest.config.ts) with the version of the root
// package.json and the short commit (empty when unknown).
declare const __SIR_VERSION__: string | undefined;
declare const __SIR_COMMIT__: string | undefined;
declare const __SIR_BUILD__: string | undefined;

/** Version of the portal, from the root package.json (`0.0.0` if the build did not set it). */
export const APP_VERSION: string = typeof __SIR_VERSION__ === 'string' ? __SIR_VERSION__ : '0.0.0';
/** Short commit of the build, or empty. */
export const APP_COMMIT: string = typeof __SIR_COMMIT__ === 'string' ? __SIR_COMMIT__ : '';
/** Id of this build of the portal (a new one at every `vite build`), or empty in development. */
export const APP_BUILD: string = typeof __SIR_BUILD__ === 'string' ? __SIR_BUILD__ : '';

/** `/version.json`, written by the build next to `index.html` (`buildIdPlugin` in vite.config.ts). */
const VersionFileSchema = z.object({ build: z.string().min(1) });

/** Pure: whether the content of `/version.json` names a build other than `current` (false when unknown). */
export function isOtherBuild(file: unknown, current: string): boolean {
  const parsed = VersionFileSchema.safeParse(file);
  return current !== '' && parsed.success && parsed.data.build !== current;
}

/**
 * Whether the server now serves another build of the portal than the one running in this page (a page opened before
 * a release): reads `/version.json` without cache. Any failure (development, network) is «no».
 */
export async function newBuildAvailable(
  fetchFn: typeof fetch = globalThis.fetch,
  current: string = APP_BUILD,
): Promise<boolean> {
  if (current === '') return false;
  try {
    const res = await fetchFn('/version.json', { cache: 'no-store', credentials: 'omit' });
    return res.ok && isOtherBuild(await res.json(), current);
  } catch {
    return false;
  }
}

/** Pure: «SIRRealtime 1.0.0», with the commit in brackets only when asked for and known. */
export function versionLabel(version: string, commit: string, withCommit: boolean): string {
  return `SIRRealtime ${formatBuildVersion(version, withCommit ? commit : '')}`;
}
