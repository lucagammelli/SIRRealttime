import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicTenantResponse } from '@sir/shared';
import {
  contrastRatio,
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  MIN_TEXT_CONTRAST,
  TEMPLATES,
} from '@sir/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandMark } from '../components/BrandMark.tsx';
import { CourtMap } from '../components/CourtMap.tsx';
import { MatchView } from '../components/MatchView.tsx';
import { TemplateFooter } from '../components/TemplateFooter.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { stateAfter } from '../test/fixtures.ts';
import { claimOurSide, currentOurSide, initTemplate, setTenantLook, tenantLookOf } from './branding.ts';
import { teamColorVars } from './teamColors.ts';
import { applyThemeChoice, currentTheme, forcedTheme } from './theme.ts';

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Declarations of the first rule of tokens.css whose selector starts with `selector` (outside media queries). */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector}`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const vars: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--sir-[a-z0-9-]+):\s*([^;]+);/g))
    vars[m[1] ?? ''] = (m[2] ?? '').trim();
  return vars;
}

const SIR = block(":root[data-template='sir-volley'],");

const tenant = (branding: Partial<PublicTenantResponse['branding']>): PublicTenantResponse => ({
  name: 'Sir Safety',
  branding: { ...defaultBranding(), ...branding },
  images: { logoMain: null, logoMark: null, sponsorLogo: null },
  layout: defaultLayout(),
  intermissions: defaultIntermissions(),
  overlays: defaultOverlays(),
});

const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name);

afterEach(() => {
  cleanup();
  act(() => setTenantLook(null));
  applyThemeChoice('system');
  window.localStorage.clear();
});

describe('tokens of the template «SIR VOLLEY»', () => {
  it('has the whole palette of the specifications', () => {
    expect(SIR).toMatchObject({
      '--sir-bg': '#0b0b0d',
      '--sir-surface': '#151518',
      '--sir-surface-2': '#1c1c20',
      '--sir-text': '#ffffff',
      '--sir-text-muted': '#a6a6ac',
      '--sir-accent': '#e30613',
      '--sir-border': '#303036',
      '--sir-hover': '#252529',
      '--sir-table-head': '#202024',
      '--sir-table-alt': '#1c1c20',
      '--sir-table-selected': '#292024',
      '--sir-table-indicator': '#e30613',
      '--sir-grid': '#303036',
      '--sir-axis': '#55555c',
      '--sir-chart-axis': '#55555c',
      '--sir-chart-secondary': '#77777f',
      '--sir-seg-active': '#e30613',
      '--sir-on-seg-active': '#ffffff',
      '--sir-seg-bg': '#1c1c20',
      '--sir-seg-text': '#a6a6ac',
      '--sir-radius-button': '8px',
      '--sir-radius-lg': '14px',
      '--sir-card-pad': '16px',
      '--sir-gap': '16px',
      '--sir-opponent': '#ffffff',
    });
    expect(SIR['--sir-font-sans']).toMatch(/^'Google Sans Code'/);
  });

  it('keeps the colours of the template in @sir/shared equal to the tokens', () => {
    const colors = TEMPLATES['sir-volley'].colors;
    expect(SIR['--sir-primary']).toBe(colors.primary);
    expect(SIR['--sir-accent']).toBe(colors.accent);
    expect(SIR['--sir-home']).toBe(colors.home);
    expect(SIR['--sir-away']).toBe(colors.away);
    expect(SIR['--sir-bg']).toBe(colors.background);
    expect(SIR['--sir-surface']).toBe(TEMPLATES['sir-volley'].darkSurface);
    expect(SIR['--sir-table-head']).toBe(TEMPLATES['sir-volley'].darkInkSurface);
  });

  it('has text with a contrast of at least 4.5:1 on every panel', () => {
    const panels = ['--sir-bg', '--sir-surface', '--sir-surface-2', '--sir-table-head', '--sir-hover'].map(
      (k) => SIR[k] ?? '',
    );
    const texts = ['--sir-text', '--sir-text-muted', '--sir-home-ink', '--sir-away-ink', '--sir-our-ink'];
    for (const text of texts)
      for (const panel of panels.filter((p) => p !== SIR['--sir-hover'] || text.endsWith('text')))
        expect(contrastRatio(SIR[text] ?? '', panel), `${text} su ${panel}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    // The secondary text on the card: about 7.5:1.
    expect(contrastRatio('#a6a6ac', '#151518')).toBeGreaterThan(7);
    // Text on the red and on the white of the teams and of the active buttons.
    expect(contrastRatio(SIR['--sir-on-home'] ?? '', SIR['--sir-home'] ?? '')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SIR['--sir-on-away'] ?? '', SIR['--sir-away'] ?? '')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', SIR['--sir-seg-active'] ?? '')).toBeGreaterThanOrEqual(4.5);
    // Team colour as small text on its own tint.
    expect(contrastRatio(SIR['--sir-home-ink'] ?? '', SIR['--sir-home-soft'] ?? '')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(SIR['--sir-away-ink'] ?? '', SIR['--sir-away-soft'] ?? '')).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the pure red only for fills and big text (3:1)', () => {
    expect(contrastRatio('#e30613', '#151518')).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(contrastRatio('#e30613', '#151518')).toBeGreaterThanOrEqual(3);
    expect(SIR['--sir-home-ink']).not.toBe('#e30613');
  });
});

