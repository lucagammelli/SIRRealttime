import type { TemplateId } from './templates.js';
import { z } from 'zod';
import type { BrandColorChoice } from './colors.js';
import { HexColorSchema, resolveBrandColors, textColorOn } from './colors.js';
import { plainText } from './strings.js';

/**
 * Agent for Windows offered by the portal: the zip `GET /api/admin/agent/download` holds the executable (the same for
 * every client, described by `sir-agent.json` in AGENT_DOWNLOAD_DIR) and, for the client of the session,
 * `config.json`, `branding.json` and the logo read by the window of the agent.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Pure: true for literal IPv4 addresses in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (never for host names). */
export function isPrivateIPv4(hostname: string): boolean {
  const m = IPV4.exec(hostname);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Version of the agent build: letters, digits, dots, dashes and plus, 1-64 characters (it ends up in a file name). */
export const AgentVersionSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/);

/** `sir-agent.json` written by `scripts/costruisci-agente.sh` next to `sir-agent.exe`. */
export const AgentReleaseSchema = z.object({
  version: AgentVersionSchema,
  /** ISO 8601 UTC. */
  builtAt: z.iso.datetime(),
  /** sha256 (hex) of `sir-agent.exe`: the server offers the file only when it matches. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  nodeVersion: z.string().max(32).optional(),
});
export type AgentRelease = z.infer<typeof AgentReleaseSchema>;

/** `GET /api/admin/agent/info`: the executable offered for download, if any. */
export const AgentDownloadInfoSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    version: AgentVersionSchema,
    builtAt: z.iso.datetime(),
    /** Bytes of `sir-agent.exe`. */
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Name of the zip the download gives. */
    fileName: z.string(),
  }),
]);
export type AgentDownloadInfo = z.infer<typeof AgentDownloadInfoSchema>;

/** Name of the downloaded zip (slug and version are already safe for a file name). */
export const agentDownloadFileName = (slug: string, version: string): string =>
  `SIRRealtime-agente-${slug}-${version}.zip`;

/** Folder of the zip with the executable and the files of the client. */
export const AGENT_ZIP_FOLDER = 'SIRRealtime-agente';

/** Version of `branding.json`. */
export const AGENT_BRANDING_VERSION = 1;
/** Largest logo the window shows (bytes and pixels per side); a bigger one is left out. */
export const AGENT_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const AGENT_LOGO_MAX_SIDE = 1024;
/** Names of the logo next to the executable, by type (WinForms reads PNG and JPEG, not WebP or SVG). */
export const AGENT_LOGO_FILES = { 'image/png': 'logo.png', 'image/jpeg': 'logo.jpg' } as const;

/**
 * `branding.json` next to `sir-agent.exe`: name of the client and its colours, already resolved (those of its
 * template for the missing ones) with the colour of the text on each of them. Only `#rrggbb`.
 */
export const AgentBrandingSchema = z.strictObject({
  version: z.literal(AGENT_BRANDING_VERSION),
  name: plainText(100),
  colors: z.strictObject({
    primary: HexColorSchema,
    onPrimary: HexColorSchema,
    accent: HexColorSchema,
    onAccent: HexColorSchema,
    background: HexColorSchema,
    onBackground: HexColorSchema,
  }),
});
export type AgentBranding = z.infer<typeof AgentBrandingSchema>;

/** Pure: `branding.json` of a client from its display name, chosen colours and template (missing: standard). */
export function agentBranding(name: string, colors: BrandColorChoice, template: TemplateId = 'standard'): AgentBranding {
  const all = resolveBrandColors(colors, template);
  return AgentBrandingSchema.parse({
    version: AGENT_BRANDING_VERSION,
    name,
    colors: {
      primary: all.primary,
      onPrimary: textColorOn(all.primary),
      accent: all.accent,
      onAccent: textColorOn(all.accent),
      background: all.background,
      onBackground: textColorOn(all.background),
    },
  });
}

/**
 * Pure: `config.json` of the downloaded agent, without token (it comes with the self-registration). Plain http
 * towards a literal private IPv4 (tests on a local network) adds `allowHttpPrivateNetwork: true`; never otherwise.
 */
export function agentDownloadConfig(serverUrl: string): Record<string, unknown> {
  const url = new URL(serverUrl);
  const lan = url.protocol === 'http:' && isPrivateIPv4(url.hostname);
  return {
    watchPath: 'E:\\',
    serverUrl,
    ...(lan ? { allowHttpPrivateNetwork: true } : {}),
    dataDir: 'C:\\SIRAgent\\data',
    logDir: 'C:\\SIRAgent\\logs',
  };
}
