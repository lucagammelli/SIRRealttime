import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../src/config.js';

const BASE = join(tmpdir(), 'sir-agent-base');
const valid = {
  watchPath: join(tmpdir(), 'pennina'),
  serverUrl: 'https://sir.example.it',
  agentToken: 'tok_abcdefghijklmnopqrstuvwxyz',
};

const issue = (raw: unknown): string => {
  try {
    parseConfig(raw, BASE);
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
  return '';
};

describe('configurazione', () => {
  it('applica i default e risolve i percorsi accanto all’eseguibile', () => {
    const c = parseConfig(valid, BASE);
    expect(c.pollIntervalMs).toBe(1000);
    expect(c.stableMs).toBe(700);
    expect(c.logLevel).toBe('info');
    expect(c.dataDir).toBe(join(BASE, 'data'));
    expect(c.logDir).toBe(join(BASE, 'logs'));
    expect(c.snapshotRetryMs).toBe(300_000);
    expect(c.retentionDays).toBe(30);
  });

  it('rifiuta http verso un host remoto, accetta http verso localhost e 127.0.0.1', () => {
    expect(issue({ ...valid, serverUrl: 'http://sir.example.it' })).toMatch(/https/);
    expect(issue({ ...valid, serverUrl: 'http://192.168.1.10:3000' })).toMatch(/allowHttpPrivateNetwork/);
    expect(issue({ ...valid, serverUrl: 'ftp://localhost' })).toMatch(/https/);
    expect(parseConfig({ ...valid, serverUrl: 'http://localhost:3000' }, BASE).serverUrl).toBe('http://localhost:3000');
    expect(parseConfig({ ...valid, serverUrl: 'http://127.0.0.1:3000' }, BASE).serverUrl).toBe('http://127.0.0.1:3000');
  });

  it('http verso IP privati solo con allowHttpPrivateNetwork', () => {
    const on = { ...valid, allowHttpPrivateNetwork: true };
    for (const host of ['192.168.1.10:8085', '10.0.0.5', '172.20.1.1']) {
      const url = `http://${host}`;
      expect(parseConfig({ ...on, serverUrl: url }, BASE).serverUrl).toBe(url);
      expect(issue({ ...valid, serverUrl: url })).toMatch(/allowHttpPrivateNetwork: true/);
    }
    expect(issue({ ...on, serverUrl: 'http://172.32.0.1' })).toMatch(/rifiutato/);
    expect(issue({ ...on, serverUrl: 'http://8.8.8.8' })).toMatch(/rifiutato/);
    expect(issue({ ...on, serverUrl: 'http://portale.lan' })).toMatch(/rifiutato/);
    expect(parseConfig({ ...on, serverUrl: 'https://portale.lan' }, BASE).serverUrl).toBe('https://portale.lan');
    expect(parseConfig({ ...valid, serverUrl: 'http://localhost:3000' }, BASE).allowHttpPrivateNetwork).toBe(false);
  });

  it('rifiuta credenziali nell’URL, campi sconosciuti, token corti e dataDir sulla pennina', () => {
    expect(issue({ ...valid, serverUrl: 'https://u:p@sir.example.it' })).toMatch(/credenziali/);
    expect(issue({ ...valid, intervallo: 5 })).toMatch(/Configurazione non valida/);
    expect(issue({ ...valid, agentToken: 'corto' })).toMatch(/agentToken/);
    expect(issue({ ...valid, dataDir: join(valid.watchPath, 'coda') })).toMatch(
      /dataDir non può stare dentro watchPath/,
    );
    expect(issue({ ...valid, watchPath: join(valid.watchPath, 'partita.dvw'), logDir: valid.watchPath })).toMatch(
      /logDir/,
    );
  });

  it('il messaggio d’errore non contiene il token', () => {
    const msg = issue({ ...valid, agentToken: 'segreto con spazi non ammessi' });
    expect(msg).toMatch(/agentToken/);
    expect(msg).not.toContain('segreto');
  });

  it('legge config.json (anche con BOM) e segnala file mancante o JSON rotto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sir-agent-config-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, `\uFEFF${JSON.stringify({ ...valid, stableMs: 50 })}`);
    expect(loadConfig(file, dir).stableMs).toBe(50);
    writeFileSync(file, '{ non json');
    expect(() => loadConfig(file, dir)).toThrow(/JSON valido/);
    expect(() => loadConfig(join(dir, 'manca.json'), dir)).toThrow(/non trovato/);
  });

  it('config.example.json ha solo campi validi', async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(parseConfig({ ...raw, agentToken: valid.agentToken, dataDir: BASE, logDir: BASE }, BASE).serverUrl).toMatch(
      /^https:/,
    );
  });
});