describe('template of the client', () => {
  it('writes data-template and forces the dark theme, then gives the choice back', () => {
    applyThemeChoice('light');
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'sir-volley' }))));
    const root = document.documentElement;
    expect(root.getAttribute('data-template')).toBe('sir-volley');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(forcedTheme()).toBe('dark');
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'standard' }))));
    expect(root.hasAttribute('data-template')).toBe(false);
    expect(forcedTheme()).toBeNull();
  });

  it('hides the light/dark switch only while the theme is forced', () => {
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'sir-volley' }))));
    const { rerender } = render(<ThemeToggle />);
    expect(screen.queryByRole('button', { name: /Passa al tema/ })).toBeNull();
    act(() => setTenantLook(tenantLookOf(tenant({}))));
    rerender(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /Passa al tema/ })).toBeTruthy();
  });

  it('remembers the template for the next visit and applies it before the graphics arrive', () => {
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'sir-volley' }))));
    expect(window.localStorage.getItem('sir-template')).toBe('sir-volley');
    document.documentElement.removeAttribute('data-template');
    initTemplate();
    expect(document.documentElement.getAttribute('data-template')).toBe('sir-volley');
    window.localStorage.setItem('sir-template', 'inventato');
    document.documentElement.removeAttribute('data-template');
    initTemplate();
    expect(document.documentElement.hasAttribute('data-template')).toBe(false);
  });

  it('shows the logo of the template in the navbar (link to the dashboard) and the credit in the footer', () => {
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'sir-volley' }))));
    render(
      <MemoryRouter>
        <BrandMark to="/admin/live" />
        <TemplateFooter />
      </MemoryRouter>,
    );
    const logo = screen.getByRole('img', { name: 'SIR Real Time' });
    expect(logo.getAttribute('src')).toBe('/templates/sir-volley/logo-sir-realtime.png');
    expect(logo.closest('a')?.getAttribute('href')).toBe('/admin/live');
    const footer = screen.getByRole('contentinfo');
    expect(footer.querySelector('img')?.getAttribute('alt')).toBe('Powered by Istante®');
    expect(footer.className).toContain('md:justify-end');
  });

  it('has no footer and the logo of the client in the standard template', () => {
    act(() => setTenantLook(tenantLookOf(tenant({}))));
    render(
      <MemoryRouter>
        <BrandMark />
        <TemplateFooter />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(screen.queryByRole('img', { name: 'SIR Real Time' })).toBeNull();
  });
});

