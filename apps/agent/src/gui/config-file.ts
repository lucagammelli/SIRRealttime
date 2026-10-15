import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentConfig, LogLevel } from '../config.js';
import {
  AgentTokenSchema,
  ConfigError,
  LOG_LEVELS,
  ServerUrlSchema,
  assertNotOnStick,
  parseConfig,
  serverUrlProtocolProblem,
} from '../config.js';
import { writeFileAtomic } from '../store.js';
import { errorCode } from '../util.js';

/** Raw content of `config.json` (validated only at START, with `parseConfig`). */
export type RawConfig = Record<string, unknown>;

export type ConfigFileRead =
  { kind: 'ok'; raw: RawConfig } | { kind: 'missing'; message: string } | { kind: 'invalid'; message: string };

export const missingConfigMessage = (file: string): string =>
  `config.json non trovato (${file}): scaricalo dall'area admin, pagina «Agenti», e mettilo accanto a sir-agent.exe`;

/** Reads `config.json` without validating it (the window shows what is there). */
export async function readConfigFile(file: string): Promise<ConfigFileRead> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return { kind: 'missing', message: missingConfigMessage(file) };
    return { kind: 'invalid', message: `config.json illeggibile: ${file}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { kind: 'invalid', message: `config.json non è un JSON valido: ${file}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'invalid', message: `config.json non contiene un oggetto JSON: ${file}` };
  }
  return { kind: 'ok', raw: raw as RawConfig };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether a token is saved, and its last 4 characters (the token itself never leaves the agent). */
export function tokenInfo(raw: RawConfig | null): { present: boolean; last4: string | null } {
  const token = text(raw?.['agentToken']);
  return token === '' ? { present: false, last4: null } : { present: true, last4: token.slice(-4) };
}

export interface WindowFields {
  watchPath: string;
  serverUrl: string;
}

export function windowFields(raw: RawConfig | null): WindowFields {
  return { watchPath: text(raw?.['watchPath']), serverUrl: text(raw?.['serverUrl']) };
}

/** Folders and level of the window process, before the configuration is validated (defaults as `parseConfig`). */
export function guiPaths(raw: RawConfig | null, baseDir: string): { dataDir: string; logDir: string; level: LogLevel } {
  const dataDir = text(raw?.['dataDir']) || 'data';
  const logDir = text(raw?.['logDir']) || 'logs';
  const level = LOG_LEVELS.find((l) => l === raw?.['logLevel']) ?? 'info';
  return { dataDir: resolve(baseDir, dataDir), logDir: resolve(baseDir, logDir), level };
}

/**
 * `serverUrl` of `config.json` checked as at START (syntax, no credentials, https or the allowed http), for the
 * self-registration, which runs before the rest of the configuration is complete. Throws `ConfigError`.
 */
export function registrationServerUrl(raw: RawConfig): string {
  const value = text(raw['serverUrl']).trim();
  if (value === '') {
    throw new ConfigError(
      'CONFIG_INVALID',
      'serverUrl mancante in config.json: scaricalo dall’area admin, pagina «Agenti»',
    );
  }
  const parsed = ServerUrlSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigError(
      'CONFIG_INVALID',
      `Configurazione non valida: serverUrl: ${parsed.error.issues[0]?.message ?? 'non valido'}`,
    );
  }
  const problem = serverUrlProtocolProblem(new URL(parsed.data), raw['allowHttpPrivateNetwork'] === true);
  if (problem) throw new ConfigError('CONFIG_INVALID', `Configurazione non valida: ${problem}`);
  return parsed.data;
}

/**
 * Data folder of the self-registration (where `registration.json`, with the secret, is written), refused like at
 * START when it lies on the USB stick of `watchPath` (an empty `watchPath` is not checked yet). Throws `ConfigError`.
 */
export function registrationDataDir(raw: RawConfig, baseDir: string): string {
  const paths = guiPaths(raw, baseDir);
  const watchPath = text(raw['watchPath']).trim();
  if (watchPath !== '') {
    assertNotOnStick(resolve(baseDir, watchPath), { dataDir: paths.dataDir, logDir: paths.logDir });
  }
  return paths.dataDir;
}

/** Where the window writes its script and logs when the configured folders are on the USB stick. */
export const defaultFallbackDir = (): string => join(tmpdir(), 'SIRAgent');

/**
 * Folders of the window process (script `gui/window.ps1` and logs) that are safe to write: the configured ones, or
 * `fallbackDir` when `dataDir` or `logDir` lies on the USB stick of `watchPath` (nothing is ever written there).
 * `problem` is the message for the window in that case; START and «Registra» refuse the same configuration.
 */
export function guiWritablePaths(
  raw: RawConfig | null,
  baseDir: string,
  fallbackDir: string = defaultFallbackDir(),
): { dataDir: string; logDir: string; level: LogLevel; problem: string | null } {
  const paths = guiPaths(raw, baseDir);
  const watchPath = text(raw?.['watchPath']).trim();
  if (watchPath === '') return { ...paths, problem: null };
  try {
    assertNotOnStick(resolve(baseDir, watchPath), { dataDir: paths.dataDir, logDir: paths.logDir });
    return { ...paths, problem: null };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    return {
      dataDir: join(fallbackDir, 'data'),
      logDir: join(fallbackDir, 'logs'),
      level: paths.level,
      problem: `${err.message}: correggi config.json (intanto finestra e log in ${fallbackDir})`,
    };
  }
}

async function readForUpdate(file: string): Promise<RawConfig> {
  const current = await readConfigFile(file);
  if (current.kind === 'missing') throw new ConfigError('CONFIG_NOT_FOUND', current.message);
  if (current.kind === 'invalid') throw new ConfigError('CONFIG_INVALID_JSON', current.message);
  return current.raw;
}

/** Replaces the file atomically (temporary file + rename), only if the content changed. */
async function writeIfChanged(file: string, before: RawConfig, after: RawConfig): Promise<void> {
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await writeFileAtomic(file, `${JSON.stringify(after, null, 2)}\n`);
  }
}

/**
 * Saves `agentToken` in `config.json`, keeping every other field as it is (pasted in the window, or received from
 * the server by the self-registration). Only the token format is checked: the rest is validated at START.
 * Throws `ConfigError` when the file is missing or the token is not valid; returns the saved token.
 */
export async function saveTokenToFile(file: string, token: string): Promise<string> {
  const parsed = AgentTokenSchema.safeParse(token.trim());
  if (!parsed.success) {
    throw new ConfigError(
      'CONFIG_INVALID',
      `Configurazione non valida: ${parsed.error.issues[0]?.message ?? 'agentToken'}`,
    );
  }
  const raw = await readForUpdate(file);
  await writeIfChanged(file, raw, { ...raw, agentToken: parsed.data });
  return parsed.data;
}

/**
 * Sets `watchPath` in `config.json`, keeping every other field as it is. The result is validated with `parseConfig`
 * before writing (nothing is written if it is not valid). Throws `ConfigError` (message for the window).
 */
export async function saveWatchPath(file: string, baseDir: string, watchPath: string): Promise<AgentConfig> {
  const raw = await readForUpdate(file);
  const merged: RawConfig = { ...raw, watchPath };
  const config = parseConfig(merged, baseDir);
  await writeIfChanged(file, raw, merged);
  return config;
}
