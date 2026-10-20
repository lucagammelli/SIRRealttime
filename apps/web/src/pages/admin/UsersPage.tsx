import type { InviteDelivery, TenantUserRole, UpdateUserRequest, UserRole, UserSummary } from '@arenalive/shared';
import {
  CreateUserRequestSchema,
  PASSWORD_MIN_LENGTH,
  ResetLinkResponseSchema,
  UpdateUserRequestSchema,
  UserInviteResponseSchema,
  UserSummarySchema,
} from '@arenalive/shared';
import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError, useAuth } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { InviteDeliveryBox, LinkToCopy } from './InviteDelivery.tsx';

const UserListSchema = z.array(UserSummarySchema);

/** Names of the roles shown to people (`admin` and `viewer` are the names of the API). */
export const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Lettura e scrittura',
  viewer: 'Sola lettura',
};

/** What each role of a client can do. */
export const ROLE_HELP: Record<TenantUserRole, string> = {
  admin: 'Gestisce tutto il cliente: partite, calendario, link pubblici, club, agenti, Studio grafico e utenti.',
  viewer: 'Vede partita live, partite, calendario, link pubblici, club e agenti, senza poter cambiare nulla.',
};

const PASSWORD_HINT = `Almeno ${PASSWORD_MIN_LENGTH} caratteri; comunicala all’utente di persona.`;
const NEW_PASSWORD_HINT = `Facoltativa. Lasciala vuota per invitare l’utente: riceve una mail con il link per scegliere la password (almeno ${PASSWORD_MIN_LENGTH} caratteri). Altrimenti comunicala di persona.`;
const PASSWORD_PROBLEM = `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`;

const usersPath = (id: string): string => `/api/admin/users/${encodeURIComponent(id)}`;

function RoleSelect({ value, onChange }: { value: TenantUserRole; onChange: (r: TenantUserRole) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value === 'admin' ? 'admin' : 'viewer')}
      className={inputClass}
    >
      <option value="viewer">{ROLE_LABEL.viewer}</option>
      <option value="admin">{ROLE_LABEL.admin}</option>
    </select>
  );
}

/**
 * Users of the client of the session (admin only; a superadmin manages the client chosen in the menu or with «Utenti»
 * of the «Clienti» page): creation, change of role, new password, disabling and deletion. The server refuses the
 * changes to oneself and the ones leaving the client without an active «Lettura e scrittura» user.
 */
