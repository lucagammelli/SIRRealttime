import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentConfig, LogLevel } from '../config.js';
import { AgentTokenSchema, ConfigError, LOG_LEVELS, parseConfig } from '../config.js';
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
 * Saves `agentToken` in `config.json`, keeping every other field as it is (pasted in the window today, received
 * from the server by the self-registration later). Only the token format is checked: the rest is validated at START.
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