describe('colours of our team', () => {
  it('points the sides to our colour and to the opponent', () => {
    expect(teamColorVars(null)).toEqual({});
    const home = teamColorVars('home');
    expect(home['--sir-home']).toBe('var(--sir-our)');
    expect(home['--sir-home-ink']).toBe('var(--sir-our-ink)');
    expect(home['--sir-on-home']).toBe('var(--sir-on-our)');
    expect(home['--sir-away']).toBe('var(--sir-opponent)');
    expect(home['--sir-away-soft']).toBe('var(--sir-opponent-soft)');
    const away = teamColorVars('away');
    expect(away['--sir-home']).toBe('var(--sir-opponent)');
    expect(away['--sir-away']).toBe('var(--sir-our)');
    expect(Object.keys(away).sort()).toEqual(Object.keys(home).sort());
  });

  it('follows the match on screen: our team away takes our colour, over the colours of the client', () => {
    const state = stateAfter();
    const look = tenantLookOf(
      tenant({ template: 'sir-volley', colors: { home: '#00ff00' }, ourTeam: { code: null, name: 'lugo' } }),
    );
    act(() => setTenantLook(look));
    expect(rootVar('--sir-home')).not.toBe('var(--sir-opponent)');
    const { unmount } = render(<MatchView state={state} device="tablet" />);
    expect(currentOurSide()).toBe('away');
    expect(rootVar('--sir-away')).toBe('var(--sir-our)');
    expect(rootVar('--sir-home')).toBe('var(--sir-opponent)');
    unmount();
    expect(currentOurSide()).toBeNull();
    // Back to the colours of the client.
    expect(rootVar('--sir-home')).not.toBe('var(--sir-opponent)');
  });

  it('keeps home and away colours when no team matches, and gives the last claim the precedence', () => {
    act(() => setTenantLook(tenantLookOf(tenant({ ourTeam: { code: 'TRE', name: null } }))));
    const { unmount } = render(<MatchView state={stateAfter()} device="tablet" />);
    expect(currentOurSide()).toBeNull();
    expect(rootVar('--sir-home')).toBe('');
    const release = claimOurSide('home');
    expect(rootVar('--sir-home')).toBe('var(--sir-our)');
    release();
    expect(rootVar('--sir-home')).toBe('');
    unmount();
  });
});

describe('scoreboard of the template', () => {
  it('draws the scoreboard of the mockup with the headline of the match', () => {
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'sir-volley' }))));
    const state = stateAfter();
    render(<MatchView state={state} device="tablet" />);
    const board = screen.getByRole('region', { name: 'Tabellone' });
    expect(board.getAttribute('data-variant')).toBe('template');
    expect(screen.getByText('Partita conclusa')).toBeTruthy();
    expect(screen.getByText('Vince')).toBeTruthy();
    expect(screen.getByLabelText('Set vinti Casa').textContent).toBe(String(state.setsWon.home));
    expect(screen.getAllByRole('listitem', { hidden: false }).length).toBeGreaterThan(0);
    // Default page of the template without a layout of the client: three cards in a row.
    const cells = Array.from(document.querySelector('[data-layout="tablet"]')?.children ?? []);
    expect(cells.map((c) => c.className.match(/@min-\[1150px\]:col-span-(\d+)/)?.[1])).toEqual([
      '12',
      '4',
      '4',
      '4',
      '8',
      '4',
    ]);
  });
});

describe('court maps of the template', () => {
  it('draws thin arrows (1.5 px, 85%) in the colour of the attacking team', () => {
    act(() => setTenantLook(tenantLookOf(tenant({ template: 'sir-volley' }))));
    const { container } = render(<CourtMap state={stateAfter()} />);
    const arrows = Array.from(container.querySelectorAll('path[marker-end]'));
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      expect(a.getAttribute('stroke-width')).toBe('1.5');
      expect(a.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(a.getAttribute('stroke-opacity')).toBe('0.85');
      expect(a.getAttribute('class')).toBe('stroke-home');
    }
  });

  it('keeps the arrows of the evaluations in the standard template', () => {
    const { container } = render(<CourtMap state={stateAfter()} />);
    const arrows = Array.from(container.querySelectorAll('path[marker-end]'));
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.every((a) => (a.getAttribute('class') ?? '').startsWith('stroke-eval-'))).toBe(true);
  });
});
