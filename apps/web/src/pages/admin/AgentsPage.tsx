import type { CreateAgentResponse } from '@sir/shared';
import { AgentSummarySchema, CreateAgentRequestSchema, CreateAgentResponseSchema } from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Card, CopyButton, Empty, ErrorBox, SecretBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';

const AgentListSchema = z.array(AgentSummarySchema);

/** `config.json` of the agent for a new token (docs/agente.md); the server URL is the address of this portal. */
export function agentConfigJson(token: string, serverUrl: string): string {
  return JSON.stringify({ watchPath: 'E:\\', serverUrl, agentToken: token }, null, 2);
}

/** Agent tokens: create (token shown once, with the config.json to copy), list, revoke. */
export function AgentsPage() {
  const errorMessage = useApiError();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/agents', AgentListSchema, { signal }), []);
  const agents = useAsync(load);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateAgentResponse | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Agenti · Area riservata';
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    const body = CreateAgentRequestSchema.safeParse({ name: name.trim() });
    if (!body.success) {
      setFormError('Scrivi un nome (al massimo 100 caratteri, senza caratteri speciali).');
      return;
    }
    setBusy(true);
    try {
      setCreated(await apiRequest('/api/admin/agents', CreateAgentResponseSchema, { method: 'POST', body: body.data }));
      setName('');
      agents.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setRevoking(id);
    setListError(null);
    try {
      await apiCommand(`/api/admin/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      agents.reload();
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  const config = created ? agentConfigJson(created.token, window.location.origin) : '';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <Card title="Nuovo agente" subtitle="Un token per ogni PC con DataVolley">
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <Field label="Nome" hint="Es. «PC scout palestra».">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              className={inputClass}
            />
          </Field>
          {formError && <ErrorBox>{formError}</ErrorBox>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creazione…' : 'Crea token'}
          </Button>
        </form>
        {created && (
          <div className="mt-4 space-y-3">
            <SecretBox
              title={`Token di «${created.name}»: copialo ora, non sarà più mostrato.`}
              value={created.token}
            />
            <div className="space-y-2 rounded-card border border-border bg-surface-2 p-3 text-sm text-text">
              <p className="font-semibold">Configurazione dell’agente</p>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>
                  Accanto a <code className="font-mono text-text">sir-agent.exe</code> crea il file{' '}
                  <code className="font-mono text-text">config.json</code> con questo contenuto.
                </li>
                <li>
                  In <code className="font-mono text-text">watchPath</code> metti la cartella (o il file .dvw) di
                  DataVolley, es. la pennina <code className="font-mono text-text">E:\</code>.
                </li>
                <li>
                  Controlla <code className="font-mono text-text">serverUrl</code>: deve essere l’indirizzo https del
                  server.
                </li>
                <li>Avvia l’agente e verifica qui sotto «ultimo contatto».</li>
              </ol>
              <pre className="overflow-x-auto rounded-card bg-surface p-3 font-mono text-xs text-text">{config}</pre>
              <CopyButton text={config} label="Copia config.json" />
            </div>
          </div>
        )}
      </Card>

      <Card title="Agenti">
        {agents.loading && !agents.data && <Spinner label="Caricamento degli agenti…" />}
        {agents.error !== null && <ErrorBox onRetry={agents.reload}>{errorMessage(agents.error)}</ErrorBox>}
        {listError && <ErrorBox>{listError}</ErrorBox>}
        {agents.data && agents.data.length === 0 && <Empty>Nessun agente creato.</Empty>}
        {agents.data && agents.data.length > 0 && (
          <ul className="divide-y divide-grid">
            {agents.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {a.name}{' '}
                    <span className={`ml-1 text-xs font-semibold uppercase ${a.revoked ? 'text-danger' : 'text-live'}`}>
                      {a.revoked ? 'Revocato' : 'Attivo'}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    Ultimo contatto {a.lastSeenAt ? formatDateTime(a.lastSeenAt) : 'mai'} · creato{' '}
                    {formatDateTime(a.createdAt)}
                  </p>
                </div>
                {!a.revoked && (
                  <ConfirmButton
                    label="Revoca"
                    confirmLabel="Conferma revoca"
                    busy={revoking === a.id}
                    onConfirm={() => void revoke(a.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
