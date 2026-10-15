import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

/** Error of the agent configuration: the process cannot start. */
export class ConfigError extends Error {
  constructor(
    readonly code: 'CONFIG_NOT_FOUND' | 'CONFIG_INVALID_JSON' | 'CONFIG_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True for literal IPv4 addresses in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (never for host names). */
export function isPrivateIPv4(hostname: string): boolean {
  const m = IPV4.exec(hostname);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Syntax only; whether plain http is allowed depends on `allowHttpPrivateNetwork` (see the file schema). */
export const ServerUrlSchema = z
  .url()
  .refine((value) => new URL(value).username === '' && new URL(value).password === '', {
    message: 'serverUrl non può contenere credenziali',
  });

/** True when the agent will talk plain http to a private-network address on purpose (to warn at start-up). */
export function usesPlainHttpOnPrivateNetwork(serverUrl: string, allow: boolean | undefined): boolean {
  const url = new URL(serverUrl);
  return allow === true && url.protocol === 'http:' && isPrivateIPv4(url.hostname);
}

/** Content of `config.json`. */
export const AgentConfigFileSchema = z
  .object({
    /** Folder (e.g. `E:\`) where the most recent `.dvw` is taken, or a single `.dvw` file. */
    watchPath: z.string().min(1),
    /** https always; plain http only towards localhost, or private IPv4 literals with `allowHttpPrivateNetwork`. */
    serverUrl: ServerUrlSchema,
    /** Only for tests on a local network: allows plain http towards literal private IPv4 addresses. */
    allowHttpPrivateNetwork: z.boolean().default(false),
    /** Same format accepted by the server (base64url, 20-200 characters). */
    agentToken: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, {
      message: 'agentToken non valido (copialo intero dall’area admin)',
    }),
    pollIntervalMs: z.int().min(10).max(60_000).default(1000),
    stableMs: z.int().min(0).max(60_000).default(700),
    /** Queue and state; never on the USB stick. Default: `data` next to the executable. */
    dataDir: z.string().min(1).optional(),
    /** Default: `logs` next to the executable. */
    logDir: z.string().min(1).optional(),
    logLevel: z.enum(LOG_LEVELS).default('info'),
    /** A snapshot refused by the server (4xx/413) is tried again after this long, even without changes. */
    snapshotRetryMs: z.int().min(1000).max(86_400_000).default(300_000),
    /** State of matches not updated for this many days, with an empty queue, is deleted at start-up. */
    retentionDays: z.int().min(1).max(3650).default(30),
  })
  .strict()
  .superRefine((c, ctx) => {
    let url: URL;
    try {
      url = new URL(c.serverUrl);
    } catch {
      return; // already reported by the field schema
    }
    if (url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return;
    let message = 'serverUrl deve usare https (http solo verso localhost o 127.0.0.1)';
    if (url.protocol === 'http:' && isPrivateIPv4(url.hostname)) {
      if (c.allowHttpPrivateNetwork) return;
      message =
        'serverUrl: per http verso un IP privato imposta allowHttpPrivateNetwork: true (solo per prove in rete locale)';
    } else if (url.protocol === 'http:') {
      message =
        'serverUrl: http rifiutato verso un host pubblico o un nome host; usa https (http solo verso localhost o, con allowHttpPrivateNetwork, verso un IP privato)';
    }
    ctx.addIssue({ code: 'custom', path: ['serverUrl'], message });
  });
export type AgentConfigFile = z.infer<typeof AgentConfigFileSchema>;

/** Configuration with absolute paths and defaults applied. */
export interface AgentConfig {
  watchPath: string;
  serverUrl: string;
  /** Plain http allowed towards literal private IPv4 addresses (tests on a local network). */
  allowHttpPrivateNetwork?: boolean;
  agentToken: string;
  pollIntervalMs: number;
  stableMs: number;
  dataDir: string;
  logDir: string;
  logLevel: LogLevel;
  snapshotRetryMs: number;
  retentionDays: number;
}

/** True when `child` is `parent` or lies inside it (case-insensitive, as on Windows). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent.toLowerCase(), child.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Validates the parsed JSON and resolves the paths against `baseDir` (folder of the executable). */
export function parseConfig(raw: unknown, baseDir: string): AgentConfig {
  const parsed = AgentConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ');
    throw new ConfigError('CONFIG_INVALID', `Configurazione non valida: ${details}`);
  }
  const c = parsed.data;
  const watchPath = resolve(baseDir, c.watchPath);
  const dataDir = resolve(baseDir, c.dataDir ?? 'data');
  const logDir = resolve(baseDir, c.logDir ?? 'logs');
  // The watched folder (or the folder of the watched file) is the USB stick: nothing of ours is written there.
  const stick = /\.dvw$/i.test(watchPath) ? dirname(watchPath) : watchPath;
  for (const [name, dir] of [
    ['dataDir', dataDir],
    ['logDir', logDir],
  ] as const) {
    if (isInside(stick, dir)) {
      throw new ConfigError(
        'CONFIG_INVALID',
        `Configurazione non valida: ${name} non può stare dentro watchPath (${stick})`,
      );
    }
  }
  return {
    watchPath,
    serverUrl: c.serverUrl,
    allowHttpPrivateNetwork: c.allowHttpPrivateNetwork,
    agentToken: c.agentToken,
    pollIntervalMs: c.pollIntervalMs,
    stableMs: c.stableMs,
    dataDir,
    logDir,
    logLevel: c.logLevel,
    snapshotRetryMs: c.snapshotRetryMs,
    retentionDays: c.retentionDays,
  };
}

/** Reads and validates a `config.json`; relative paths are resolved against `baseDir`. */
export function loadConfig(file: string, baseDir: string): AgentConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError('CONFIG_NOT_FOUND', `File di configurazione non trovato o illeggibile: ${file}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new ConfigError('CONFIG_INVALID_JSON', `config.json non è un JSON valido: ${file}`);
  }
  return parseConfig(raw, baseDir);
}

/** Default config path: `config.json` in `baseDir`. */
export const defaultConfigPath = (baseDir: string): string => join(baseDir, 'config.json');
