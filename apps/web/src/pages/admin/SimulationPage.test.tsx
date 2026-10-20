import type { SimulationResponse, SimulationSummary } from '@arenalive/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { formatClock, paceText, SimulationPage } from './SimulationPage.tsx';

const MATCH = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const summary = (over: Partial<SimulationSummary> = {}): SimulationSummary => ({
  matchId: MATCH,
  status: 'running',
  source: 'Partita casuale (3 set, seme 4)',
  pace: { kind: 'duration', setSeconds: 20, breakSeconds: 10 },
  homeName: 'Sir Susa Perugia',
  awayName: 'Volley Club Lugo',
  set: 2,
  score: { home: 12, away: 10 },
  setsWon: { home: 1, away: 0 },
  linesSent: 400,
  linesTotal: 1000,
  elapsedMs: 35_000,
  totalMs: 80_000,
  remainingMs: 45_000,
  startedAt: '2026-10-17T10:00:00.000Z',
  endedAt: null,
  deleteAt: null,
  notice: null,
  link: { shortCode: 'K7M2QX9P', shortUrl: 'http://portale.test/l/K7M2QX9P' },
  ...over,
});

const response = (simulation: SimulationSummary | null): SimulationResponse => ({
  simulation,
  clubTeams: { home: 'Sir Susa Perugia', away: 'Volley Club Lugo' },
});

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Simulazione» page', () => {
  it('starts a generated match with the teams of the club and the duration of sets and breaks', async () => {
    let current: SimulationSummary | null = null;
    const calls = mockApi((call) => {
      if (call.method === 'POST' && call.url === '/api/admin/simulation') {
        current = summary({ linesSent: 3, set: 1, score: { home: 0, away: 0 }, setsWon: { home: 0, away: 0 } });
        return { body: response(current), status: 201 };
      }
      return { body: response(current) };
    });
    renderAs('admin', <SimulationPage />);
    expect(await screen.findByText(/Nessuna simulazione/)).toBeTruthy();
    expect(screen.getByText('Sir Susa Perugia – Volley Club Lugo')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '5 set' }));
    fireEvent.change(screen.getByLabelText('Durata di un set (s)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Pausa tra i set (s)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Avvia' }));
    await screen.findByTestId('simulation');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      source: { kind: 'generated', sets: 5, clubTeams: true },
      pace: { kind: 'duration', setSeconds: 20, breakSeconds: 10 },
    });
    expect(screen.getByText('In corso')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'http://portale.test/l/K7M2QX9P' })).toBeTruthy();
    // One at a time: the form waits for the end of this one.
    expect(screen.getByRole('button', { name: 'Avvia' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Una simulazione alla volta/)).toBeTruthy();
  });

  it('starts a random match with a speed and a seed', async () => {
    const calls = mockApi((call) =>
      call.method === 'POST' ? { body: response(summary()), status: 201 } : { body: response(null) },
    );
    renderAs('admin', <SimulationPage />);
    fireEvent.change(await screen.findByLabelText(/Seme/), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Velocità' }));
    fireEvent.click(screen.getByRole('radio', { name: '10×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avvia' }));
    await screen.findByTestId('simulation');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      source: { kind: 'generated', sets: 3, clubTeams: true, seed: 14 },
      pace: { kind: 'speed', speed: 10 },
    });
  });

  it('refuses a duration out of the limits and a missing file before calling the server', async () => {
    const calls = mockApi(() => ({ body: response(null) }));
    renderAs('admin', <SimulationPage />);
    fireEvent.change(await screen.findByLabelText('Durata di un set (s)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Avvia' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Durata di un set tra 10 e 3600 secondi/);
    fireEvent.click(screen.getByRole('radio', { name: 'Importa file .dvw' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avvia' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Scegli un file .dvw.');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('shows the progress from the server and sends the commands', async () => {
    let current = summary();
    const calls = mockApi((call) => {
      if (call.url === '/api/admin/simulation/pause') current = summary({ status: 'paused' });
      if (call.url === '/api/admin/simulation/resume') current = summary({ status: 'running', linesSent: 500 });
      if (call.url === '/api/admin/simulation/stop')
        current = summary({ status: 'stopped', remainingMs: 0, deleteAt: '2026-10-17T16:01:00.000Z' });
      return { body: response(current) };
    });
    renderAs('admin', <SimulationPage />);
    const box = await screen.findByTestId('simulation');
    expect(within(box).getByText('12-10')).toBeTruthy();
    expect(within(box).getByText('400 / 1000')).toBeTruthy();
    expect(within(box).getByText(/Trascorso 0:35 · rimanente 0:45/)).toBeTruthy();
    expect(within(box).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');

    fireEvent.click(within(box).getByRole('button', { name: 'Pausa' }));
    expect(await within(box).findByText('In pausa')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Riprendi' }));
    expect(await within(box).findByText('500 / 1000')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Ferma' }));
    expect(await within(box).findByText('Fermata')).toBeTruthy();
    expect(within(box).getByText(/si cancellano da soli/)).toBeTruthy();
    expect(within(box).queryByRole('button', { name: 'Pausa' })).toBeNull();
    expect(within(box).getByRole('button', { name: 'Ricomincia' })).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/admin/simulation/pause',
      '/api/admin/simulation/resume',
      '/api/admin/simulation/stop',
    ]);
  });

  it('reads the progress again every second while it runs', async () => {
    let reads = 0;
    mockApi(() => {
      reads++;
      return { body: response(summary({ linesSent: 400 + reads })) };
    });
    renderAs('admin', <SimulationPage />);
    await screen.findByTestId('simulation');
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(3), { timeout: 3500 });
    expect(screen.getByText(new RegExp(`${400 + reads - 1} / 1000|${400 + reads} / 1000`))).toBeTruthy();
  });

  it('deletes match and link with a confirmation; after a restart of the server only «Elimina» and a new start', async () => {
    let current: SimulationSummary | null = summary({
      status: 'stopped',
      pace: null,
      notice: 'La simulazione si è interrotta con il riavvio del server: puoi ricominciarla da capo.',
    });
    const calls = mockApi((call) => {
      if (call.method === 'DELETE') {
        current = null;
        return null;
      }
      return { body: response(current) };
    });
    renderAs('admin', <SimulationPage />);
    const box = await screen.findByTestId('simulation');
    expect(within(box).getByText(/riavvio del server/)).toBeTruthy();
    expect(within(box).queryByRole('button', { name: 'Ricomincia' })).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: 'Elimina' }));
    fireEvent.click(within(box).getByRole('button', { name: 'Elimina partita e link' }));
    expect(await screen.findByText(/Nessuna simulazione/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/admin/simulation')).toBe(true);
  });

  it('shows the message of the server when a start is refused', async () => {
    mockApi((call) =>
      call.method === 'POST'
        ? { body: { error: 'Troppe simulazioni in corso sul server: riprova tra qualche minuto' }, status: 409 }
        : { body: response(null) },
    );
    renderAs('admin', <SimulationPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Avvia' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Troppe simulazioni in corso');
  });
});

describe('texts of the simulation', () => {
  it('formats times and paces', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_400)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(paceText({ kind: 'speed', speed: 5 })).toBe('Velocità 5× sul ritmo reale');
    expect(paceText({ kind: 'duration', setSeconds: 20, breakSeconds: 10 })).toBe(
      'Set da 20 s, pausa tra i set di 10 s',
    );
    expect(paceText(null)).toBe('Tempi non più disponibili');
  });
});
