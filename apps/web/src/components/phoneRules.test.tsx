import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceContext } from '../lib/useLayout.ts';
import { stateAfter } from '../test/fixtures.ts';
import { CourtMap } from './CourtMap.tsx';
import { PlayerTable } from './PlayerTable.tsx';
import { Rotations } from './Rotations.tsx';

afterEach(cleanup);

const onPhone = (node: ReactNode) => render(<DeviceContext.Provider value="phone">{node}</DeviceContext.Provider>);
const headers = () =>
  screen
    .getAllByRole('columnheader')
    .map((h) => h.textContent?.replace(/[▲▼]/g, '').trim())
    .filter(Boolean);

describe('rules of the phone', () => {
  it('shows the compact players table with the essential columns, the whole one on request', () => {
    onPhone(<PlayerTable state={stateAfter()} />);
    expect(headers()).toEqual(['N.', 'Giocatore', 'Punti', 'Att. %', 'Ace', 'Muro', 'Errori']);
    const region = screen.getByRole('region', { name: /Tabella giocatori/ });
    expect(region.className).toContain('overflow-y-auto');
    expect(region.querySelector('thead')?.className).toContain('sticky');
    fireEvent.click(screen.getByRole('button', { name: 'Tutte le colonne' }));
    expect(headers().length).toBeGreaterThan(10);
  });

  it('keeps the whole table on the tablet and highlights the selected player', () => {
    render(<PlayerTable state={stateAfter()} />);
    expect(screen.queryByRole('button', { name: 'Tutte le colonne' })).toBeNull();
    expect(headers()).toContain('Attacco');
    const first = screen
      .getAllByRole('button', { name: /./, pressed: false })
      .find((b) => b.title === 'Evidenzia il giocatore');
    if (!first) throw new Error('no player');
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.closest('tr')?.getAttribute('data-selected')).toBe('true');
  });

  it('shows one team at a time in the rotations, with the legend «Vinti / Persi»', () => {
    const state = stateAfter();
    onPhone(<Rotations state={state} />);
    expect(screen.getAllByRole('list', { name: 'Legenda' })).toHaveLength(1);
    const team = screen.getByRole('radiogroup', { name: 'Squadra' });
    fireEvent.click(within(team).getAllByRole('radio')[1] as HTMLElement);
    expect(within(team).getAllByRole('radio')[1]?.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Vinti')).toBeTruthy();
    expect(screen.getByText('Persi')).toBeTruthy();
  });

  it('puts the player and evaluation filters of the court maps in an expandable menu', () => {
    onPhone(<CourtMap state={stateAfter()} />);
    const details = screen.getByText('Altri filtri').closest('details');
    expect(details).toBeTruthy();
    expect(within(details as HTMLElement).getByRole('radiogroup', { name: 'Valutazione' })).toBeTruthy();
    cleanup();
    render(<CourtMap state={stateAfter()} />);
    expect(screen.queryByText('Altri filtri')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Valutazione' })).toBeTruthy();
  });
});
