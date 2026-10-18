import {
  ChangeOwnPasswordRequestSchema,
  formatBuildVersion,
  PASSWORD_MIN_LENGTH,
  PasswordResetAnswerSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Button, Card, ErrorBox } from '../../components/ui.tsx';
import { APP_COMMIT, APP_VERSION } from '../../lib/version.ts';
import { apiRequest } from '../../lib/api.ts';
import { useApiError, useAuth } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';
import { ROLE_LABEL } from './UsersPage.tsx';

/**
 * «Il mio account»: who is logged in and «Cambia password», for every role. It works outside any client too (a
 * superadmin who has not entered a client): the route of the server does not depend on a client. The other sessions
 * of the user are closed, this one stays.
 */
export function AccountPage() {
  const { user, isSuperadmin } = useAuth();
  const errorMessage = useApiError();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setDone(false);
    if (next !== again) {
      setError('Le due password nuove non sono uguali.');
      return;
    }
    const body = ChangeOwnPasswordRequestSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!body.success) {
      setError(
        current === ''
          ? 'Scrivi la password attuale.'
          : `La nuova password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/auth/password', PasswordResetAnswerSchema, { method: 'POST', body: body.data });
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold text-text">Il mio account</h1>
      <Card title="Chi sei">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Email</dt>
          <dd className="break-all text-text">{user.email}</dd>
          <dt className="text-muted">Ruolo</dt>
          <dd className="text-text">{ROLE_LABEL[user.role]}</dd>
          {user.tenant && (
            <>
              <dt className="text-muted">Cliente</dt>
              <dd className="text-text">{user.tenant.name}</dd>
            </>
          )}
          <dt className="text-muted">Versione</dt>
          <dd className="text-text">{formatBuildVersion(APP_VERSION, isSuperadmin ? APP_COMMIT : '')}</dd>
        </dl>
      </Card>
      <Card
        title="Cambia password"
        subtitle="Dopo il cambio, gli altri dispositivi dove sei entrato dovranno accedere di nuovo."
      >
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <Field label="Password attuale">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Nuova password" hint={`Almeno ${PASSWORD_MIN_LENGTH} caratteri.`}>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Ripeti la nuova password">
            <input
              type="password"
              autoComplete="new-password"
              required
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              className={inputClass}
            />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          {done && (
            <p role="status" className="text-sm text-text">
              Password cambiata.
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Cambia password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
