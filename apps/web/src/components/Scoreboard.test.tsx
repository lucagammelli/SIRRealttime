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
    expect(screen.getByText(state.live.lastPoint?.label ?? '')).toBeTruthy();
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
});
