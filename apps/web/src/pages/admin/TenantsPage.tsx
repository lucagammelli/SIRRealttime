import type { MeResponse, TenantSummary } from '@sir/shared';
import {
  CreateTenantRequestSchema,
  MeResponseSchema,
  TenantSummarySchema,
  UpdateTenantRequestSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import type { AsyncState } from '../../lib/useAsync.ts';
import { useApiError, useAuth } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';

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
  return 'Dati non validi: controlla i campi.';
}

/** Clients (superadmin only): list, new client, change of name and hostnames. `tenants` is shared with the selector. */
export function TenantsPage({ tenants }: { tenants: AsyncState<TenantSummary[]> }) {
  const errorMessage = useApiError();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [hostnames, setHostnames] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Clienti · Area riservata';
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setDone(null);
    const body = CreateTenantRequestSchema.safeParse({ slug: slug.trim(), name, hostnames: parseHostnames(hostnames) });
    if (!body.success) {
      setFormError(formProblem(body.error.issues));
      return;
    }
    setBusy(true);
    try {
      const created = await apiRequest('/api/admin/tenants', TenantSummarySchema, { method: 'POST', body: body.data });
      setDone(`Cliente «${created.name}» creato.`);
      setSlug('');
      setName('');
      setHostnames('');
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
          {formError && <ErrorBox>{formError}</ErrorBox>}
          {done && (
            <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
              {done}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creazione…' : 'Crea cliente'}
          </Button>
        </form>
      </Card>
      <Card title="Clienti">
        {tenants.loading && !tenants.data && <Spinner label="Caricamento dei clienti…" />}
        {tenants.error !== null && <ErrorBox onRetry={tenants.reload}>{errorMessage(tenants.error)}</ErrorBox>}
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
                  />
                </li>
              ) : (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-text">
                      {t.name} <span className="text-xs text-muted">({t.slug})</span>
                    </p>
                    <p className="break-all text-xs text-muted">
                      {t.hostnames.length > 0 ? t.hostnames.join(', ') : 'Nessun hostname'} · creato{' '}
                      {formatDateTime(t.createdAt)}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setEditing(t.id)} aria-label={`Modifica ${t.name}`}>
                    Modifica
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TenantEditor({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: TenantSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const errorMessage = useApiError();
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(tenant.name);
  const [hostnames, setHostnames] = useState(tenant.hostnames.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const body = UpdateTenantRequestSchema.safeParse({ name, hostnames: parseHostnames(hostnames) });
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
  );
}

/** Client the admin pages work on (superadmin only), in the bar of the reserved area. */
export function TenantSelector({
  tenants,
  stacked = false,
}: {
  tenants: AsyncState<TenantSummary[]>;
  /** Label over a full width select (side menu of the reserved area); otherwise on one line. */
  stacked?: boolean;
}) {
  const errorMessage = useApiError();
  const { user, updateUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = user.tenant?.id ?? '';

  const choose = useCallback(
    async (tenantId: string): Promise<void> => {
      setError(null);
      setBusy(true);
      try {
        const me: MeResponse = await apiRequest('/api/admin/active-tenant', MeResponseSchema, {
          method: 'POST',
          body: { tenantId },
        });
        updateUser(me);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [errorMessage, updateUser],
  );

  const list = tenants.data ?? (user.tenant ? [{ ...user.tenant, hostnames: [], createdAt: '' }] : []);
  return (
    <span className={stacked ? 'flex flex-col gap-1' : 'inline-flex items-center gap-2'}>
      <label className={`text-xs text-muted ${stacked ? 'flex flex-col gap-1' : 'inline-flex items-center gap-2'}`}>
        Cliente
        <select
          value={current}
          disabled={busy}
          onChange={(e) => void choose(e.target.value)}
          className={`rounded-card border border-border bg-surface-2 px-2 py-1 text-sm text-text focus:border-focus ${
            stacked ? 'min-h-9 w-full min-w-0 pointer-coarse:min-h-11' : ''
          }`}
        >
          {current === '' && (
            <option value="" disabled>
              Scegli un cliente
            </option>
          )}
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
