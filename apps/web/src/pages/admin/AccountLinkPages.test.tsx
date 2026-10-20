import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SYSTEM_LOGOS } from '@sir/shared';
import { setSystemLogos } from '../../lib/systemLogos.ts';
import { mockApi } from '../../test/adminPage.tsx';
import { ForgotPasswordPage, SetPasswordPage } from './AccountLinkPages.tsx';
import { LoginPage } from './LoginPage.tsx';

const TOKEN = 'T'.repeat(43);
const AT = '2026-10-20T10:00:00.000Z';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/admin" element={<p>Area riservata</p>} />
        <Route path="/admin/password-dimenticata" element={<ForgotPasswordPage />} />
        <Route path="/admin/invito/:token" element={<SetPasswordPage kind="invite" />} />
        <Route path="/admin/reimposta-password/:token" element={<SetPasswordPage kind="reset" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  setSystemLogos(NO_SYSTEM_LOGOS);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Password dimenticata?»', () => {
  it('is linked from the login', () => {
    render(
      <MemoryRouter>
        <LoginPage onLogin={() => undefined} notice={null} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Password dimenticata?' }).getAttribute('href')).toBe(
      '/admin/password-dimenticata',
    );
  });

  it('asks for the email and gives one answer whatever the server knows', async () => {
    const calls = mockApi(() => ({ body: { ok: true } }));
    renderAt('/admin/password-dimenticata');
    fireEvent.click(screen.getByRole('button', { name: 'Invia il link' }));
    expect(await screen.findByText('Scrivi la tua email.')).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Qualcuno@Sir.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia il link' }));
    expect(await screen.findByText(/Se l’indirizzo è registrato/)).toBeTruthy();
    expect(calls[0]).toMatchObject({
      url: '/api/auth/password-reset/request',
      method: 'POST',
      body: { email: 'qualcuno@sir.test' },
    });
  });

  it('shows the limit of requests', async () => {
    mockApi(() => ({ body: { error: 'x' }, status: 429 }));
    renderAt('/admin/password-dimenticata');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@sir.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia il link' }));
    expect(await screen.findByText('Troppe richieste: riprova tra un minuto.')).toBeTruthy();
  });
});

describe('page of the invitation', () => {
  const info = { kind: 'invite', email: 'nuovo@sir.test', tenantName: 'Club A', expiresAt: AT };

  it('shows who is invited and logs in after the first password', async () => {
    const calls = mockApi((call) =>
      call.method === 'POST'
        ? {
            body: { id: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', email: 'nuovo@sir.test', role: 'viewer', tenant: null },
          }
        : { body: info },
    );
    renderAt(`/admin/invito/${TOKEN}`);
    expect(await screen.findByText(/Sei stato invitato su Club A/)).toBeTruthy();
    expect(screen.getByText('nuovo@sir.test')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    expect(await screen.findByText('La password deve avere almeno 12 caratteri.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'prima-password-1' } });
    fireEvent.change(screen.getByLabelText('Ripeti la password'), { target: { value: 'altra-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    expect(await screen.findByText('Le due password non coincidono.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ripeti la password'), { target: { value: 'prima-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva e accedi' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/auth/invite/accept',
      body: { token: TOKEN, password: 'prima-password-1' },
    });
  });

  it('says so when the link is wrong, used or expired', async () => {
    mockApi(() => ({ body: { error: 'Il link non è valido o è scaduto' }, status: 410 }));
    renderAt(`/admin/invito/${TOKEN}`);
    expect(await screen.findByText(/Il link non è valido o è scaduto/)).toBeTruthy();
    expect(screen.getByText(/Chiedi all’amministratore di invitarti di nuovo/)).toBeTruthy();
    expect(screen.queryByLabelText('Password', { exact: false })).toBeNull();
  });
});

describe('page of the new password', () => {
  it('sets the password and sends back to the login', async () => {
    const calls = mockApi((call) =>
      call.method === 'POST'
        ? { body: { ok: true } }
        : { body: { kind: 'reset', email: 'a@sir.test', tenantName: 'Club A', expiresAt: AT } },
    );
    renderAt(`/admin/reimposta-password/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Nuova password' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'password-nuova-1' } });
    fireEvent.change(screen.getByLabelText('Ripeti la password'), { target: { value: 'password-nuova-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva la password' }));
    expect(await screen.findByText(/La nuova password è pronta/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.url).toBe('/api/auth/password-reset/confirm');
    expect(screen.getByRole('link', { name: 'Torna all’accesso' }).getAttribute('href')).toBe('/admin');
  });

  it('offers a new request when the link has expired', async () => {
    mockApi(() => ({ body: { error: 'Il link non è valido o è scaduto' }, status: 410 }));
    renderAt(`/admin/reimposta-password/${TOKEN}`);
    expect(await screen.findByRole('link', { name: 'Password dimenticata?' })).toBeTruthy();
  });
});

describe('loghi di sistema on the login and on the pages of the account links', () => {
  const LOGO = {
    url: '/api/public/system-logos/00000000-0000-4000-8000-000000000001',
    mime: 'image/png',
    width: 150,
    height: 50,
  } as const;
  const renderLogin = () =>
    render(
      <MemoryRouter>
        <LoginPage onLogin={() => undefined} notice={null} />
      </MemoryRouter>,
    );

  it('without a left logo: the brand of the client (wordmark), no link', () => {
    setSystemLogos({ left: { positive: null, negative: null }, right: { positive: LOGO, negative: null } });
    renderLogin();
    expect(screen.getByText('Realtime')).toBeTruthy();
    expect(document.querySelector('[data-system-logo]')).toBeNull();
  });

  it('with a left logo: the logo instead of the brand, without a link (nobody signed in)', () => {
    setSystemLogos({ left: { positive: null, negative: LOGO }, right: { positive: null, negative: null } });
    renderLogin();
    const img = document.querySelector('[data-system-logo="sinistra"]');
    expect(img?.getAttribute('src')).toBe(LOGO.url);
    expect(img?.closest('a')).toBeNull();
    expect(screen.queryByText('Realtime')).toBeNull();
    cleanup();
    renderAt('/admin/password-dimenticata');
    expect(document.querySelector('[data-system-logo="sinistra"]')?.getAttribute('src')).toBe(LOGO.url);
    expect(screen.queryByText('Realtime')).toBeNull();
  });
});
