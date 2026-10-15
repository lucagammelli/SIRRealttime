import type { MeResponse } from '@sir/shared';
import { MeResponseSchema } from '@sir/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiCommand, apiRequest, errorText } from '../../lib/api.ts';

interface AuthValue {
  user: MeResponse;
  isAdmin: boolean;
  logout: () => Promise<void>;
  /** To call on any 401 of an API call: back to the login. */
  sessionExpired: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}

/** Shows `errorText(err)`, and leaves the session on a 401. */
export function useApiError(): (err: unknown) => string {
  const { sessionExpired } = useAuth();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) sessionExpired();
      return errorText(err);
    },
    [sessionExpired],
  );
}

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'anonymous'; notice: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'user'; user: MeResponse };

/** Reads the session (`/api/auth/me`) once; the cookie is httpOnly, so the server is the only source. */
export function useSession(): {
  session: SessionState;
  setUser: (u: MeResponse) => void;
  retry: () => void;
  provide: (children: ReactNode) => ReactNode;
} {
  const [session, setSession] = useState<SessionState>({ kind: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSession({ kind: 'loading' });
    apiRequest('/api/auth/me', MeResponseSchema, { signal: controller.signal }).then(
      (user) => setSession({ kind: 'user', user }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) setSession({ kind: 'anonymous', notice: null });
        else setSession({ kind: 'error', message: errorText(err) });
      },
    );
    return () => controller.abort();
  }, [tick]);

  const setUser = useCallback((user: MeResponse) => setSession({ kind: 'user', user }), []);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  const sessionExpired = useCallback(
    () => setSession({ kind: 'anonymous', notice: 'Sessione scaduta: accedi di nuovo.' }),
    [],
  );
  const logout = useCallback(async () => {
    try {
      await apiCommand('/api/auth/logout', { method: 'POST' });
    } finally {
      setSession({ kind: 'anonymous', notice: 'Sei uscito dall’area riservata.' });
    }
  }, []);

  const user = session.kind === 'user' ? session.user : null;
  const value = useMemo<AuthValue | null>(
    () => (user ? { user, isAdmin: user.role === 'admin', logout, sessionExpired } : null),
    [user, logout, sessionExpired],
  );
  const provide = useCallback(
    (children: ReactNode) => <AuthContext.Provider value={value}>{children}</AuthContext.Provider>,
    [value],
  );
  return { session, setUser, retry, provide };
}
