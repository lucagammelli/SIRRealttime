import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { LiveMatch } from './LiveMatch.tsx';
import { MatchView } from './MatchView.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

afterEach(cleanup);

const MATCH_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const snap = (patch: Partial<LiveSnapshot>): LiveSnapshot => ({
  status: 'live',
  data: null,
  error: null,
  attempts: 0,
  ...patch,
});

describe('MatchView', () => {
  it('renders every section of a match in progress', () => {
    render(<MatchView state={midMatchState()} />);
    for (const title of [
      'Andamento del set',
      'Confronto squadre',
      'Statistiche giocatori',
      'Mappe di campo',
      'Rotazioni',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(4);
  });

  it('sorts the player table and switches team and filters', () => {
    const state = stateAfter();
    render(<MatchView state={state} />);
    const table = screen.getByRole('table', { name: /Statistiche dei giocatori di Pallavolo Città/ });
    const rows = within(table).getAllByRole('row').slice(2);
    expect(rows.length).toBe(Object.keys(state.stats.home.players).length);
    fireEvent.click(within(table).getByTitle('Ordina per: Numero di maglia'));
    const numbers = within(table)
      .getAllByRole('row')
      .slice(2)
      .map((r) => Number(r.querySelector('td')?.textContent));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    const teamSwitch = screen.getAllByRole('radiogroup', { name: 'Squadra' })[0];
    fireEvent.click(within(teamSwitch as HTMLElement).getByRole('radio', { name: 'Volley Club Lugo' }));
    expect(screen.getByRole('table', { name: /Volley Club Lugo/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '# Punto' }));
    expect(screen.getByRole('radio', { name: '# Punto' }).getAttribute('aria-checked')).toBe('true');
  });

  it('has a big-screen layout with only score, trend and comparison', () => {
    render(<MatchView state={midMatchState()} tv />);
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Statistiche giocatori' })).toBeNull();
  });
});

describe('LiveMatch states', () => {
  it('shows the messages of every connection state', () => {
    const { rerender } = render(<LiveMatch snapshot={snap({ status: 'invalid' })} />);
    expect(screen.getByText('Link non valido o scaduto')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ status: 'reconnecting', attempts: 2 })} />);
    expect(screen.getByText('Server non raggiungibile')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ status: 'connecting' })} />);
    expect(screen.getByText('Connessione in corso…')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ data: { kind: 'noMatch' } })} />);
    expect(screen.getByText('Nessuna partita in corso')).toBeTruthy();
    expect(screen.getByText('In diretta')).toBeTruthy();
    rerender(
      <LiveMatch
        snapshot={snap({
          status: 'reconnecting',
          data: { kind: 'state', matchId: MATCH_ID, version: 1, state: midMatchState() },
        })}
      />,
    );
    expect(screen.getByText('Riconnessione…')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
  });

  it('says «Risultato finale» instead of «In diretta» once the match is over', () => {
    const final = { kind: 'state', matchId: MATCH_ID, version: 9, state: stateAfter() } as const;
    const { rerender } = render(<LiveMatch snapshot={snap({ data: final })} />);
    expect(screen.getByText('Partita conclusa')).toBeTruthy();
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    expect(screen.queryByText('In diretta')).toBeNull();
    rerender(<LiveMatch snapshot={snap({ status: 'reconnecting', data: final })} />);
    expect(screen.getByText('Riconnessione…')).toBeTruthy();
    rerender(<LiveMatch snapshot={snap({ data: { ...final, state: midMatchState() } })} />);
    expect(screen.getByText('In diretta')).toBeTruthy();
  });
});
