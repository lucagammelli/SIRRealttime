import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { APP_VERSION } from '../../lib/version.ts';
import { AccountPage } from './AccountPage.tsx';

afterEach(cleanup);

const fill = (current: string, next: string, again: string): void => {
  fireEvent.change(screen.getByLabelText('Password attuale'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Nuova password/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Ripeti la nuova password'), { target: { value: again } });
  fireEvent.click(screen.getByRole('button', { name: 'Cambia password' }));
};

describe('AccountPage', () => {
  it('shows the version of the portal', () => {
    mockApi(() => ({ body: {} }));
    renderAs('admin', <AccountPage />);
    expect(screen.getByText('Versione').nextElementSibling?.textContent).toBe(APP_VERSION);
  });

  it('lets a superadmin outside any client change its password', async () => {
    const calls = mockApi(() => ({ body: { ok: true } }));
    renderAs('superadmin', <AccountPage />);
    expect(screen.getByText('Superadmin')).toBeTruthy();
    fill('password-attuale', 'password-nuova-lunga', 'password-nuova-lunga');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Password cambiata.'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/api/auth/password',
      method: 'POST',
      body: { currentPassword: 'password-attuale', newPassword: 'password-nuova-lunga' },
    });
  });

  it('does not call the server when the new passwords differ or are too short', () => {
    const calls = mockApi(() => ({ body: { ok: true } }));
    renderAs('viewer', <AccountPage />);
    fill('password-attuale', 'password-nuova-lunga', 'altra-password-lunga');
    expect(screen.getByRole('alert').textContent).toContain('non sono uguali');
    fill('password-attuale', 'corta', 'corta');
    expect(screen.getByRole('alert').textContent).toContain('almeno 12 caratteri');
    expect(calls).toHaveLength(0);
  });
});
