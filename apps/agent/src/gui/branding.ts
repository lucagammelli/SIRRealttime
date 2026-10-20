import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentBranding } from '@arenalive/shared';
import { AGENT_LOGO_FILES, AGENT_LOGO_MAX_BYTES, AGENT_LOGO_MAX_SIDE, AgentBrandingSchema } from '@arenalive/shared';
import { errorCode } from '../util.js';

/** Name of the graphics file of the client, next to the executable (in the zip downloaded from the portal). */
export const BRANDING_FILE = 'branding.json';
/** Largest branding.json read (it is a few hundred bytes). */
const MAX_BRANDING_BYTES = 16 * 1024;

/** Graphics of the window, sent in the `init` message: colours already validated (`#rrggbb`). */
export interface WindowBranding {
  name: string;
  primary: string;
  onPrimary: string;
  /** Absolute path of a checked PNG or JPEG logo, null when there is none (or it was refused). */
  logoPath: string | null;
}

export interface BrandingRead {
  /** null: default graphics of the window. */
  branding: WindowBranding | null;
  /** Why a file present was ignored (for the log); null when all is fine or there is no file. */
  problems: string[];
}

/** Pure: width and height of a PNG (IHDR) or a baseline/progressive JPEG (SOF marker); null otherwise. */
export function imageSize(data: Buffer, type: keyof typeof AGENT_LOGO_FILES): { width: number; height: number } | null {
  if (type === 'image/png') {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (data.length < 24 || !data.subarray(0, 8).equals(signature) || data.toString('latin1', 12, 16) !== 'IHDR') {
      return null;
    }
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 <= data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = data.readUInt16BE(at + 2);
    // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) };
    }
    if (marker === 0xd9 || marker === 0xda || length < 2) return null;
    at += 2 + length;
  }
  return null;
}

async function readLogo(baseDir: string): Promise<{ path: string | null; problem: string | null }> {
  for (const [type, name] of Object.entries(AGENT_LOGO_FILES) as [keyof typeof AGENT_LOGO_FILES, string][]) {
    const path = join(baseDir, name);
    let stats;
    try {
      stats = await lstat(path);
    } catch (err) {
      if (errorCode(err) === 'ENOENT') continue;
      return { path: null, problem: `${name} illeggibile: logo non mostrato` };
    }
    if (!stats.isFile()) return { path: null, problem: `${name} non è un file: logo non mostrato` };
    if (stats.size > AGENT_LOGO_MAX_BYTES) return { path: null, problem: `${name} supera 2 MB: logo non mostrato` };
    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      return { path: null, problem: `${name} illeggibile: logo non mostrato` };
    }
    const size = data.length <= AGENT_LOGO_MAX_BYTES ? imageSize(data, type) : null;
    if (!size || size.width === 0 || size.height === 0) {
      return { path: null, problem: `${name} non è un'immagine valida: logo non mostrato` };
    }
    if (size.width > AGENT_LOGO_MAX_SIDE || size.height > AGENT_LOGO_MAX_SIDE) {
      return {
        path: null,
        problem: `${name} supera ${AGENT_LOGO_MAX_SIDE}×${AGENT_LOGO_MAX_SIDE} pixel: logo non mostrato`,
      };
    }
    return { path, problem: null };
  }
  return { path: null, problem: null };
}

async function readBrandingFile(file: string): Promise<{ branding: AgentBranding | null; problem: string | null }> {
  let text: string;
  try {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size > MAX_BRANDING_BYTES) {
      return { branding: null, problem: `${BRANDING_FILE} non valido: grafica predefinita` };
    }
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return { branding: null, problem: null };
    return { branding: null, problem: `${BRANDING_FILE} illeggibile: grafica predefinita` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { branding: null, problem: `${BRANDING_FILE} non è un JSON valido: grafica predefinita` };
  }
  const parsed = AgentBrandingSchema.safeParse(raw);
  if (!parsed.success) return { branding: null, problem: `${BRANDING_FILE} non valido: grafica predefinita` };
  return { branding: parsed.data, problem: null };
}

/**
 * Graphics of the client next to the executable: `branding.json` (validated with the shared schema) and the logo
 * (`logo.png` or `logo.jpg`, at most 2 MB and 1024×1024). A missing or invalid file never stops the window: it keeps
 * its default graphics (`branding` null) or shows no logo, and `problems` says why.
 */
export async function readWindowBranding(baseDir: string): Promise<BrandingRead> {
  const file = await readBrandingFile(join(baseDir, BRANDING_FILE));
  if (!file.branding) return { branding: null, problems: file.problem ? [file.problem] : [] };
  const logo = await readLogo(baseDir);
  const { name, colors } = file.branding;
  return {
    branding: { name, primary: colors.primary, onPrimary: colors.onPrimary, logoPath: logo.path },
    problems: logo.problem ? [logo.problem] : [],
  };
}
