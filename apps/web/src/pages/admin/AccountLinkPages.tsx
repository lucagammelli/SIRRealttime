import type { LinkInfo } from '@sir/shared';
import {
  LinkInfoSchema,
  MeResponseSchema,
  PASSWORD_MIN_LENGTH,
  PasswordResetAnswerSchema,
  PasswordResetRequestSchema,
  SetPasswordRequestSchema,
} from '@sir/shared';
import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BrandMark } from '../../components/BrandMark.tsx';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { Button, ErrorBox, Spinner } from '../../components/ui.tsx';
import { ApiError, apiRequest, errorText } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { Field, inputClass } from './forms.tsx';

/** Pages without a session, reached from the login and from the links in the mails (Inter, as the reserved area). */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sir-admin-font contents">
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm space-y-4 rounded-panel border border-border bg-surface p-6 shadow-card">
          <div>
            <BrandMark />
            <h1 className="mt-1 text-lg font-semibold text-text">{title}</h1>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

const BackToLogin = () => (
  <p className="text-center text-sm">
    <Link to="/admin" className="text-muted underline hover:text-text">
      Torna all’accesso
    </Link>
  </p>
);

/** «Password dimenticata?»: asks for the email; the answer is the same whether the email is known or not. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = 'Password dimenticata · Area riservata';
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body = PasswordResetRequestSchema.safeParse({ email: email.trim() });
    if (!body.success) {
      setError('Scrivi la tua email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/auth/password-reset/request', PasswordResetAnswerSchema, {
        method: 'POST',
        body: body.data,
      });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Shell title="Controlla la posta">
        <p role="status" className="text-sm text-text">
          Se l’indirizzo è registrato, ti abbiamo mandato una mail con il link per scegliere una nuova password. Il link
          vale un’ora e si usa una volta sola. Se non arriva, guarda tra la posta indesiderata o chiedi un link
          all’amministratore del tuo cliente.
        </p>
        <BackToLogin />
      </Shell>
    );
  }
  return (
    <Shell title="Password dimenticata">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <p className="text-sm text-muted">Scrivi la tua email: ti mandiamo un link per scegliere una nuova password.</p>
        <Field label="Email">
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? 'Invio in corso…' : 'Invia il link'}
        </Button>
      </form>
      <BackToLogin />
    </Shell>
  );
}

const PROBLEM_LENGTH = `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`;

/**
 * Page of a link from a mail: `invite` (first password, then the user enters already logged in) or `reset` (new
 * password, then back to the login). A wrong, used or expired link says so (410).
 */
export function SetPasswordPage({ kind }: { kind: 'invite' | 'reset' }) {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest(`/api/auth/links/${encodeURIComponent(token)}`, LinkInfoSchema, { signal }),
    [token],
  );
  const info = useAsync(load);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = `${kind === 'invite' ? 'Invito' : 'Nuova password'} · Area riservata`;
  }, [kind]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body = SetPasswordRequestSchema.safeParse({ token, password });
    if (!body.success) {
      setError(PROBLEM_LENGTH);
      return;
    }
    if (password !== again) {
      setError('Le due password non coincidono.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (kind === 'invite') {
        await apiRequest('/api/auth/invite/accept', MeResponseSchema, { method: 'POST', body: body.data });
        void navigate('/admin', { replace: true });
        return;
      }
      await apiRequest('/api/auth/password-reset/confirm', PasswordResetAnswerSchema, {
        method: 'POST',
        body: body.data,
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 410
          ? 'Il link non è più valido: chiedine uno nuovo.'
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  };

  if (info.loading && !info.data && info.error === null) {
    return (
      <Shell title="Un attimo…">
        <Spinner label="Controllo del link…" />
      </Shell>
    );
  }
  if (info.error !== null || !info.data) {
    const expired = info.error instanceof ApiError && info.error.status === 410;
    if (!expired) {
      return (
        <StatusScreen title="Link non verificato" tone="error" action={<Button onClick={info.reload}>Riprova</Button>}>
          {errorText(info.error)}
        </StatusScreen>
      );
    }
    return (
      <Shell title="Link non valido">
        <p role="alert" className="text-sm text-text">
          Il link non è valido o è scaduto (o è già stato usato).{' '}
          {kind === 'invite'
            ? 'Chiedi all’amministratore di invitarti di nuovo.'
            : 'Puoi chiederne uno nuovo da «Password dimenticata?».'}
        </p>
        {kind === 'reset' && (
          <p className="text-center text-sm">
            <Link to="/admin/password-dimenticata" className="text-muted underline hover:text-text">
              Password dimenticata?
            </Link>
          </p>
        )}
        <BackToLogin />
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell title="Password cambiata">
        <p role="status" className="text-sm text-text">
          La nuova password è pronta: accedi con la tua email. Le sessioni aperte sugli altri dispositivi sono state
          chiuse.
        </p>
        <BackToLogin />
      </Shell>
    );
  }
  return (
    <Shell title={kind === 'invite' ? 'Scegli la password' : 'Nuova password'}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Intro info={info.data} kind={kind} />
        <Field label="Password" hint={`Almeno ${PASSWORD_MIN_LENGTH} caratteri.`}>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Ripeti la password">
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
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? 'Salvataggio…' : kind === 'invite' ? 'Salva e accedi' : 'Salva la password'}
        </Button>
      </form>
    </Shell>
  );
}

function Intro({ info, kind }: { info: LinkInfo; kind: 'invite' | 'reset' }) {
  return (
    <p className="text-sm text-muted">
      {kind === 'invite' && info.tenantName ? `Sei stato invitato su ${info.tenantName}. ` : ''}
      Account: <span className="break-all font-medium text-text">{info.email}</span>
    </p>
  );
}