export function UsersPage() {
  const errorMessage = useApiError();
  const { user: me } = useAuth();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/users', UserListSchema, { signal }), []);
  const users = useAsync(load);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<TenantUserRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; delivery: InviteDelivery } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Utenti · Area riservata';
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setDone(null);
    setInvited(null);
    const body = CreateUserRequestSchema.safeParse({
      email: email.trim(),
      ...(password === '' ? {} : { password }),
      role,
    });
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      setFormError(field === 'password' ? PASSWORD_PROBLEM : 'Email non valida.');
      return;
    }
    setBusy(true);
    try {
      const user = await apiRequest('/api/admin/users', UserInviteResponseSchema, { method: 'POST', body: body.data });
      if (user.delivery) setInvited({ email: user.email, delivery: user.delivery });
      else setDone(`Utente ${user.email} creato.`);
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
      <div className="space-y-4">
        <Card title="Nuovo utente" subtitle={me.tenant ? `Cliente: ${me.tenant.name}` : undefined}>
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
            <Field label="Password (facoltativa)" hint={NEW_PASSWORD_HINT}>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Ruolo" hint={ROLE_HELP[role]}>
              <RoleSelect value={role} onChange={setRole} />
            </Field>
            {formError && <ErrorBox>{formError}</ErrorBox>}
            {done && (
              <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
                {done}
              </p>
            )}
            {invited && <InviteDeliveryBox email={invited.email} delivery={invited.delivery} />}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Creazione…' : password === '' ? 'Crea e invita' : 'Crea utente'}
            </Button>
          </form>
        </Card>
        <Card title="Ruoli">
          <dl className="space-y-3 text-sm">
            {(['admin', 'viewer'] as const).map((r) => (
              <div key={r}>
                <dt className="font-medium text-text">{ROLE_LABEL[r]}</dt>
                <dd className="text-muted">{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">
            Il cliente deve avere sempre almeno un utente attivo «{ROLE_LABEL.admin}». Un utente disattivato non può
            accedere; dopo un cambio di ruolo o una nuova password l’utente deve accedere di nuovo (chi cambia la
            propria password resta collegato).
          </p>
        </Card>
      </div>
      <Card title="Utenti">
        {users.loading && !users.data && <Spinner label="Caricamento degli utenti…" />}
        {users.error !== null && <ErrorBox onRetry={users.reload}>{errorMessage(users.error)}</ErrorBox>}
        {notice && (
          <p role="status" className="mb-2 rounded-card bg-success-soft px-3 py-2 text-sm text-text">
            {notice}
          </p>
        )}
        {users.data && users.data.length === 0 && <Empty>Nessun utente.</Empty>}
        {users.data && users.data.length > 0 && (
          <ul className="divide-y divide-grid">
            {users.data.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                self={u.id === me.id}
                onChanged={(message) => {
                  setNotice(message);
                  users.reload();
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Pure: the state shown next to a user. */
export function statusText(u: Pick<UserSummary, 'disabled' | 'invite'>): string {
  if (u.disabled) return 'Disattivato';
  if (u.invite === 'pending') return 'Invito in attesa';
  if (u.invite === 'expired') return 'Invito scaduto';
  return 'Attivo';
}

const statusClass = (u: Pick<UserSummary, 'disabled' | 'invite'>): string =>
  u.disabled ? 'text-danger' : u.invite ? 'text-warn' : 'text-live';

type Panel = 'role' | 'password' | null;

/** One user of the list with its commands (for oneself only the new password). */
function UserRow({
  user,
  self,
  onChanged,
}: {
  user: UserSummary;
  self: boolean;
  /** After a change, with the message to show over the list. */
  onChanged: (message: string) => void;
}) {
  const errorMessage = useApiError();
  const [panel, setPanel] = useState<Panel>(null);
  const [role, setRole] = useState<TenantUserRole>(user.role === 'admin' ? 'admin' : 'viewer');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Link to copy just made for this user (new invitation or reset link). */
  const [link, setLink] = useState<ReactNode>(null);

  const toggle = (p: Exclude<Panel, null>) => {
    setPanel((current) => (current === p ? null : p));
    setError(null);
  };

  const run = async (action: () => Promise<void>, message: string): Promise<void> => {
    setError(null);
    setLink(null);
    setBusy(true);
    try {
      await action();
      setPanel(null);
      setPassword('');
      onChanged(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const update = (body: UpdateUserRequest, message: string): Promise<void> =>
    run(async () => {
      await apiRequest(usersPath(user.id), UserSummarySchema, { method: 'PATCH', body });
    }, message);

  const resendInvite = (): Promise<void> =>
    run(async () => {
      const res = await apiRequest(`${usersPath(user.id)}/invite`, UserInviteResponseSchema, { method: 'POST' });
      if (res.delivery) setLink(<InviteDeliveryBox email={user.email} delivery={res.delivery} />);
    }, `Invito di ${user.email} inviato di nuovo.`);

  const resetLink = (): Promise<void> =>
    run(async () => {
      const res = await apiRequest(`${usersPath(user.id)}/reset-link`, ResetLinkResponseSchema, { method: 'POST' });
      setLink(
        <div role="status" className="space-y-2 rounded-card border border-live bg-success-soft p-3 text-sm text-text">
          <p>Link per la nuova password di {user.email}: mandaglielo a mano, vale un’ora e si usa una volta sola.</p>
          <LinkToCopy link={res.link} label="Copia link" />
        </div>,
      );
    }, `Link per la nuova password di ${user.email} creato.`);

  const savePassword = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body = UpdateUserRequestSchema.safeParse({ password });
    if (!body.success) {
      setError(PASSWORD_PROBLEM);
      return;
    }
    await update(body.data, self ? 'Password cambiata.' : `Password di ${user.email} reimpostata.`);
  };

  return (
    <li className="space-y-2 py-3" data-testid="user">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-medium text-text">
            {user.email}
            {self && <span className="ml-1 text-xs font-normal text-muted">(tu)</span>}
            <span className={`ml-2 text-xs font-semibold uppercase ${statusClass(user)}`}>{statusText(user)}</span>
          </p>
          <p className="text-xs text-muted">
            {ROLE_LABEL[user.role]} · creato {formatDateTime(user.createdAt)}
          </p>
        </div>
        <span className="inline-flex flex-wrap gap-2">
          {user.invite && !user.disabled && (
            <Button variant="ghost" disabled={busy} onClick={() => void resendInvite()}>
              Invia di nuovo
            </Button>
          )}
          {user.invite && (
            <ConfirmButton
              label="Annulla invito"
              confirmLabel="Conferma annullamento"
              busy={busy}
              onConfirm={() =>
                void run(
                  () => apiCommand(`${usersPath(user.id)}/invite`, { method: 'DELETE' }),
                  `Invito a ${user.email} annullato.`,
                )
              }
            />
          )}
          {!self && !user.invite && !user.disabled && (
            <Button variant="ghost" disabled={busy} onClick={() => void resetLink()}>
              Link per nuova password
            </Button>
          )}
          {!self && (
            <Button variant="ghost" aria-expanded={panel === 'role'} onClick={() => toggle('role')}>
              Cambia ruolo
            </Button>
          )}
          <Button variant="ghost" aria-expanded={panel === 'password'} onClick={() => toggle('password')}>
            {self ? 'Cambia password' : 'Reimposta password'}
          </Button>
          {!self &&
            (user.disabled ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void update({ disabled: false }, `${user.email} riattivato.`)}
              >
                Riattiva
              </Button>
            ) : (
              <ConfirmButton
                label="Disattiva"
                confirmLabel="Conferma disattivazione"
                busy={busy}
                onConfirm={() => void update({ disabled: true }, `${user.email} disattivato.`)}
              />
            ))}
          {!self && (
            <ConfirmButton
              label="Elimina"
              confirmLabel="Conferma eliminazione"
              busy={busy}
              onConfirm={() =>
                void run(() => apiCommand(usersPath(user.id), { method: 'DELETE' }), `${user.email} eliminato.`)
              }
            />
          )}
        </span>
      </div>
      {panel === 'role' && (
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-border p-3">
          <div className="min-w-48 flex-1">
            <Field label={`Ruolo di ${user.email}`} hint={ROLE_HELP[role]}>
              <RoleSelect value={role} onChange={setRole} />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={busy || role === user.role}
            onClick={() => void update({ role }, `Ruolo di ${user.email}: ${ROLE_LABEL[role]}.`)}
          >
            Salva ruolo
          </Button>
        </div>
      )}
      {panel === 'password' && (
        <form
          onSubmit={(e) => void savePassword(e)}
          noValidate
          className="flex flex-wrap items-end gap-3 rounded-card border border-border p-3"
        >
          <div className="min-w-48 flex-1">
            <Field
              label={`Nuova password di ${user.email}`}
              hint={self ? `Almeno ${PASSWORD_MIN_LENGTH} caratteri.` : PASSWORD_HINT}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva password'}
          </Button>
        </form>
      )}
      {link}
      {error && <ErrorBox>{error}</ErrorBox>}
    </li>
  );
}
