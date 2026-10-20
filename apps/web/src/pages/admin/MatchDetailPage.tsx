import type { ReactNode } from 'react';
import { MatchDetailSchema } from '@arenalive/shared';
import { useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { MatchView } from '../../components/MatchView.tsx';
import { Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { looksLikeMatchState } from '../../lib/messages.ts';
import { formatCount, formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useMatchLinks } from '../../lib/useMatchLinks.ts';
import { useApiError, useAuth } from './auth.tsx';
import { matchStatus, matchTitle } from './matchText.ts';

/** One match of the history, with the same views as the live page (state saved by the server). */
export function MatchDetailPage() {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const matchLinks = useMatchLinks();
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest(`/api/admin/matches/${encodeURIComponent(id)}`, MatchDetailSchema, { signal }),
    [id],
  );
  const { data, error, loading, reload } = useAsync(load);
  useEffect(() => {
    document.title = `${data ? matchTitle(data) : 'Partita'} · Area riservata`;
  }, [data]);

  return (
    <div className="space-y-4">
      <p>
        <Link to="/admin/partite" className="text-sm text-muted hover:text-text">
          ← Tutte le partite
        </Link>
      </p>
      {loading && !data && <Spinner label="Caricamento della partita…" />}
      {error !== null && <ErrorBox onRetry={reload}>{errorMessage(error)}</ErrorBox>}
      {data && (
        <>
          <Card
            title={matchTitle(data)}
            actions={
              // A link of this match only: «Link e QR per singola partita» of the client.
              isAdmin && matchLinks ? (
                <Link
                  to={`/admin/link?partita=${data.id}`}
                  className="rounded-card border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2"
                >
                  Crea un link pubblico
                </Link>
              ) : undefined
            }
          >
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Info label="Stato">
                {matchStatus(data)}
                {data.live ? ' · live' : ''}
              </Info>
              <Info label="Righe di scout">{formatCount(data.lineCount)}</Info>
              <Info label="Versione">{formatCount(data.version)}</Info>
              <Info label="Aggiornata">{formatDateTime(data.updatedAt)}</Info>
            </dl>
            <p className="mt-2 break-all font-mono text-xs text-muted">{data.matchKey}</p>
          </Card>
          {data.state && looksLikeMatchState(data.state) ? (
            <MatchView state={data.state} />
          ) : (
            <Empty>Lo stato di questa partita non è ancora disponibile.</Empty>
          )}
        </>
      )}
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-medium text-text">{children}</dd>
    </div>
  );
}
