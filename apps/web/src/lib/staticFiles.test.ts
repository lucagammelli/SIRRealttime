import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BRAND_NAME, webManifest } from '@sir/shared';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(resolve(here, relative), 'utf8');
const exists = (relative: string): boolean => existsSync(resolve(here, relative));
const PUBLIC = '../../public';

describe('manifest.webmanifest (installable app)', () => {
  const manifest = JSON.parse(read(`${PUBLIC}/manifest.webmanifest`)) as Record<string, unknown>;

  it('opens full screen, with the standalone fallback, and has name, language and scope of the whole site', () => {
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.display_override).toEqual(['fullscreen', 'standalone']);
    expect(manifest.name).toBe('SIRRealtime');
    expect(manifest.short_name).toBe('SIRRealtime');
    expect(manifest.lang).toBe('it');
    expect(manifest.scope).toBe('/');
  });

  it('has no start_url: the browser reopens the link from which the app is installed (a match or a channel)', () => {
    expect('start_url' in manifest).toBe(false);
    expect('id' in manifest).toBe(false);
  });

  it('colours are the ones of the tokens (light background, primary of the client by default)', () => {
    const tokens = read('../styles/tokens.css');
    const token = (name: string): string => new RegExp(`--sir-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1] ?? '';
    expect(manifest.background_color).toBe(token('bg'));
    expect(manifest.theme_color).toBe(token('primary'));
  });

  it('icons exist as PNG files of the declared size, with a maskable one', () => {
    const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[];
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(exists(`${PUBLIC}${icon.src}`)).toBe(true);
      // PNG signature and width / height of the IHDR chunk
      const file = readFileSync(resolve(here, `${PUBLIC}${icon.src}`));
      expect(file.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it('is the manifest of the server for a client without graphics (one source: webManifest of @sir/shared)', () => {
    expect(manifest).toEqual(webManifest({ name: DEFAULT_BRAND_NAME, colors: {}, logo: null }));
  });

  it('index.html links the manifest of the client of the hostname and the icon of iPhone', () => {
    const html = read('../../index.html');
    expect(html).toContain('<link rel="manifest" href="/api/public/manifest.webmanifest" />');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
  });
});

describe('service worker (public/sw.js)', () => {
  // the code only: the comments say what it does not do
  const sw = read(`${PUBLIC}/sw.js`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('is minimal: no cache and no response of its own, the network always answers', () => {
    expect(sw).not.toMatch(/\bcaches\b/);
    expect(sw).not.toMatch(/respondWith|importScripts|fetch\(/);
    expect(sw).toContain("addEventListener('fetch'");
  });
});

describe('CSP of the portal (docker/web.security-headers.conf)', () => {
  const conf = read('../../../../docker/web.security-headers.conf');
  const csp = /Content-Security-Policy "([^"]+)"/.exec(conf)?.[1] ?? '';

  it('allows only the workers of the same origin; every other directive is as before', () => {
    expect(csp).toContain("worker-src 'self'");
    expect(csp).not.toContain("worker-src 'none'");
    expect(csp.split('; ')).toEqual([
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
  });
});

describe('fonts', () => {
  const css = read('../styles/fonts.css');

  it('Inter is served by the portal: variable 400-700, latin and latin-ext, licence next to the files and in public', () => {
    expect(css).toContain("font-family: 'Inter'");
    for (const subset of ['latin', 'latin-ext']) {
      expect(css).toContain(`./fonts/inter/inter-${subset}.woff2`);
      expect(exists(`../styles/fonts/inter/inter-${subset}.woff2`)).toBe(true);
    }
    expect(css.match(/font-weight: 400 700/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css).not.toMatch(/https?:\/\//);
    expect(read('../styles/fonts/inter/OFL.txt')).toContain('SIL Open Font License');
    expect(read(`${PUBLIC}/assets/inter-OFL.txt`)).toBe(read('../styles/fonts/inter/OFL.txt'));
    // Google Sans Code stays for «SIR VOLLEY»
    expect(css).toContain("font-family: 'Google Sans Code'");
  });

  it('the reserved area is in Inter whatever the template; the template SIR VOLLEY keeps its own font on the public page', () => {
    const index = read('../styles/index.css');
    const admin = /\.sir-admin-font \{([^}]*)\}/.exec(index)?.[1] ?? '';
    expect(admin).toMatch(/--sir-font-sans:\s*'Inter'/);
    expect(admin).toContain('font-family: var(--sir-font-sans)');
    expect(index).toMatch(/\.sir-admin-font table[^{]*\{[^}]*tabular-nums/);
    expect(read('../styles/tokens.css')).toMatch(/\[data-template='sir-volley'\][^{]*\{[^}]*'Google Sans Code'/);
  });

  it('the thin scrollbar of the side menu: 6 px, colours of the tokens', () => {
    const index = read('../styles/index.css');
    expect(index).toContain('scrollbar-width: thin');
    expect(index).toMatch(/\.sir-thin-scroll::-webkit-scrollbar \{[^}]*width: 6px/);
    expect(index).toMatch(/\.sir-thin-scroll::-webkit-scrollbar-thumb \{[^}]*var\(--sir-border\)/);
  });
});
