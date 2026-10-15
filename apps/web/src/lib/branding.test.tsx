import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicTenantResponse } from '@sir/shared';
import { brandPalette, DEFAULT_BRAND_COLORS, defaultIntermissions, defaultLayout } from '@sir/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePalette } from '../charts/usePalette.ts';
import { BrandMark } from '../components/BrandMark.tsx';
import { bytesToBase64 } from './base64.ts';
import { loadTenantLook, setTenantLook, tenantLookOf, writePalette } from './branding.ts';
import { applyThemeChoice } from './theme.ts';

const LOGO = '/api/public/assets/6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const MARK = '/api/public/assets/8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';

const tenant = (colors: PublicTenantResponse['branding']['colors'], logos = false): PublicTenantResponse => ({
  name: 'Sir Safety',
  branding: { version: 1, displayName: null, colors, logoMain: null, logoMark: null, sponsorLogo: null },
  images: { logoMain: logos ? LOGO : null, logoMark: logos ? MARK : null, sponsorLogo: null },
  layout: defaultLayout(),
  intermissions: defaultIntermissions(),
});

const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name);

afterEach(() => {
  cleanup();
  act(() => setTenantLook(null));
  applyThemeChoice('system');
});

describe('CSS variables of the client', () => {
  it('writes the light variables of the colours given and removes the old ones', () => {
    const root = document.createElement('div');
    const first = writePalette(brandPalette({ home: '#e30613', away: '#003399' }), 'light', root);
    expect(root.style.getPropertyValue('--sir-home')).toBe('#e30613');
    expect(root.style.getPropertyValue('--sir-on-home')).toBe('#ffffff');
    expect(first).toContain('--sir-away-soft');
    writePalette(brandPalette({ home: '#e30613' }), 'light', root, first);
    expect(root.style.getPropertyValue('--sir-away')).toBe('');
    writePalette(null, 'light', root, first);
    expect(root.style.getPropertyValue('--sir-home')).toBe('');
  });

  it('applies the client on <html>, follows the dark theme and goes back to the defaults', () => {
    const look = tenantLookOf(tenant({ home: '#e30613', background: '#fff4e0' }));
    act(() => setTenantLook(look));
    expect(rootVar('--sir-home')).toBe('#e30613');
    expect(rootVar('--sir-bg')).toBe('#fff4e0');
    act(() => {
      applyThemeChoice('dark');
      window.dispatchEvent(new Event('sir-theme'));
    });
    expect(rootVar('--sir-home')).toBe(look.palette.dark['--sir-home']);
    expect(rootVar('--sir-bg')).toBe(look.palette.dark['--sir-bg']);
    act(() => setTenantLook(null));
    expect(rootVar('--sir-home')).toBe('');
  });

  it('uses the square logo as favicon and restores the default one', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.setAttribute('href', '/favicon.svg');
    document.head.append(link);
    act(() => setTenantLook(tenantLookOf(tenant({}, true))));
    expect(link.getAttribute('href')).toBe(MARK);
    expect(link.hasAttribute('type')).toBe(false);
    act(() => setTenantLook(null));
    expect(link.getAttribute('href')).toBe('/favicon.svg');
    expect(link.getAttribute('type')).toBe('image/svg+xml');
    link.remove();
  });

  // Tests run from apps/web (vitest root).
  it('keeps tokens.css and the defaults of @sir/shared in step', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const light = css.slice(0, css.indexOf("[data-theme='dark']"));
    const value = (name: string): string | undefined => new RegExp(`${name}:\\s*(#[0-9a-f]{6});`).exec(light)?.[1];
    expect(value('--sir-primary')).toBe(DEFAULT_BRAND_COLORS.primary);
    expect(value('--sir-accent')).toBe(DEFAULT_BRAND_COLORS.accent);
    expect(value('--sir-home')).toBe(DEFAULT_BRAND_COLORS.home);
    expect(value('--sir-away')).toBe(DEFAULT_BRAND_COLORS.away);
    expect(value('--sir-bg')).toBe(DEFAULT_BRAND_COLORS.background);
  });
});

describe('loading the graphics', () => {
  it('reads the public answer and falls back to the defaults on any failure', async () => {
    const ok =
      (body: unknown, status = 200) =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
    const look = await loadTenantLook({ fetch: ok(tenant({ away: '#003399' })) });
    expect(look?.palette.light['--sir-away']).toBe('#003399');
    expect(await loadTenantLook({ fetch: ok({ error: 'Non trovato' }, 404) })).toBeNull();
    expect(await loadTenantLook({ fetch: ok({ name: 1 }) })).toBeNull();
    expect(await loadTenantLook({ fetch: () => Promise.reject(new TypeError('rete')) })).toBeNull();
    const evil = tenant({});
    expect(
      await loadTenantLook({ fetch: ok({ ...evil, branding: { ...evil.branding, colors: { home: 'red;}' } } }) }),
    ).toBeNull();
  });
});

function PaletteProbe() {
  return <output data-testid="home">{usePalette().home}</output>;
}

describe('components', () => {
  it('the charts read the palette again when the graphics arrive', () => {
    render(<PaletteProbe />);
    const before = screen.getByTestId('home').textContent;
    act(() => setTenantLook(tenantLookOf(tenant({ home: '#e30613' }))));
    expect(screen.getByTestId('home').textContent).toBe('#e30613');
    expect(before).not.toBe('#e30613');
  });

  it('the header shows the horizontal logo as an image, otherwise the wordmark', () => {
    render(<BrandMark />);
    expect(screen.getByText('Realtime')).toBeTruthy();
    act(() => setTenantLook(tenantLookOf(tenant({}, true))));
    const img = screen.getByRole('img', { name: 'Sir Safety' });
    expect(img.getAttribute('src')).toBe(LOGO);
  });
});

describe('bytesToBase64', () => {
  it('matches the base64 of Node, also for large data', () => {
    const data = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(bytesToBase64(data)).toBe(Buffer.from(data).toString('base64'));
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});
