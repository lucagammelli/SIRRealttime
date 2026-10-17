import type { MeResponse } from '@sir/shared';
import { LoginRequestSchema, MeResponseSchema } from '@sir/shared';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '../../components/BrandMark.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { Button, ErrorBox } from '../../components/ui.tsx';
import { ApiError, apiRequest, errorText } from '../../lib/api.ts';
import { Field, inputClass } from './forms.tsx';

/** Login with email and password; the server sets the httpOnly session cookie. */
export function LoginPage({ onLogin, notice }: { onLogin: (user: MeResponse) => void; notice: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body = LoginRequestSchema.safeParse({ email: email.trim(), password });
    if (!body.success) {
      setError('Inserisci email e password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onLogin(await apiRequest('/api/auth/login', MeResponseSchema, { method: 'POST', body: body.data }));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Email o password non corrette.' : errorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm space-y-4 rounded-panel border border-border bg-surface p-6 shadow-card"
        noValidate
      >
        <div>
          <BrandMark />
          <h1 className="mt-1 text-lg font-semibold text-text">Area riservata</h1>
        </div>
        {notice && <p className="rounded-card bg-surface-2 px-3 py-2 text-sm text-muted">{notice}</p>}
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
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" variant="primary" disabled={busy} className="w-full">
          {busy ? 'Accesso in corso…' : 'Accedi'}
        </Button>
        <p className="text-center text-sm">
          <Link to="/admin/password-dimenticata" className="text-muted underline hover:text-text">
            Password dimenticata?
          </Link>
        </p>
      </form>
    </main>
  );
}
