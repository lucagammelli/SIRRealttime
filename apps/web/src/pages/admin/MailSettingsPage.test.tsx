import type { MailSettings } from '@arenalive/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../test/adminPage.tsx';
import { MailSettingsPage } from './MailSettingsPage.tsx';

const EMPTY: MailSettings = {
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  passwordSet: false,
  fromName: '',
  fromEmail: '',
  configured: false,
  encryptionAvailable: true,
};
const SAVED: MailSettings = {
  host: 'smtp.club.it',
  port: 465,
  security: 'tls',
  username: 'robot',
  passwordSet: true,
  fromName: 'Club',
  fromEmail: 'noreply@club.it',
  configured: true,
  encryptionAvailable: true,
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Posta» page', () => {
  it('says that the mail is not configured and saves the settings with the password', async () => {
    let current = EMPTY;
    const calls = mockApi((call) => {
      if (call.method === 'PUT') {
        current = SAVED;
        return { body: SAVED };
      }
      return { body: current };
    });
    renderAs('superadmin', <MailSettingsPage />);
    expect(await screen.findByText(/La posta non è configurata/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Invia una mail di prova' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Server SMTP', { exact: false }), { target: { value: 'smtp.club.it' } });
    fireEvent.change(screen.getByLabelText('Utente', { exact: false }), { target: { value: 'robot' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'segreta' } });
    fireEvent.change(screen.getByLabelText('Nome del mittente', { exact: false }), { target: { value: 'Club' } });
    fireEvent.change(screen.getByLabelText('Indirizzo del mittente'), { target: { value: 'noreply@club.it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Impostazioni salvate.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      host: 'smtp.club.it',
      port: 587,
      security: 'starttls',
      username: 'robot',
      password: 'segreta',
      fromName: 'Club',
      fromEmail: 'noreply@club.it',
    });
    // The password is never shown again, only that it is set.
    expect(screen.getByLabelText<HTMLInputElement>(/^Password/).value).toBe('');
    expect(screen.getByText(/Password salvata/)).toBeTruthy();
  });

  it('refuses invalid fields before calling the server', async () => {
    const calls = mockApi(() => ({ body: EMPTY }));
    renderAs('superadmin', <MailSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Scrivi il nome del server di posta.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('keeps the saved password when left empty, clears it on request, and sends a test mail', async () => {
    const calls = mockApi((call) => {
      if (call.url.endsWith('/test'))
        return { body: { ok: false, message: 'Il server di posta ha rifiutato utente o password.' } };
      return { body: SAVED };
    });
    renderAs('superadmin', <MailSettingsPage />);
    expect(await screen.findByText(/Password salvata/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia una mail di prova' }));
    expect(await screen.findByText('Il server di posta ha rifiutato utente o password.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cancella la password salvata'));
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')?.body as Record<string, unknown>;
    expect(put.clearPassword).toBe(true);
    expect('password' in put).toBe(false);
  });

  it('warns when the encryption key is missing and blocks the password', async () => {
    mockApi(() => ({ body: { ...EMPTY, encryptionAvailable: false } }));
    renderAs('superadmin', <MailSettingsPage />);
    expect(await screen.findByText(/Manca la chiave SETTINGS_ENCRYPTION_KEY/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Password/).disabled).toBe(true);
  });
});
