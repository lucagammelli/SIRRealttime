import type { UserSummary } from '@arenalive/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call } from '../../test/adminPage.tsx';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { UsersPage } from './UsersPage.tsx';

/** The user of `renderAs`. */
const ME = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const OTHER = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const AT = '2026-10-15T10:00:00.000Z';

const user = (
  id: string,
  email: string,
  role: 'admin' | 'viewer',
  disabled = false,
  invite: UserSummary['invite'] = null,
): UserSummary => ({
  id,
  email,
  role,
  createdAt: AT,
  disabled,
  invite,
});

/** Fake server with the users `start`; PATCH and DELETE change them (`refuse`: answer of a PATCH instead). */
function serve(start: UserSummary[], refuse?: { status: number; error: string }): Call[] {
  let list = start;
  return mockApi((call) => {
    const one = /^\/api\/admin\/users\/([^/]+)$/.exec(call.url);
    if (one && call.method === 'PATCH') {
      if (refuse) return { body: { error: refuse.error }, status: refuse.status };
      const changes = call.body as Partial<UserSummary> & { password?: string };
      const { password: _password, ...visible } = changes;
      list = list.map((u) => (u.id === one[1] ? { ...u, ...visible } : u));
      return { body: list.find((u) => u.id === one[1]) };
    }
    if (one && call.method === 'DELETE') {
      list = list.filter((u) => u.id !== one[1]);
      return null;
    }
    const invite = /^\/api\/admin\/users\/([^/]+)\/invite$/.exec(call.url);
    if (invite && call.method === 'POST') {
      const delivery = { mail: 'not_configured', link: 'http://portale.test/admin/invito/nuovo', expiresAt: AT };
      return { body: { ...list.find((u) => u.id === invite[1]), delivery } };
    }
    if (invite && call.method === 'DELETE') {
      list = list.filter((u) => u.id !== invite[1]);
      return null;
    }
    if (/^\/api\/admin\/users\/[^/]+\/reset-link$/.test(call.url))
      return { body: { link: 'http://portale.test/admin/reimposta-password/xyz', expiresAt: AT } };
    if (call.url === '/api/admin/users' && call.method === 'POST') {
      const b = call.body as { email: string; role: 'admin' | 'viewer'; password?: string };
      const created = user(
        '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
        b.email,
        b.role,
        false,
        b.password ? null : 'pending',
      );
      list = [...list, created];
      const delivery = b.password
        ? null
        : b.email.startsWith('posta')
          ? { mail: 'sent', link: null, expiresAt: AT }
          : { mail: 'not_configured', link: 'http://portale.test/admin/invito/abc', expiresAt: AT };
      return { body: { ...created, delivery }, status: 201 };
    }
    if (call.url === '/api/admin/users') return { body: list };
    return { body: [] };
  });
}

