import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentBranding, agentDownloadConfig } from '@arenalive/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { jpeg, png, webp } from '../../server/test/imageFixtures.js';
import { parseConfig } from '../src/config.js';
import { imageSize, readWindowBranding } from '../src/gui/branding.js';
import { GuiController } from '../src/gui/controller.js';
import { NO_PRODUCT_ASSETS, writeProductAssets } from '../src/gui/productAssets.js';
import { GuiOutMessageSchema } from '../src/gui/protocol.js';
import { WINDOW_SCRIPT } from '../src/gui/window-script.js';
import { createLogger } from '../src/logger.js';
import { tempDirs } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function home(): Promise<string> {
  const dirs = tempDirs();
  cleanups.push(dirs.cleanup);
  await mkdir(dirs.home, { recursive: true });
  return dirs.home;
}

const BRANDING = agentBranding('Club A', { primary: '#0a7d3b' });

describe('grafica del cliente accanto all’eseguibile', () => {
  it('senza branding.json: grafica predefinita, nessun problema', async () => {
    expect(await readWindowBranding(await home())).toEqual({ branding: null, problems: [] });
  });

  it('JSON rotto o colori non validi: grafica predefinita con il motivo', async () => {
    const dir = await home();
    await writeFile(join(dir, 'branding.json'), '{ non json');
    const broken = await readWindowBranding(dir);
    expect(broken.branding).toBeNull();
    expect(broken.problems).toEqual([expect.stringMatching(/non è un JSON valido/) as unknown]);

    for (const primary of ['red', '#12345', 'url(x)', "#ffffff' -or 1"]) {
      await writeFile(
        join(dir, 'branding.json'),
        JSON.stringify({ ...BRANDING, colors: { ...BRANDING.colors, primary } }),
      );
      const bad = await readWindowBranding(dir);
      expect(bad.branding).toBeNull();
      expect(bad.problems).toEqual([expect.stringMatching(/branding\.json non valido/) as unknown]);
    }
  });

  it('valido: nome e colori (minuscoli) senza logo', async () => {
    const dir = await home();
    const upper = { ...BRANDING, colors: { ...BRANDING.colors, primary: '#0A7D3B' } };
    await writeFile(join(dir, 'branding.json'), `\uFEFF${JSON.stringify(upper)}`);
    expect(await readWindowBranding(dir)).toEqual({
      branding: { name: 'Club A', primary: '#0a7d3b', onPrimary: '#ffffff', logoPath: null },
      problems: [],
    });
  });

  it('logo PNG o JPEG entro 2 MB e 1024×1024; troppo grande o non valido: ignorato', async () => {
    const dir = await home();
    await writeFile(join(dir, 'branding.json'), JSON.stringify(BRANDING));
    await writeFile(join(dir, 'logo.jpg'), jpeg(300, 100));
    expect((await readWindowBranding(dir)).branding?.logoPath).toBe(join(dir, 'logo.jpg'));

    await writeFile(join(dir, 'logo.png'), png(200, 80));
    expect((await readWindowBranding(dir)).branding?.logoPath).toBe(join(dir, 'logo.png'));

    await writeFile(join(dir, 'logo.png'), png(1025, 10));
    const wide = await readWindowBranding(dir);
    expect(wide.branding).toMatchObject({ name: 'Club A', logoPath: null });
    expect(wide.problems).toEqual([expect.stringMatching(/1024×1024/) as unknown]);

    await writeFile(join(dir, 'logo.png'), png(10, 10, 2 * 1024 * 1024));
    expect((await readWindowBranding(dir)).problems).toEqual([expect.stringMatching(/supera 2 MB/) as unknown]);

    await writeFile(join(dir, 'logo.png'), webp(10, 10));
    expect((await readWindowBranding(dir)).problems).toEqual([
      expect.stringMatching(/non è un'immagine valida/) as unknown,
    ]);
  });

  it('misura PNG e JPEG dai byte', () => {
    expect(imageSize(png(33, 44), 'image/png')).toEqual({ width: 33, height: 44 });
    expect(imageSize(jpeg(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 });
    expect(imageSize(Buffer.from('nessuna immagine'), 'image/png')).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeNull();
  });

  it('il messaggio init porta i colori validati e il logo', async () => {
    const dir = await home();
    const lines: string[] = [];
    const { logger, close } = createLogger({ level: 'silent', logDir: join(dir, 'logs'), console: false });
    cleanups.push(() => Promise.resolve(close()));
    const branding = { name: 'Club A', primary: '#0a7d3b', onPrimary: '#ffffff', logoPath: join(dir, 'logo.png') };
    const controller = new GuiController({
      configPath: join(dir, 'config.json'),
      baseDir: dir,
      logger,
      send: (line) => lines.push(line),
      branding,
    });
    cleanups.push(() => controller.shutdown());
    await controller.init();
    const init = GuiOutMessageSchema.parse(JSON.parse(lines[0] ?? '{}'));
    expect(init).toMatchObject({ type: 'init', branding });
  });
});

describe('logo e icona di ArenaLive per la finestra', () => {
  it('scritti accanto allo script della finestra: due PNG e un .ico', async () => {
    const dir = join(await home(), 'gui');
    const assets = await writeProductAssets(dir);
    expect(assets).toEqual({
      logoPositive: join(dir, 'arenalive-positivo.png'),
      logoNegative: join(dir, 'arenalive-negativo.png'),
      icon: join(dir, 'arenalive-agent.ico'),
    });
    for (const path of [assets.logoPositive, assets.logoNegative]) {
      const bytes = await readFile(path ?? '');
      expect(imageSize(bytes, 'image/png')).toMatchObject({ width: 150 });
    }
    const ico = await readFile(assets.icon ?? '');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(5);
  });

  it('una cartella non scrivibile: niente immagini, la finestra si apre lo stesso', async () => {
    const file = join(await home(), 'un-file');
    await writeFile(file, 'x');
    expect(await writeProductAssets(join(file, 'gui'))).toEqual(NO_PRODUCT_ASSETS);
  });

  it('il messaggio init porta i percorsi; la finestra mette il logo senza grafica del cliente e l’icona', async () => {
    const dir = await home();
    const lines: string[] = [];
    const { logger, close } = createLogger({ level: 'silent', logDir: join(dir, 'logs'), console: false });
    cleanups.push(() => Promise.resolve(close()));
    const product = await writeProductAssets(join(dir, 'gui'));
    const controller = new GuiController({
      configPath: join(dir, 'config.json'),
      baseDir: dir,
      logger,
      send: (line) => lines.push(line),
      product,
    });
    cleanups.push(() => controller.shutdown());
    await controller.init();
    const init = GuiOutMessageSchema.parse(JSON.parse(lines[0] ?? '{}'));
    expect(init).toMatchObject({ type: 'init', product });
    expect(WINDOW_SCRIPT).toContain('Set-ProductHeader $message.product');
    expect(WINDOW_SCRIPT).toContain('Set-WindowIcon $message.product.icon');
  });
});

describe('config.json scaricato dal portale', () => {
  it('con il token della registrazione è una configurazione valida dell’agente', () => {
    const token = 't'.repeat(43);
    for (const url of ['https://club-a.sir.it', 'http://192.168.1.20:8080', 'http://localhost:8080']) {
      const config = parseConfig({ ...agentDownloadConfig(url), agentToken: token }, 'C:\\ArenaLiveAgent');
      expect(config.serverUrl).toBe(url);
    }
  });
});
