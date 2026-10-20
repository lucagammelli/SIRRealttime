import { readFileSync } from 'node:fs';
import { BuildCommitSchema, BuildVersionSchema } from '@arenalive/shared';

export interface BuildInfo {
  version: string;
  commit?: string;
}

/** Pure: `{version, commit?}` from the text of `build-info.json` or of the root `package.json`; null when invalid. */
export function parseBuildInfo(text: string): BuildInfo | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const version = BuildVersionSchema.safeParse('version' in raw ? raw.version : undefined);
  if (!version.success) return null;
  const commit = BuildCommitSchema.safeParse('commit' in raw ? raw.commit : undefined);
  return commit.success ? { version: version.data, commit: commit.data } : { version: version.data };
}

/**
 * Version of the running build. Built server: `dist/build-info.json`, written at build time from the root
 * `package.json` and the commit (`scripts/scrivi-versione.mjs`). From the sources (tests, `pnpm dev`): the root
 * `package.json` itself. `0.0.0` when neither is readable.
 */
function loadBuildInfo(): BuildInfo {
  for (const path of ['./build-info.json', '../../../package.json']) {
    try {
      const info = parseBuildInfo(readFileSync(new URL(path, import.meta.url), 'utf8'));
      if (info) return info;
    } catch {
      // Not there (running from the sources, or from the compiled files outside the monorepo): next candidate.
    }
  }
  return { version: '0.0.0' };
}

let cached: BuildInfo | undefined;
export function buildInfo(): BuildInfo {
  cached ??= loadBuildInfo();
  return cached;
}
