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
  const target = assetFilePath(dir, tenantId, sha256);
  await mkdir(join(dir, tenantId), { recursive: true, mode: 0o750 });
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
  try {
    return await readFile(assetFilePath(dir, tenantId, sha256));
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function removeAssetFile(dir: string, tenantId: string, sha256: string): Promise<void> {
  await rm(assetFilePath(dir, tenantId, sha256), { force: true });
}
