import type { AgentRegistrationSummary } from '@sir/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminApp } from './AdminApp.tsx';
import { AGENTS_REFRESH_MS } from './AgentsPage.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const REG_ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const pending = (over: Partial<AgentRegistrationSummary> = {}): AgentRegistrationSummary => ({
  id: REG_ID,
  name: 'PC DataVolley palestra',
  pairingCode: 'K7M2QX',
  ip: '192.168.1.20',
  createdAt: '2026-10-15T10:00:00.000Z',
  expiresAt: '2026-10-16T10:00:00.000Z',
  status: 'pending',
  ...over,
});

interface Call {
  url: string;
  method: string;
}

/** Fake server: `registrations` is the current list of pending requests (changed by approve/reject). */
function mockServer(initial: AgentRegistrationSummary[]): {
  calls: Call[];
  setRegistrations(r: AgentRegistrationSummary[]): void;
} {
  let registrations = initial;
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url === '/api/auth/me') return json({ id: USER_ID, email: 'a@b.it', role: 'admin' });
      if (url === '/api/admin/agent-registrations') return json(registrations);
      const decided = /^\/api\/admin\/agent-registrations\/([^/]+)\/(approve|reject)$/.exec(url);
      if (decided && method === 'POST') {
        const row = registrations.find((r) => r.id === decided[1]);
        if (!row) return json({ error: 'Non trovato' }, 404);
        registrations = registrations.filter((r) => r.id !== row.id);
        return json({ ...row, status: decided[2] === 'approve' ? 'approved' : 'rejected' });
      }
      return json([]);
    }),
  );
  return {
    calls,
    setRegistrations: (r) => {
      registrations = r;
    },
  };
}

function renderAgents() {
  return render(
    <MemoryRouter initialEntries={['/admin/agenti']}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const section = async (): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: 'Richieste in attesa' });
  const card = heading.closest('section');
  if (!card) throw new Error('no section');
  return card;
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pending agent registrations', () => {
  it('shows name, pairing code, address and the invitation to check the code', async () => {
    mockServer([pending()]);
    renderAgents();
    const card = await section();
    const item = await within(card).findByRole('listitem');
    expect(within(item).getByText('PC DataVolley palestra')).toBeTruthy();
    expect(within(item).getByTestId('pairing-code').textContent).toBe('K7M2QX');
    expect(within(item).getByText(/192\.168\.1\.20/)).toBeTruthy();
    expect(within(card).getByText(/Controlla che il codice sia quello mostrato sul PC/)).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Abilita' })).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Rifiuta' })).toBeTruthy();
  });

  it('shows an empty state without requests', async () => {
    mockServer([]);
    renderAgents();
    const card = await section();
    expect(await within(card).findByText('Nessuna richiesta in attesa.')).toBeTruthy();
  });

  it.each([
    ['Abilita', 'approve'],
    ['Rifiuta', 'reject'],
  ])('«%s» calls the server and reloads the list', async (label, action) => {
    const server = mockServer([pending()]);
    renderAgents();
    const card = await section();
    fireEvent.click(await within(card).findByRole('button', { name: label }));
    await waitFor(() =>
      expect(server.calls).toContainEqual({
        url: `/api/admin/agent-registrations/${REG_ID}/${action}`,
        method: 'POST',
      }),
    );
    expect(await within(card).findByText('Nessuna richiesta in attesa.')).toBeTruthy();
  });

  it('shows an error when the request is no longer pending', async () => {
    const server = mockServer([pending()]);
    renderAgents();
    const card = await section();
    const button = await within(card).findByRole('button', { name: 'Abilita' });
    server.setRegistrations([]);
    fireEvent.click(button);
    expect((await within(card).findByRole('alert')).textContent).toMatch(/non trovato/i);
  });

  it(`reloads the requests every ${AGENTS_REFRESH_MS / 1000} s while the page is open`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = mockServer([]);
    renderAgents();
    const card = await section();
    await within(card).findByText('Nessuna richiesta in attesa.');
    server.setRegistrations([pending({ name: 'PC nuovo', pairingCode: 'ABC234' })]);
    await act(() => vi.advanceTimersByTimeAsync(AGENTS_REFRESH_MS));
    expect(await within(card).findByText('PC nuovo')).toBeTruthy();
    const polls = server.calls.filter((c) => c.url === '/api/admin/agent-registrations').length;
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(server.calls.filter((c) => c.url === '/api/admin/agents').length).toBeGreaterThanOrEqual(2);
  });
});
