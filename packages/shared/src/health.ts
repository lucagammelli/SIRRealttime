import { z } from 'zod';

/** Version of the build: `a.b.c` read from the root `package.json` (see `scripts/versione.mjs`). */
export const BuildVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
/** Short commit of the build, lowercase hexadecimal (7-40 characters). */
export const BuildCommitSchema = z.string().regex(/^[0-9a-f]{7,40}$/);

/** `GET /api/health` (public): database reachable, and which version is running. Nothing else. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: BuildVersionSchema,
  commit: BuildCommitSchema.optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Text of the version for the screens: `1.0.0` or `1.0.0 (85952d0)`. */
export function formatBuildVersion(version: string, commit?: string | null): string {
  return commit ? `${version} (${commit})` : version;
}
