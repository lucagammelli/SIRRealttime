import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import icon from './brand/arenalive-agent.ico';
import negative from './brand/arenalive-negativo.png';
import positive from './brand/arenalive-positivo.png';

/**
 * Images of ArenaLive included in the executable and written next to the window script at every start: the logo for
 * the header of the window without the graphics of a client (positive for light backgrounds, negative for dark ones)
 * and the icon of the window. Copies of apps/web/public/brand (scripts/brand-icons.ts of the portal).
 */
export interface ProductAssets {
  logoPositive: string | null;
  logoNegative: string | null;
  icon: string | null;
}

export const NO_PRODUCT_ASSETS: ProductAssets = { logoPositive: null, logoNegative: null, icon: null };

const FILES = {
  logoPositive: ['arenalive-positivo.png', positive],
  logoNegative: ['arenalive-negativo.png', negative],
  icon: ['arenalive-agent.ico', icon],
} as const;

/** Writes the images in `dir`; a file that cannot be written is null (the window works without it). */
export async function writeProductAssets(dir: string): Promise<ProductAssets> {
  const out: ProductAssets = { ...NO_PRODUCT_ASSETS };
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    return out;
  }
  for (const key of Object.keys(FILES) as (keyof ProductAssets)[]) {
    const [name, bytes] = FILES[key];
    const path = join(dir, name);
    try {
      await writeFile(path, bytes);
      out[key] = path;
    } catch {
      // Read-only folder or full disk: no logo or icon, the window still opens.
    }
  }
  return out;
}
