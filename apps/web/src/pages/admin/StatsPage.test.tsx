import type { StatsCurve, StatsNow, StatsOverview } from '@sir/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { StatsPage } from './StatsPage.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const MATCH = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const overview: StatsOverview = {
  from: '2026-09-18',
  to: '2026-10-17',
  totals: {
    visits: 40,
    qrVisits: 10,
    appVisits: 4,
    totalSeconds: 4800,
    avgSeconds: 120,
    peak: 25,
    peakAt: '2026-10-10T17:30:00.000Z',
  },
  devices: { tv: 2, tablet: 8, phone: 30 },
  matches: [
    {
      matchId: MATCH,
      label: 'Perugia – Trento',
      visits: 40,
      qrVisits: 10,
      totalSeconds: 4800,
      avgSeconds: 120,
      peak: 25,
      peakAt: '2026-10-10T17:30:00.000Z',
    },
  ],
  links: [
    {
      shareTokenId: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11',
      label: 'Tribuna',
      kind: 'channel',
      visits: 40,
      qrVisits: 10,
      avgSeconds: 120,
    },
  ],
  daily: [{ day: '2026-10-10', visits: 40, totalSeconds: 4800, peak: 25 }],
};
const now: StatsNow = {
  viewers: 7,
  live: { matchId: MATCH, label: 'Perugia – Trento' },
  matches: [{ matchId: MATCH, label: 'Perugia – Trento', viewers: 7 }],
  links: [{ label: 'Tribuna', viewers: 7 }],
};
const curve: StatsCurve = {
  matchId: MATCH,
  points: [
    { at: '2026-10-10T17:00:00.000Z', viewers: 5 },
    { at: '2026-10-10T17:01:00.000Z', viewers: 25 },
  ],
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const answer = (call: { url: string }) => {
  if (call.url.startsWith('/api/admin/stats/now')) return { body: now };
  if (call.url.includes('/curve')) return { body: curve };
  return { body: overview };
};

describe('StatsPage', () => {
  it('shows who is connected now, the totals, the matches, the links and the devices', async () => {
    mockApi(answer);
    renderAs('viewer', <StatsPage />);
    expect(await screen.findByText('spettatori collegati')).toBeTruthy();
    expect(screen.getByText('Partita live: Perugia – Trento')).toBeTruthy();
    const totals = await screen.findByRole('region', { name: 'In sintesi' }).catch(() => null);
    expect(totals ?? screen.getByText('In sintesi')).toBeTruthy();
    expect(await screen.findByText('10 (25%)', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('2 min 00 s', { selector: 'dd' })).toBeTruthy();
    const table = screen.getAllByRole('table')[0] as HTMLElement;
    expect(within(table).getByText('Perugia – Trento')).toBeTruthy();
    expect(screen.getByText('Canale del club')).toBeTruthy();
    expect(screen.getByText('30 (75%)')).toBeTruthy();
    expect(screen.getByText('4 (10%)')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Visite e picco di spettatori per giornata' })).toBeTruthy();
  });

  it('asks the period chosen and opens the curve of a match', async () => {
    const calls = mockApi(answer);
    renderAs('admin', <StatsPage />);
    await screen.findByText('Tribuna', { selector: 'td' });
    expect(calls.some((c) => /^\/api\/admin\/stats\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(c.url))).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: '7 giorni' }));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/admin/stats?')).length).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Curva spettatori' }));
    expect(await screen.findByRole('img', { name: /Spettatori collegati minuto per minuto/ })).toBeTruthy();
    expect(calls.some((c) => c.url === `/api/admin/stats/matches/${MATCH}/curve`)).toBe(true);
  });

  it('downloads the CSV of the period', async () => {
    mockApi(answer);
    const create = vi.fn(() => 'blob:csv');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderAs('viewer', <StatsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta CSV' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalled();
  });

  it('shows an error in Italian with a retry, and an empty state without visits', async () => {
    mockApi((call) =>
      call.url.startsWith('/api/admin/stats/now')
        ? { body: { ...now, viewers: 0, live: null, links: [], matches: [] } }
        : { body: { error: 'x' }, status: 500 },
    );
    renderAs('viewer', <StatsPage />);
    expect(await screen.findByText('Errore del server: riprova più tardi.')).toBeTruthy();
    expect(screen.getByText('Nessuna partita live in questo momento.')).toBeTruthy();
    cleanup();
    mockApi((call) =>
      call.url.startsWith('/api/admin/stats/now')
        ? { body: { ...now, viewers: 0, live: null, links: [], matches: [] } }
        : { body: { ...overview, matches: [], links: [], daily: [], totals: { ...overview.totals, visits: 0 } } },
    );
    renderAs('viewer', <StatsPage />);
    expect((await screen.findAllByText('Nessuna visita nel periodo.')).length).toBeGreaterThan(0);
  });
});
