import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { Scoreboard } from './Scoreboard.tsx';

afterEach(cleanup);

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
});
