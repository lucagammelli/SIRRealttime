import { defaultBranding, defaultIntermissions, defaultLayout, defaultOverlays } from '@arenalive/shared';
import type { ClubLogoSize } from '@arenalive/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { claimOurSide, setTenantLook, tenantLookOf } from '../lib/branding.ts';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { Scoreboard } from './Scoreboard.tsx';

afterEach(() => {
  cleanup();
  act(() => setTenantLook(null));
});

const lookWith = (ourLogoSize: ClubLogoSize) =>
  tenantLookOf({
    name: 'Sir Safety',
    branding: { ...defaultBranding(), ourLogoSize },
    images: { logoMain: null, logoMark: null, sponsorLogo: null },
    layout: defaultLayout(),
    intermissions: defaultIntermissions(),
    overlays: defaultOverlays(),
    sponsors: [],
    players: [],
  });

/** Look of the club with the graphics «SIR VOLLEY» (scoreboard of the mockup). */
const templateLook = () =>
  tenantLookOf({
    name: 'Sir Safety',
    branding: { ...defaultBranding(), template: 'sir-volley' },
    images: { logoMain: null, logoMark: null, sponsorLogo: null },
    layout: defaultLayout(),
    intermissions: defaultIntermissions(),
    overlays: defaultOverlays(),
    sponsors: [],
    players: [],
  });

describe('Scoreboard', () => {
  it('shows teams, sets won and partials of the finished match', () => {
    const state = stateAfter();
    render(<Scoreboard state={state} />);
    const board = screen.getByRole('region', { name: 'Tabellone' });
    expect(within(board).getByText('Pallavolo Città')).toBeTruthy();
    expect(within(board).getByText('Volley Club Lugo')).toBeTruthy();
    expect(within(board).getByText('Partita conclusa')).toBeTruthy();
    expect(within(board).getByLabelText('Set vinti Casa').textContent).toBe(String(state.setsWon.home));
    expect(within(board).getByLabelText('Set vinti Ospiti').textContent).toBe(String(state.setsWon.away));
    expect(within(board).getByText('Vince')).toBeTruthy();
    const partials = within(board).getByRole('list', { name: 'Parziali dei set' });
    expect(within(partials).getAllByRole('listitem')).toHaveLength(state.sets.length);
    const first = state.sets[0];
    expect(within(partials).getAllByRole('listitem')[0]?.textContent).toContain(
      `${first?.homeScore}-${first?.awayScore}`,
    );
  });

  it('shows the live score, last point and timeouts during the match', () => {
    const state = midMatchState();
    render(<Scoreboard state={state} status={<span>stato-connessione</span>} />);
    expect(screen.getByText(`${state.live.set}° set in corso`)).toBeTruthy();
    expect(screen.getByText('stato-connessione')).toBeTruthy();
    expect(
      screen.getByText(
        `Punteggio del ${state.live.set}° set: Pallavolo Città ${state.live.homeScore}, Volley Club Lugo ${state.live.awayScore}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/^Punto (Casa|Ospiti)/)).toBeTruthy();
    expect(screen.getByText('in corso')).toBeTruthy();
    expect(screen.queryByText('Vince')).toBeNull();
  });

  it('shows the logos of the teams next to their names, and nothing where there is none', () => {
    const state = midMatchState();
    for (const device of ['tablet', 'phone', 'tv'] as const) {
      const { unmount } = render(
        <Scoreboard state={state} device={device} logos={{ home: '/api/public/assets/casa', away: null }} />,
      );
      const logos = screen.getAllByTestId('team-logo');
      expect(logos.map((l) => l.getAttribute('src'))).toEqual(['/api/public/assets/casa']);
      unmount();
    }
    render(<Scoreboard state={state} />);
    expect(screen.queryAllByTestId('team-logo')).toHaveLength(0);
  });

  it('gives the size chosen in «Club» only to the logo of our team', () => {
    act(() => setTenantLook(lookWith('large')));
    const release = claimOurSide('away');
    const logos = { home: '/api/public/assets/casa', away: '/api/public/assets/club' };
    const { unmount } = render(<Scoreboard state={midMatchState()} device="tablet" logos={logos} />);
    const [home, away] = screen.getAllByTestId('team-logo');
    expect(home?.getAttribute('class')).toContain('size-10');
    expect(away?.getAttribute('class')).toContain('size-14');
    unmount();
    render(<Scoreboard state={midMatchState()} device="tv" logos={logos} />);
    expect(screen.getAllByTestId('team-logo')[1]?.getAttribute('class')).toContain('size-24');
    act(() => setTenantLook(lookWith('small')));
    expect(screen.getAllByTestId('team-logo')[1]?.getAttribute('class')).toContain('size-12');
    expect(screen.getAllByTestId('team-logo')[0]?.getAttribute('class')).toContain('size-16');
    act(release);
  });

  it('mirrors the sides on every device: home «dot, logo, name, sets», away «sets, name, logo, dot»', () => {
    const logos = { home: '/h', away: '/a' };
    const cases = [
      ...(['tablet', 'phone', 'tv'] as const).map((device) => [device, 'standard'] as const),
      ['tablet', 'mockup'] as const,
      ['tv', 'mockup'] as const,
    ];
    for (const [device, variant] of cases) {
      if (variant === 'mockup') act(() => setTenantLook(templateLook()));
      const { container, unmount } = render(<Scoreboard state={midMatchState()} device={device} logos={logos} />);
      const order = (side: string) =>
        Array.from(container.querySelector(`[data-side="${side}"]`)?.children ?? []).map((el) => {
          if (el.getAttribute('data-testid') === 'team-logo') return 'logo';
          if (el.tagName === 'H2') return 'name';
          if (el.querySelector('[aria-label^="Set vinti"]')) return 'sets';
          return 'dot';
        });
      expect(order('home')).toEqual(['dot', 'logo', 'name', 'sets']);
      expect(order('away')).toEqual(['sets', 'name', 'logo', 'dot']);
      unmount();
      act(() => setTenantLook(null));
    }
  });

  it('writes the short name on tablet and phone (full name for screen readers) and the full one on the TV', () => {
    const state = midMatchState();
    for (const device of ['tablet', 'phone'] as const) {
      const { container, unmount } = render(<Scoreboard state={state} device={device} />);
      const h2 = container.querySelector('[data-side="away"] h2');
      expect(h2?.querySelector('[aria-hidden="true"]')?.textContent).toBe('VOL');
      expect(h2?.querySelector('.sr-only')?.textContent).toBe('Volley Club Lugo');
      unmount();
    }
    const tv = render(<Scoreboard state={state} device="tv" />);
    expect(tv.container.querySelector('[data-side="away"] h2')?.textContent).toBe('Volley Club Lugo');
    tv.unmount();
    // Scoreboard of the club graphics (template «SIR VOLLEY»).
    act(() => setTenantLook(templateLook()));
    const tablet = render(<Scoreboard state={state} device="tablet" />);
    const h2 = tablet.container.querySelector('[data-side="away"] h2');
    expect(h2?.querySelector('[aria-hidden="true"]')?.textContent).toBe('VOL');
    expect(h2?.querySelector('.sr-only')?.textContent).toBe('Volley Club Lugo');
    tablet.unmount();
    const tvTemplate = render(<Scoreboard state={state} device="tv" />);
    expect(tvTemplate.container.querySelector('[data-side="away"] h2')?.textContent).toContain('Volley');
  });
});