const rowOf = async (email: string): Promise<HTMLElement> => {
  const rows = await screen.findAllByTestId('user');
  const row = rows.find((r) => r.textContent?.includes(email));
  if (!row) throw new Error(`no row for ${email}`);
  return row;
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Utenti» page', () => {
  it('shows the roles with clear names and what each one can do', async () => {
    serve([user(ME, 'u@sir.test', 'admin'), user(OTHER, 'lettore@sir.test', 'viewer', true)]);
    renderAs('admin', <UsersPage />);
    const other = await rowOf('lettore@sir.test');
    expect(within(other).getByText(/Sola lettura · creato/)).toBeTruthy();
    expect(within(other).getByText('Disattivato')).toBeTruthy();
    const mine = await rowOf('u@sir.test');
    expect(within(mine).getByText(/Lettura e scrittura · creato/)).toBeTruthy();
    expect(within(mine).getByText('(tu)')).toBeTruthy();
    const roles = screen.getByRole('heading', { name: 'Ruoli' }).closest('section');
    if (!roles) throw new Error('no roles card');
    expect(within(roles).getByText(/Gestisce tutto il cliente/)).toBeTruthy();
    expect(within(roles).getByText(/senza poter cambiare nulla/)).toBeTruthy();
    // The new user form names the roles the same way.
    expect(screen.getByRole('option', { name: 'Lettura e scrittura' })).toBeTruthy();
  });

  it('offers to oneself only the new password', async () => {
    serve([user(ME, 'u@sir.test', 'admin')]);
    renderAs('admin', <UsersPage />);
    const mine = await rowOf('u@sir.test');
    expect(within(mine).getByRole('button', { name: 'Cambia password' })).toBeTruthy();
    for (const name of ['Cambia ruolo', 'Disattiva', 'Elimina'])
      expect(within(mine).queryByRole('button', { name })).toBeNull();
  });

  it('changes the role of a user', async () => {
    const calls = serve([user(ME, 'u@sir.test', 'admin'), user(OTHER, 'lettore@sir.test', 'viewer')]);
    renderAs('admin', <UsersPage />);
    const row = await rowOf('lettore@sir.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Cambia ruolo' }));
    fireEvent.change(within(row).getByLabelText('Ruolo di lettore@sir.test', { exact: false }), {
      target: { value: 'admin' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Salva ruolo' }));
    expect(await screen.findByText('Ruolo di lettore@sir.test: Lettura e scrittura.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/api/admin/users/${OTHER}`,
      body: { role: 'admin' },
    });
    await waitFor(async () =>
      expect(within(await rowOf('lettore@sir.test')).getByText(/Lettura e scrittura · creato/)).toBeTruthy(),
    );
  });

  it('sets a new password only when it is long enough', async () => {
    const calls = serve([user(ME, 'u@sir.test', 'admin'), user(OTHER, 'lettore@sir.test', 'viewer')]);
    renderAs('admin', <UsersPage />);
    const row = await rowOf('lettore@sir.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Reimposta password' }));
    const input = within(row).getByLabelText('Nuova password di lettore@sir.test', { exact: false });
    fireEvent.change(input, { target: { value: 'corta' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salva password' }));
    expect(await within(row).findByText('La password deve avere almeno 12 caratteri.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.change(input, { target: { value: 'una-password-lunga' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salva password' }));
    expect(await screen.findByText('Password di lettore@sir.test reimpostata.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ password: 'una-password-lunga' });
  });

  it('disables and deletes a user only after the confirmation', async () => {
    const calls = serve([user(ME, 'u@sir.test', 'admin'), user(OTHER, 'lettore@sir.test', 'viewer')]);
    renderAs('admin', <UsersPage />);
    let row = await rowOf('lettore@sir.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Disattiva' }));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.click(within(row).getByRole('button', { name: 'Conferma disattivazione' }));
    expect(await screen.findByText('lettore@sir.test disattivato.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ disabled: true });
    row = await rowOf('lettore@sir.test');
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Riattiva' })).toBeTruthy());
    fireEvent.click(within(row).getByRole('button', { name: 'Elimina' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(row).getByRole('button', { name: 'Conferma eliminazione' }));
    expect(await screen.findByText('lettore@sir.test eliminato.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(`/api/admin/users/${OTHER}`);
    await waitFor(() => expect(screen.queryByText('lettore@sir.test')).toBeNull());
  });

  it('shows the reason of a refusal of the server', async () => {
    const error = 'Il cliente deve avere almeno un utente attivo «Lettura e scrittura»';
    serve([user(ME, 'u@sir.test', 'admin'), user(OTHER, 'capo@sir.test', 'admin')], { status: 409, error });
    renderAs('superadmin', <UsersPage />);
    const row = await rowOf('capo@sir.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Disattiva' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Conferma disattivazione' }));
    expect(await within(row).findByText(`${error}.`)).toBeTruthy();
  });

  it('creates a user without a password: an invitation by mail', async () => {
    const calls = serve([user(ME, 'u@sir.test', 'admin')]);
    renderAs('admin', <UsersPage />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'posta@sir.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea e invita' }));
    expect(await screen.findByText('Invito inviato a posta@sir.test.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'posta@sir.test', role: 'viewer' });
    await waitFor(async () => expect(within(await rowOf('posta@sir.test')).getByText('Invito in attesa')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Copia link' })).toBeNull();
  });

  it('without a mail server shows the link to copy and says that the mail is not configured', async () => {
    serve([user(ME, 'u@sir.test', 'admin')]);
    renderAs('admin', <UsersPage />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'manuale@sir.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crea e invita' }));
    expect(await screen.findByText(/La posta non è configurata/)).toBeTruthy();
    expect(screen.getByText('http://portale.test/admin/invito/abc')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copia link' })).toBeTruthy();
  });

  it('keeps the password path: with a password the user is created at once', async () => {
    const calls = serve([user(ME, 'u@sir.test', 'admin')]);
    renderAs('admin', <UsersPage />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'diretto@sir.test' } });
    fireEvent.change(screen.getByLabelText('Password (facoltativa)', { exact: false }), {
      target: { value: 'una-password-lunga' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crea utente' }));
    expect(await screen.findByText('Utente diretto@sir.test creato.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ password: 'una-password-lunga' });
  });

  it('shows pending and expired invitations with «Invia di nuovo» and «Annulla invito»', async () => {
    const calls = serve([
      user(ME, 'u@sir.test', 'admin'),
      user(OTHER, 'invitato@sir.test', 'viewer', false, 'pending'),
      user('11111111-2222-4333-8444-555555555555', 'scaduto@sir.test', 'viewer', false, 'expired'),
    ]);
    renderAs('admin', <UsersPage />);
    const pending = await rowOf('invitato@sir.test');
    expect(within(pending).getByText('Invito in attesa')).toBeTruthy();
    expect(within(await rowOf('scaduto@sir.test')).getByText('Invito scaduto')).toBeTruthy();
    expect(within(pending).queryByRole('button', { name: 'Link per nuova password' })).toBeNull();

    fireEvent.click(within(pending).getByRole('button', { name: 'Invia di nuovo' }));
    expect(await screen.findByText('Invito di invitato@sir.test inviato di nuovo.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === `/api/admin/users/${OTHER}/invite`)).toBe(true);
    const again = await rowOf('invitato@sir.test');
    expect(await within(again).findByText('http://portale.test/admin/invito/nuovo')).toBeTruthy();
    expect(within(again).getByText(/La posta non è configurata/)).toBeTruthy();

    fireEvent.click(within(again).getByRole('button', { name: 'Annulla invito' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(again).getByRole('button', { name: 'Conferma annullamento' }));
    expect(await screen.findByText('Invito a invitato@sir.test annullato.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === `/api/admin/users/${OTHER}/invite`)).toBe(true);
    await waitFor(() => expect(screen.queryByText('invitato@sir.test')).toBeNull());
  });

  it('makes a link for a new password to copy', async () => {
    const calls = serve([user(ME, 'u@sir.test', 'admin'), user(OTHER, 'lettore@sir.test', 'viewer')]);
    renderAs('admin', <UsersPage />);
    const row = await rowOf('lettore@sir.test');
    fireEvent.click(within(row).getByRole('button', { name: 'Link per nuova password' }));
    expect(await within(row).findByText('http://portale.test/admin/reimposta-password/xyz')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Copia link' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === `/api/admin/users/${OTHER}/reset-link`)).toBe(true);
    // Not for oneself.
    expect(within(await rowOf('u@sir.test')).queryByRole('button', { name: 'Link per nuova password' })).toBeNull();
  });
});
