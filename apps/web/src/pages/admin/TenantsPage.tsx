import type { InviteDelivery, MeResponse, TenantSummary } from '@sir/shared';
import {
  AGENT_QUOTA_MAX,
  CreateTenantRequestSchema,
  CreateTenantResponseSchema,
  DEFAULT_AGENT_QUOTA,
  MeResponseSchema,
  PASSWORD_MIN_LENGTH,
  TenantSummarySchema,
  UpdateTenantRequestSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import type { AsyncState } from '../../lib/useAsync.ts';
import { useApiError, useAuth } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { InviteDeliveryBox } from './InviteDelivery.tsx';

export const TenantListSchema = z.array(TenantSummarySchema);

export const loadTenants = (signal: AbortSignal): Promise<TenantSummary[]> =>
  apiRequest('/api/admin/tenants', TenantListSchema, { signal });

/** Pure: hostnames typed one per line (or separated by spaces/commas), without empty entries. */
export function parseHostnames(text: string): string[] {
  return text.split(/[\s,]+/).filter((h) => h.length > 0);
}

const HOSTNAMES_HINT = 'Uno per riga, solo il nome (es. live.club.it): senza https:// né porta.';

/** First problem of a tenant form, in Italian. */
function formProblem(issues: readonly { path: readonly PropertyKey[] }[]): string {
  const field = issues[0]?.path[0];
  if (field === 'slug') return 'Identificativo non valido: lettere minuscole, cifre e trattini (es. sir-susa).';
  if (field === 'name') return 'Il nome è obbligatorio (massimo 100 caratteri).';
  if (field === 'hostnames') return 'Hostname non valido o ripetuto: solo il nome, senza https:// né porta.';
  if (field === 'agentQuota') return `Agenti: un numero intero da 0 a ${AGENT_QUOTA_MAX}.`;
  if (field === 'firstUser') {
    return issues[0]?.path[1] === 'password'
      ? `Primo utente: la password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`
      : 'Primo utente: email non valida.';
  }
  return 'Dati non validi: controlla i campi.';
}

/** Pure: the quota of agents of a client, as written in the list. */
export const quotaText = (n: number): string => (n === 1 ? 'un agente' : `fino a ${n} agenti`);

/** Pure: «Link e QR per singola partita» of a client, as written in the list. */
export const matchLinksText = (enabled: boolean): string => (enabled ? 'link per partita' : 'solo canale');

/** Pure: the users of a client, as written in the list. */
export const userCountText = (n: number): string => (n === 0 ? 'nessun utente' : n === 1 ? '1 utente' : `${n} utenti`);

/**
 * «Entra nel cliente» (an id) and «Esci dal cliente» (null) of the superadmin (`POST /api/admin/active-tenant`, kept
 * in the session): the pages are mounted again on the new client. True when it worked.
 */
export function useChooseTenant(): {
  choose: (tenantId: string | null) => Promise<boolean>;
  busy: boolean;
  error: string | null;
} {
  const errorMessage = useApiError();
  const { updateUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = useCallback(
    async (tenantId: string | null): Promise<boolean> => {
      setError(null);
      setBusy(true);
      try {
        const me: MeResponse = await apiRequest('/api/admin/active-tenant', MeResponseSchema, {
          method: 'POST',
          body: { tenantId },
        });
        updateUser(me);
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [errorMessage, updateUser],
  );
  return { choose, busy, error };
}

/** Most agents of a client: past it a registration cannot be enabled (the agents already there keep working). */
function QuotaField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="Agenti"
      hint={`Quanti PC con l’agente può avere il cliente (da 0 a ${AGENT_QUOTA_MAX}). Oltre, una nuova registrazione non si abilita.`}
    >
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={AGENT_QUOTA_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} w-28`}
      />
    </Field>
  );
}

/**
 * Clients (superadmin only, its first page): list with the number of users and «Entra nel cliente» (the superadmin
 * manages that client, with all its pages, until «Esci dal cliente»), new client with an optional first user
 * («Lettura e scrittura»), change of name, hostnames and quota of agents, «Link e QR per singola partita».
 */
export function TenantsPage({ tenants }: { tenants: AsyncState<TenantSummary[]> }) {
  const errorMessage = useApiError();
  const navigate = useNavigate();
  const chooser = useChooseTenant();
  const [opening, setOpening] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [hostnames, setHostnames] = useState('');
  const [quota, setQuota] = useState(String(DEFAULT_AGENT_QUOTA));
  const [firstEmail, setFirstEmail] = useState('');
  const [firstPassword, setFirstPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; delivery: InviteDelivery } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  /** Enters the client and opens its live match (the pages are mounted again on it). */
  const enter = async (tenantId: string): Promise<void> => {
    setOpening(tenantId);
    const ok = await chooser.choose(tenantId);
    setOpening(null);
    if (ok) void navigate('/admin/live');
  };

  useEffect(() => {
    document.title = 'Clienti · Area riservata';
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setDone(null);
    // The first user only when one of its fields is filled.
    const withFirstUser = firstEmail.trim() !== '' || firstPassword !== '';
    setInvited(null);
    const body = CreateTenantRequestSchema.safeParse({
      slug: slug.trim(),
      name,
      hostnames: parseHostnames(hostnames),
      agentQuota: Number(quota),
      ...(withFirstUser
        ? { firstUser: { email: firstEmail.trim(), ...(firstPassword === '' ? {} : { password: firstPassword }) } }
        : {}),
    });
    if (!body.success) {
      setFormError(formProblem(body.error.issues));
      return;
    }
    setBusy(true);
    try {
      const created = await apiRequest('/api/admin/tenants', CreateTenantResponseSchema, {
        method: 'POST',
        body: body.data,
      });
      if (created.firstUserInvite && body.data.firstUser)
        setInvited({ email: body.data.firstUser.email, delivery: created.firstUserInvite });
      setDone(
        created.firstUserInvite
          ? `Cliente «${created.name}» creato.`
          : body.data.firstUser
            ? `Cliente «${created.name}» creato con l’utente ${body.data.firstUser.email}.`
            : `Cliente «${created.name}» creato.`,
      );
      setSlug('');
      setName('');
      setHostnames('');
      setQuota(String(DEFAULT_AGENT_QUOTA));
      setFirstEmail('');
      setFirstPassword('');
      tenants.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card title="Nuovo cliente">
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <Field label="Nome">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Identificativo" hint="Lettere minuscole, cifre e trattini; non si cambia più.">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
          <Field label="Hostname" hint={HOSTNAMES_HINT}>
            <textarea
              value={hostnames}
              onChange={(e) => setHostnames(e.target.value)}
              rows={3}
              spellCheck={false}
              className={inputClass}
            />
          </Field>
          <QuotaField value={quota} onChange={setQuota} />
          <fieldset className="space-y-3 rounded-card border border-border p-3">
            <legend className="px-1 text-sm font-medium text-text">Primo utente (facoltativo)</legend>
            <p className="text-xs text-muted">
              Creato con il ruolo «Lettura e scrittura», così il cliente può subito accedere e aggiungere i suoi utenti.
            </p>
            <Field label="Email del primo utente">
              <input
                type="email"
                autoComplete="off"
                value={firstEmail}
                onChange={(e) => setFirstEmail(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Password del primo utente (facoltativa)"
              hint={`Lasciala vuota per invitarlo: riceve una mail con il link per scegliere la password. Altrimenti almeno ${PASSWORD_MIN_LENGTH} caratteri, da comunicare di persona.`}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={firstPassword}
                onChange={(e) => setFirstPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
          </fieldset>
          {formError && <ErrorBox>{formError}</ErrorBox>}
          {done && (
            <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
              {done}
            </p>
          )}
          {invited && <InviteDeliveryBox email={invited.email} delivery={invited.delivery} />}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creazione…' : 'Crea cliente'}
          </Button>
        </form>
      </Card>
      <Card title="Clienti">
        {tenants.loading && !tenants.data && <Spinner label="Caricamento dei clienti…" />}
        {tenants.error !== null && <ErrorBox onRetry={tenants.reload}>{errorMessage(tenants.error)}</ErrorBox>}
        {chooser.error && <ErrorBox>{chooser.error}</ErrorBox>}
        {tenants.data && tenants.data.length === 0 && <Empty>Nessun cliente.</Empty>}
        {tenants.data && tenants.data.length > 0 && (
          <ul className="divide-y divide-grid">
            {tenants.data.map((t) =>
              editing === t.id ? (
                <li key={t.id} className="py-3">
                  <TenantEditor
                    tenant={t}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null);
                      tenants.reload();
                    }}
                    onLinksChanged={tenants.reload}
                  />
                </li>
              ) : (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-text">
                      {t.name} <span className="text-xs text-muted">({t.slug})</span>
                    </p>
                    <p className="break-all text-xs text-muted">
                      {t.hostnames.length > 0 ? t.hostnames.join(', ') : 'Nessun hostname'} · {quotaText(t.agentQuota)}{' '}
                      · {userCountText(t.userCount)} · {matchLinksText(t.matchLinksEnabled)} · creato{' '}
                      {formatDateTime(t.createdAt)}
                    </p>
                  </div>
                  <span className="inline-flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      disabled={chooser.busy}
                      onClick={() => void enter(t.id)}
                      aria-label={`Entra nel cliente ${t.name}`}
                    >
                      {opening === t.id ? 'Ingresso…' : 'Entra nel cliente'}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(t.id)} aria-label={`Modifica ${t.name}`}>
                      Modifica
                    </Button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * «Link e QR per singola partita» of a client, saved at once: on, the links and QR of the matches of the calendar and
 * «Una partita fissa»; off, only the channel of the club. Switching it off (two steps) revokes for good the links of
 * single matches already made; on again, every match gets a new link.
 */
function MatchLinksSwitch({ tenant, onChanged }: { tenant: TenantSummary; onChanged: (t: TenantSummary) => void }) {
  const errorMessage = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = tenant.matchLinksEnabled;

  const change = async (matchLinksEnabled: boolean): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const saved = await apiRequest(`/api/admin/tenants/${encodeURIComponent(tenant.id)}`, TenantSummarySchema, {
        method: 'PATCH',
        body: { matchLinksEnabled },
      });
      onChanged(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-card border border-border p-3" aria-label="Link e QR per singola partita">
      <p className="text-sm font-medium text-text">
        Link e QR per singola partita:{' '}
        <span className={on ? 'text-live' : 'text-muted'}>{on ? 'attivi' : 'non attivi'}</span>
      </p>
      <p className="text-xs text-muted">
        {on
          ? 'Ogni partita del calendario ha il suo link e il suo QR, e si può creare «Una partita fissa». Disattivandoli, i link e i QR per partita già creati vengono revocati per sempre (anche quelli già stampati): resta solo il canale del club.'
          : 'Il cliente ha solo il canale del club con il suo QR. Attivandoli, ogni partita del calendario riceve un link e un QR nuovi; quelli revocati restano revocati.'}
      </p>
      {on ? (
        <ConfirmButton
          label="Disattiva"
          confirmLabel="Disattiva e revoca i link per partita"
          busy={busy}
          onConfirm={() => void change(false)}
        />
      ) : (
        <Button onClick={() => void change(true)} disabled={busy}>
          {busy ? 'Attivazione…' : 'Attiva'}
        </Button>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </section>
  );
}

function TenantEditor({
  tenant,
  onClose,
  onSaved,
  onLinksChanged,
}: {
  tenant: TenantSummary;
  onClose: () => void;
  onSaved: () => void;
  onLinksChanged: () => void;
}) {
  const errorMessage = useApiError();
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(tenant.name);
  const [hostnames, setHostnames] = useState(tenant.hostnames.join('\n'));
  const [quota, setQuota] = useState(String(tenant.agentQuota));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const body = UpdateTenantRequestSchema.safeParse({
      name,
      hostnames: parseHostnames(hostnames),
      agentQuota: Number(quota),
    });
    if (!body.success) {
      setError(formProblem(body.error.issues));
      return;
    }
    setBusy(true);
    try {
      const saved = await apiRequest(`/api/admin/tenants/${encodeURIComponent(tenant.id)}`, TenantSummarySchema, {
        method: 'PATCH',
        body: body.data,
      });
      // The name shown in the bar follows the change.
      if (user.tenant?.id === saved.id) updateUser({ ...user, tenant: { ...user.tenant, name: saved.name } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => void save(e)} className="space-y-3" noValidate aria-label={`Modifica ${tenant.name}`}>
        <Field label="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Hostname" hint={HOSTNAMES_HINT}>
          <textarea
            value={hostnames}
            onChange={(e) => setHostnames(e.target.value)}
            rows={3}
            spellCheck={false}
            className={inputClass}
          />
        </Field>
        <QuotaField value={quota} onChange={setQuota} />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Annulla
          </Button>
        </div>
      </form>
      <MatchLinksSwitch
        tenant={tenant}
        onChanged={(saved) => {
          // The pages of the client the superadmin is in follow the change.
          if (user.tenant?.id === saved.id)
            updateUser({ ...user, tenant: { ...user.tenant, matchLinksEnabled: saved.matchLinksEnabled } });
          onLinksChanged();
        }}
      />
    </div>
  );
}
