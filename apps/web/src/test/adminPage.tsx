import type { UserRole } from '@arenalive/shared';
import type { RenderResult } from '@testing-library/react';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../pages/admin/auth.tsx';

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Fake `fetch` of the admin API: `answer` gives the body (and status) of a call, null for a 204; every call is
 * recorded.
 */
export function mockApi(answer: (call: Call) => { body: unknown; status?: number } | null | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      };
      calls.push(call);
      const res = answer(call);
      if (res === null) return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(JSON.stringify(res?.body ?? []), { status: res?.status ?? 200 }));
    }),
  );
  return calls;
}

/**
 * A page of the reserved area on its own, for a user with `role` (the routes of AdminApp are not involved); with
 * `matchLinks` the user is in a client with or without «Link e QR per singola partita» (otherwise in no client).
 */
export function renderAs(role: UserRole, page: ReactElement, options: { matchLinks?: boolean } = {}): RenderResult {
  const tenant =
    options.matchLinks === undefined
      ? null
      : {
          id: '2b7e1c4d-9f3a-4e8b-a6d2-5c0f8e1b3a79',
          slug: 'club',
          name: 'Club',
          matchLinksEnabled: options.matchLinks,
        };
  const value = {
    user: { id: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', email: 'u@sir.test', role, tenant },
    isAdmin: role !== 'viewer',
    isSuperadmin: role === 'superadmin',
    updateUser: () => undefined,
    logout: () => Promise.resolve(),
    sessionExpired: () => undefined,
  };
  return render(
    <MemoryRouter>
      <AuthProvider value={value}>{page}</AuthProvider>
    </MemoryRouter>,
  );
}
