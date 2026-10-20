import { NO_SYSTEM_LOGOS } from '@arenalive/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { setSystemLogos } from './lib/systemLogos.ts';

const LOGO = {
  url: '/api/public/system-logos/00000000-0000-4000-8000-000000000001',
  mime: 'image/png',
  width: 150,
  height: 50,
} as const;
const DARK = { ...LOGO, url: '/api/public/system-logos/00000000-0000-4000-8000-000000000002' };

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  act(() => setSystemLogos(NO_SYSTEM_LOGOS));
  document.body.removeAttribute('style');
});

describe('home page', () => {
  it('without a left system logo: the logo of ArenaLive, in the variant of the background', () => {
    document.body.style.backgroundColor = '#ffffff';
    const light = renderHome();
    const img = screen.getByRole('img', { name: 'ArenaLive' });
    expect(img.getAttribute('src')).toBe('/brand/arenalive-positivo.png');
    expect(img.getAttribute('data-product-logo')).toBe('positive');
    expect(img.closest('.justify-center')).not.toBeNull();
    expect(document.querySelector('[data-system-logo]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'ArenaLive' }).className).toContain('sr-only');
    expect(screen.getByText('Per seguire una partita apri il link che ti è stato inviato.')).toBeTruthy();
    light.unmount();
    document.body.style.backgroundColor = '#0b0b0d';
    renderHome();
    expect(screen.getByRole('img', { name: 'ArenaLive' }).getAttribute('src')).toBe('/brand/arenalive-negativo.png');
  });

  it('with a left system logo: the logo centred, in the variant of the background; the name only for screen readers', () => {
    act(() => setSystemLogos({ left: { positive: LOGO, negative: DARK }, right: NO_SYSTEM_LOGOS.right }));
    document.body.style.backgroundColor = '#0f1729';
    renderHome();
    const img = document.querySelector('[data-system-logo="sinistra"]');
    expect(img?.getAttribute('src')).toBe(DARK.url);
    expect(img?.getAttribute('data-system-logo-variant')).toBe('negative');
    expect(img?.closest('.justify-center')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'ArenaLive' }).className).toContain('sr-only');
  });
});
