import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { guiPaths, readConfigFile, saveTokenToFile, saveWatchPath, tokenInfo } from '../src/gui/config-file.js';
import { tempDirs } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const TOKEN = 'T'.repeat(39) + 'wxyz';

async function setup(content: object | string): Promise<{ file: string; home: string; stick: string }> {
  const dirs = tempDirs();
  cleanups.push(dirs.cleanup);
  await mkdir(dirs.home, { recursive: true });
  const file = join(dirs.home, 'config.json');
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return { file, home: dirs.home, stick: dirs.stick };
}

describe('config.json dalla finestra', () => {
  it('watchPath e token salvati senza perdere gli altri campi, né file temporanei', async () => {
    const { file, home, stick } = await setup({
      serverUrl: 'https://sir.example.it',
      watchPath: 'E:\\',
      pollIntervalMs: 500,
      logLevel: 'debug',
      dataDir: 'dati',
    });
    expect(await saveTokenToFile(file, ` ${TOKEN}\n`)).toBe(TOKEN);
    const config = await saveWatchPath(file, home, stick);
    expect(config.agentToken).toBe(TOKEN);
    expect(config.watchPath).toBe(stick);
    expect(config.dataDir).toBe(join(home, 'dati'));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      serverUrl: 'https://sir.example.it',
      watchPath: stick,
      pollIntervalMs: 500,
      logLevel: 'debug',
      dataDir: 'dati',
      agentToken: TOKEN,
    });
    expect(await readdir(home)).toEqual(['config.json']);
  });

  it('configurazione non valida: niente scritto, ConfigError con il motivo', async () => {
    const original = JSON.stringify({ serverUrl: 'http://sir.example.it', watchPath: 'E:\\', agentToken: TOKEN });
    const { file, home, stick } = await setup(original);
    await expect(saveWatchPath(file, home, stick)).rejects.toThrow(/https/);
    expect(await readFile(file, 'utf8')).toBe(original);
    await expect(saveTokenToFile(file, 'corto')).rejects.toBeInstanceOf(ConfigError);
    await expect(saveTokenToFile(file, 'corto')).rejects.toThrow(/agentToken non valido/);
    expect(await readFile(file, 'utf8')).toBe(original);
    // dataDir sulla pennina: rifiutato.
    const second = await setup({ serverUrl: 'https://sir.example.it', agentToken: TOKEN, dataDir: join(stick, 'x') });
    await expect(saveWatchPath(second.file, second.home, stick)).rejects.toThrow(/dataDir/);
  });

  it('file mancante, JSON rotto, BOM', async () => {
    const { file, home } = await setup('\uFEFF{"watchPath":"E:\\\\","agentToken":"' + TOKEN + '"}');
    const read = await readConfigFile(file);
    expect(read.kind).toBe('ok');
    expect(tokenInfo(read.kind === 'ok' ? read.raw : null)).toEqual({ present: true, last4: 'wxyz' });
    expect(tokenInfo({})).toEqual({ present: false, last4: null });
    const missing = await readConfigFile(join(home, 'manca.json'));
    expect(missing).toMatchObject({ kind: 'missing' });
    expect(missing.kind === 'missing' && missing.message).toMatch(/area admin, pagina «Agenti»/);
    await expect(saveTokenToFile(join(home, 'manca.json'), TOKEN)).rejects.toThrow(/«Agenti»/);
    await writeFile(file, '{ rotto');
    expect(await readConfigFile(file)).toMatchObject({ kind: 'invalid' });
    await expect(saveWatchPath(file, home, 'E:\\')).rejects.toThrow(/JSON valido/);
  });

  it('cartelle e livello di log prima della validazione', () => {
    expect(guiPaths(null, '/agente')).toEqual({ dataDir: '/agente/data', logDir: '/agente/logs', level: 'info' });
    expect(guiPaths({ dataDir: '/d', logDir: 'l', logLevel: 'debug' }, '/agente')).toEqual({
      dataDir: '/d',
      logDir: '/agente/l',
      level: 'debug',
    });
    expect(guiPaths({ logLevel: 'boh', dataDir: 3 }, '/a').level).toBe('info');
  });
});
