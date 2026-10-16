import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Path of the file of an image: `<dir>/<tenantId>/<sha256>`. Both parts come from the database and are checked
 * again here (uuid and 64 hex digits), so no value can leave the folder.
 */
export function assetFilePath(dir: string, tenantId: string, sha256: string): string {
  if (!UUID.test(tenantId) || !SHA256_HEX.test(sha256)) throw new Error('invalid asset path');
  return join(dir, tenantId, sha256);
}

/** Writes the file (temporary name, then rename: a reader never sees half a file). */
export async function writeAssetFile(dir: string, tenantId: string, sha256: string, data: Buffer): Promise<void> {
  await writeAtomic(join(dir, tenantId), assetFilePath(dir, tenantId, sha256), data);
}

/** Sub-folder of ASSETS_DIR with the logos of the championships (common to every client, not a uuid). */
export const LEAGUE_ASSETS_FOLDER = '_leagues';

/** Path of a downloaded team logo: `<dir>/_leagues/<sha256>` (the hash is checked again here). */
export function leagueLogoFilePath(dir: string, sha256: string): string {
  if (!SHA256_HEX.test(sha256)) throw new Error('invalid logo path');
  return join(dir, LEAGUE_ASSETS_FOLDER, sha256);
}

export async function writeLeagueLogoFile(dir: string, sha256: string, data: Buffer): Promise<void> {
  await writeAtomic(join(dir, LEAGUE_ASSETS_FOLDER), leagueLogoFilePath(dir, sha256), data);
}

/** Content of a team logo, null when missing. */
export async function readLeagueLogoFile(dir: string, sha256: string): Promise<Buffer | null> {
  return readOrNull(leagueLogoFilePath(dir, sha256));
}

async function writeAtomic(folder: string, target: string, data: Buffer): Promise<void> {
  await mkdir(folder, { recursive: true, mode: 0o750 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o640 });
    await rename(temporary, target);
  } catch (err) {
    await rm(temporary, { force: true });
    throw err;
  }
}

/** Content of the file, null when it is missing. */
export async function readAssetFile(dir: string, tenantId: string, sha256: string): Promise<Buffer | null> {
  return readOrNull(assetFilePath(dir, tenantId, sha256));
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function removeAssetFile(dir: string, tenantId: string, sha256: string): Promise<void> {
  await rm(assetFilePath(dir, tenantId, sha256), { force: true });
}
