import type { AgentRegistrationSummary, CreateAgentResponse } from '@sir/shared';
import {
  AgentDownloadInfoSchema,
  AgentRegistrationSummarySchema,
  AgentSummarySchema,
  CreateAgentRequestSchema,
  CreateAgentResponseSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button, buttonClass, Card, CopyButton, Empty, ErrorBox, SecretBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime, megabytes } from '../../lib/format.ts';
import type { AsyncState } from '../../lib/useAsync.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';

const AgentListSchema = z.array(AgentSummarySchema);
const RegistrationListSchema = z.array(AgentRegistrationSummarySchema);

/** While the page is open, pending requests and agents are reloaded this often (the agent polls every 5 s too). */
export const AGENTS_REFRESH_MS = 5000;

/** Calls `tick` every `ms` while the browser tab is visible. */
function useRefresh(tick: () => void, ms: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  }, [tick]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') latest.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** `config.json` of the agent for a new token (docs/agente.md); the server URL is the address of this portal. */
export function agentConfigJson(token: string, serverUrl: string): string {
  return JSON.stringify({ watchPath: 'E:\\', serverUrl, agentToken: token }, null, 2);
}

/** Zip of the agent for Windows for the client of the session (the session cookie is enough: same origin). */
export const AGENT_DOWNLOAD_PATH = '/api/admin/agent/download';

/**
 * Agent for Windows published on the server: version, date and size, the link to the zip of this client (executable,
 * config.json of this portal, colours and logo of the client) and the installation steps.
 */
function AgentDownload() {
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/agent/info', AgentDownloadInfoSchema, { signal }),
    [],
  );
  const info = useAsync(load);
  const data = info.data;
  return (
    <Card title="Agente per Windows" subtitle="Già configurato per questo portale, con i colori e il logo del cliente.">
      {info.loading && !data && <Spinner label="Caricamento dell’agente…" />}
      {info.error !== null && <ErrorBox onRetry={info.reload}>{errorMessage(info.error)}</ErrorBox>}
      {data && !data.available && (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-text">L’agente non è ancora stato pubblicato sul server.</p>
          <p className="text-muted">
            Chi gestisce il server lo pubblica con{' '}
            <code className="font-mono text-text">scripts/costruisci-agente.sh</code>.
          </p>
        </div>
      )}
      {data?.available && (
        <div className="space-y-3 text-sm">
          <p className="text-muted" data-testid="agent-release">
            Versione <span className="font-mono text-text">{data.version}</span> · {formatDateTime(data.builtAt)} ·{' '}
            {megabytes(data.bytes)} MB
          </p>
          <a href={AGENT_DOWNLOAD_PATH} download={data.fileName} className={buttonClass('primary')}>
            Scarica l’agente per Windows
          </a>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>
              Scompatta lo zip in <code className="font-mono text-text">C:\SIRAgent</code> (non sulla pennina).
            </li>
            <li>
              Fai doppio clic su <code className="font-mono text-text">sir-agent.exe</code>. Non è firmato: se Windows
              lo blocca premi «Ulteriori informazioni» e poi «Esegui comunque».
            </li>
            <li>Scrivi il nome dell’agente e premi «Registra».</li>
            <li>Abilitalo qui sotto in «Richieste in attesa», controllando il codice mostrato sul PC.</li>
          </ol>
        </div>
      )}
    </Card>
  );
}

/**
 * Self-registration requests of the agents: the admin checks that the pairing code is the one shown on the PC and
 * approves (the agent then collects its token by itself) or rejects.
 */
function PendingRegistrations({
  registrations,
  onChanged,
}: {
  registrations: AsyncState<AgentRegistrationSummary[]>;
  onChanged: () => void;
}) {
  const errorMessage = useApiError();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (id: string, action: 'approve' | 'reject'): Promise<void> => {
    setDeciding(id);
    setError(null);
    try {
      const path = `/api/admin/agent-registrations/${encodeURIComponent(id)}/${action}`;
      await apiRequest(path, AgentRegistrationSummarySchema, { method: 'POST' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeciding(null);
      onChanged();
    }
  };

  const list = registrations.data;
  return (
    <Card
      title="Richieste in attesa"
      subtitle="PC che hanno chiesto di registrarsi come agenti. Abilita solo se il codice è quello mostrato sul PC."
    >
      {registrations.loading && !list && <Spinner label="Caricamento delle richieste…" />}
      {registrations.error !== null && (
        <ErrorBox onRetry={registrations.reload}>{errorMessage(registrations.error)}</ErrorBox>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {list && list.length === 0 && <Empty>Nessuna richiesta in attesa.</Empty>}
      {list && list.length > 0 && (
        <ul className="divide-y divide-grid" aria-label="Richieste in attesa">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-text">{r.name}</p>
                <p className="text-xs text-muted">Codice di abbinamento</p>
                <p className="font-mono text-3xl font-semibold tracking-[0.3em] text-text" data-testid="pairing-code">
                  {r.pairingCode}
                </p>
                <p className="text-xs text-muted">
                  Da {r.ip ?? 'indirizzo sconosciuto'} · richiesta {formatDateTime(r.createdAt)} · scade{' '}
                  {formatDateTime(r.expiresAt)}
                </p>
              </div>
              {deciding === r.id ? (
                <Button disabled>Attendere…</Button>
              ) : (
                <span className="inline-flex flex-wrap gap-2">
                  <Button variant="primary" disabled={deciding !== null} onClick={() => void decide(r.id, 'approve')}>
                    Abilita
                  </Button>
                  <Button variant="danger" disabled={deciding !== null} onClick={() => void decide(r.id, 'reject')}>
                    Rifiuta
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">
        Controlla che il codice sia quello mostrato sul PC con DataVolley prima di premere «Abilita»: l’agente riceve il
        suo token da solo entro pochi secondi e compare nell’elenco degli agenti.
      </p>
    </Card>
  );
}

/** Agent tokens: create (token shown once, with the config.json to copy), list, revoke; pending self-registrations. */
export function AgentsPage() {
  const errorMessage = useApiError();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/agents', AgentListSchema, { signal }), []);
  const agents = useAsync(load);
  const loadRegistrations = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/agent-registrations', RegistrationListSchema, { signal }),
    [],
  );
  const registrations = useAsync(loadRegistrations);
  const refresh = useCallback(() => {
    registrations.reload();
    agents.reload();
  }, [registrations.reload, agents.reload]);
  useRefresh(refresh, AGENTS_REFRESH_MS);
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
      <div className="flex min-w-0 flex-col gap-4">
        <AgentDownload />
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
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <PendingRegistrations registrations={registrations} onChanged={refresh} />
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
                      <span
                        className={`ml-1 text-xs font-semibold uppercase ${a.revoked ? 'text-danger' : 'text-live'}`}
                      >
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
    </div>
  );
}
