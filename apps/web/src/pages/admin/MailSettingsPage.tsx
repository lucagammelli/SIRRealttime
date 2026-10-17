import type { MailSettings, SmtpSecurity } from '@sir/shared';
import {
  MailSettingsSchema,
  MailTestResponseSchema,
  SMTP_SECURITIES,
  UpdateMailSettingsRequestSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError, useAuth } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';

const SECURITY_LABEL: Record<SmtpSecurity, string> = {
  none: 'Nessuna (porta 25, solo reti fidate)',
  starttls: 'STARTTLS (di solito porta 587)',
  tls: 'TLS (di solito porta 465)',
};
const DEFAULT_PORT: Record<SmtpSecurity, number> = { none: 25, starttls: 587, tls: 465 };

/** Mail server used for invitations and password resets (superadmin only); the same for every client. */
export function MailSettingsPage() {
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/mail-settings', MailSettingsSchema, { signal }),
    [],
  );
  const settings = useAsync(load);
  const errorMessage = useApiError();

  useEffect(() => {
    document.title = 'Posta · Area riservata';
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {settings.loading && !settings.data && <Spinner label="Caricamento delle impostazioni di posta…" />}
      {settings.error !== null && <ErrorBox onRetry={settings.reload}>{errorMessage(settings.error)}</ErrorBox>}
      {settings.data && <MailForm initial={settings.data} />}
    </div>
  );
}

function MailForm({ initial }: { initial: MailSettings }) {
  const errorMessage = useApiError();
  const { user } = useAuth();
  const [settings, setSettings] = useState(initial);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(settings.port));
  const [security, setSecurity] = useState<SmtpSecurity>(settings.security);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [fromName, setFromName] = useState(initial.fromName);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setTest(null);
    const body = UpdateMailSettingsRequestSchema.safeParse({
      host,
      port: Number(port),
      security,
      username,
      ...(password === '' ? {} : { password }),
      ...(clearPassword ? { clearPassword: true } : {}),
      fromName,
      fromEmail: fromEmail.trim(),
    });
    if (!body.success) {
      const field = String(body.error.issues[0]?.path[0]);
      setError(
        field === 'host'
          ? 'Scrivi il nome del server di posta.'
          : field === 'port'
            ? 'La porta è un numero da 1 a 65535.'
            : field === 'fromName'
              ? 'Scrivi il nome del mittente.'
              : field === 'fromEmail'
                ? 'L’indirizzo del mittente non è valido.'
                : 'Controlla i campi.',
      );
      return;
    }
    setBusy(true);
    try {
      setSettings(await apiRequest('/api/admin/mail-settings', MailSettingsSchema, { method: 'PUT', body: body.data }));
      setPassword('');
      setClearPassword(false);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (): Promise<void> => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      setTest(await apiRequest('/api/admin/mail-settings/test', MailTestResponseSchema, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Posta"
      subtitle="Il server che spedisce le mail di invito e di recupero password, uguale per tutti i clienti."
    >
      <form onSubmit={(e) => void save(e)} className="space-y-4" noValidate>
        {!settings.configured && (
          <p className="rounded-card bg-surface-2 px-3 py-2 text-sm text-muted">
            La posta non è configurata: gli inviti non partono e l’amministratore del cliente copia il link per mandarlo
            a mano.
          </p>
        )}
        {!settings.encryptionAvailable && (
          <ErrorBox>
            Manca la chiave SETTINGS_ENCRYPTION_KEY nel file .env del server: senza, la password del server di posta non
            si può salvare (vedi .env.example per generarla).
          </ErrorBox>
        )}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label="Server SMTP" hint="Ad esempio smtp.miodominio.it">
            <input value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} className={inputClass} />
          </Field>
          <Field label="Porta">
            <input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Sicurezza">
          <select
            value={security}
            onChange={(e) => {
              const next = SMTP_SECURITIES.find((s) => s === e.target.value) ?? 'starttls';
              // The usual port follows the choice, unless the person has typed another one.
              if (port === String(DEFAULT_PORT[security])) setPort(String(DEFAULT_PORT[next]));
              setSecurity(next);
            }}
            className={inputClass}
          >
            {SMTP_SECURITIES.map((s) => (
              <option key={s} value={s}>
                {SECURITY_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Utente" hint="Vuoto se il server non chiede l’accesso.">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </Field>
        <Field
          label="Password"
          hint={
            settings.passwordSet
              ? 'Password salvata (non si può rileggere). Scrivine una nuova per sostituirla, o lascia vuoto per tenerla.'
              : 'Nessuna password salvata.'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={!settings.encryptionAvailable}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {settings.passwordSet && (
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
            Cancella la password salvata
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome del mittente" hint="Come lo vede chi riceve la mail.">
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Indirizzo del mittente">
            <input
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {saved && (
          <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
            Impostazioni salvate.
          </p>
        )}
        {test && (
          <p
            role={test.ok ? 'status' : 'alert'}
            className={`rounded-card px-3 py-2 text-sm text-text ${test.ok ? 'bg-success-soft' : 'border border-danger'}`}
          >
            {test.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </Button>
          <Button disabled={testing || busy || !settings.configured} onClick={() => void sendTest()}>
            {testing ? 'Invio in corso…' : 'Invia una mail di prova'}
          </Button>
        </div>
        <p className="text-xs text-muted">
          La mail di prova arriva a {user.email}. Salva prima le modifiche: la prova usa le impostazioni salvate.
        </p>
      </form>
    </Card>
  );
}
