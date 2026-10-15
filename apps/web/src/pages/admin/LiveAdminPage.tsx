import { MeResponseSchema } from '@sir/shared';
import { useCallback, useEffect } from 'react';
import { LiveMatch } from '../../components/LiveMatch.tsx';
import { ApiError, apiRequest } from '../../lib/api.ts';
import type { ProbeResult } from '../../lib/liveConnection.ts';
import { socketUrl, useLiveSocket } from '../../lib/useLiveSocket.ts';
import { useAuth } from './auth.tsx';

/** The live match through `/ws/admin`, with the same components as the public page. */
export function LiveAdminPage() {
  const { sessionExpired } = useAuth();
  const probe = useCallback(async (): Promise<ProbeResult> => {
    try {
      await apiRequest('/api/auth/me', MeResponseSchema);
      return 'ok';
    } catch (err) {
      return err instanceof ApiError && err.status === 401 ? 'unauthorized' : 'ok';
    }
  }, []);
  const snapshot = useLiveSocket(socketUrl('/ws/admin'), { probe });
  useEffect(() => {
    if (snapshot.status === 'unauthorized') sessionExpired();
  }, [snapshot.status, sessionExpired]);
  useEffect(() => {
    document.title = 'Partita live · Area riservata';
  }, []);
  return <LiveMatch snapshot={snapshot} />;
}
