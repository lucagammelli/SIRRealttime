import type { UserRole } from '@sir/shared';
import { CreateUserRequestSchema, PASSWORD_MIN_LENGTH, UserSummarySchema } from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';

const UserListSchema = z.array(UserSummarySchema);
const ROLE_LABEL: Record<UserRole, string> = { admin: 'Amministratore', viewer: 'Sola lettura' };

/** Users of the reserved area (admin only). */
export function UsersPage() {
  const errorMessage = useApiError();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/users', UserListSchema, { signal }), []);
  const users = useAsync(load);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Utenti · Area riservata';
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setDone(null);
    const body = CreateUserRequestSchema.safeParse({ email: email.trim(), password, role });
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      setFormError(
        field === 'password' ? `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.` : 'Email non valida.',
      );
      return;
    }
    setBusy(true);
    try {
      const user = await apiRequest('/api/admin/users', UserSummarySchema, { method: 'POST', body: body.data });
      setDone(`Utente ${user.email} creato.`);
      setEmail('');
      setPassword('');
      users.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card title="Nuovo utente">
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <Field label="Email">
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Password" hint={`Almeno ${PASSWORD_MIN_LENGTH} caratteri; comunicala all’utente di persona.`}>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Ruolo" hint="Sola lettura: vede solo la partita live e le partite.">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'viewer')}
              className={inputClass}
            >
              <option value="viewer">{ROLE_LABEL.viewer}</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
            </select>
          </Field>
          {formError && <ErrorBox>{formError}</ErrorBox>}
          {done && (
            <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
              {done}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creazione…' : 'Crea utente'}
          </Button>
        </form>
      </Card>
      <Card title="Utenti">
        {users.loading && !users.data && <Spinner label="Caricamento degli utenti…" />}
        {users.error !== null && <ErrorBox onRetry={users.reload}>{errorMessage(users.error)}</ErrorBox>}
        {users.data && users.data.length === 0 && <Empty>Nessun utente.</Empty>}
        {users.data && users.data.length > 0 && (
          <ul className="divide-y divide-grid">
            {users.data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="min-w-0 break-all font-medium text-text">{u.email}</span>
                <span className="text-xs text-muted">
                  {ROLE_LABEL[u.role]} · creato {formatDateTime(u.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
