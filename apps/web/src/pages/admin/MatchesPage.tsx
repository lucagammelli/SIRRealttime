import { MatchSummarySchema } from '@sir/shared';
import { useCallback, useEffect } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatCount, formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { matchStatus, matchTitle } from './matchText.ts';

export const MatchListSchema = z.array(MatchSummarySchema);

/** History of the matches (at most 200, latest update first). */
export function MatchesPage() {
  const errorMessage = useApiError();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/matches', MatchListSchema, { signal }), []);
  const { data, error, loading, reload } = useAsync(load);
  useEffect(() => {
    document.title = 'Partite · Area riservata';
  }, []);

  return (
    <Card title="Partite" subtitle="Le partite ricevute dagli agenti, dalla più recente">
      {loading && !data && <Spinner label="Caricamento delle partite…" />}
      {error !== null && <ErrorBox onRetry={reload}>{errorMessage(error)}</ErrorBox>}
      {data && data.length === 0 && <Empty>Nessuna partita ricevuta finora.</Empty>}
      {data && data.length > 0 && (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pl-4 sm:pl-5">Partita</th>
                <th className="px-2">Set</th>
                <th className="px-2">Stato</th>
                <th className="px-2 text-right">Righe</th>
                <th className="px-2 pr-4 sm:pr-5">Aggiornata</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-grid last:border-0 hover:bg-surface-2">
                  <td className="py-2 pl-4 sm:pl-5">
                    <Link
                      to={`/admin/partite/${m.id}`}
                      className="font-medium text-home underline-offset-2 hover:underline"
                    >
                      {matchTitle(m)}
                    </Link>
                    {m.live && (
                      <span className="ml-2 rounded-full border border-live px-2 py-0.5 text-[10px] font-bold uppercase text-live">
                        Live
                      </span>
                    )}
                  </td>
                  <td className="px-2 tabular">{m.setsWon ? `${m.setsWon.home}-${m.setsWon.away}` : '–'}</td>
                  <td className="px-2">{matchStatus(m)}</td>
                  <td className="px-2 text-right tabular">{formatCount(m.lineCount)}</td>
                  <td className="px-2 pr-4 sm:pr-5">{formatDateTime(m.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
