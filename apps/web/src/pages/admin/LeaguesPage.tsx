import type { LeagueSummary } from '@sir/shared';
import { LeagueListResponseSchema, LeagueSummarySchema } from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { leagueName } from './ClubPage.tsx';
import { Field, inputClass } from './forms.tsx';

/** While an update is running the list is read again this often. */
export const LEAGUES_REFRESH_MS = 3000;

/** Pure: outcome of the last update of a championship, as a short text. */
export function leagueSyncText(l: LeagueSummary): string {
  if (l.sync.running) return 'Aggiornamento in corso…';
  if (l.sync.status === 'never') return 'Mai scaricato';
  if (l.sync.status === 'error')
    return `Ultimo tentativo ${formatDateTime(l.sync.at)} non riuscito: ${l.sync.message ?? 'errore'}`;
  const ok = `Aggiornato ${formatDateTime(l.sync.lastSuccessAt)}`;
  return l.sync.message ? `${ok} · ${l.sync.message}` : ok;
}

/** Pure: when the next automatic update runs. */
export function leaguePlanText(l: LeagueSummary, now: number): string {
  if (!l.plan.nextSyncAt) return 'Aggiornamenti automatici spenti sul server (LEAGUE_SYNC=off).';
  const at = Date.parse(l.plan.nextSyncAt);
  const when = at <= now ? 'appena possibile' : formatDateTime(l.plan.nextSyncAt);
  return l.plan.matchToday
    ? `Oggi c’è una partita di un club: ogni 10 minuti, prossimo ${when}.`
    : `Ogni notte alle 04:00, prossimo ${when}.`;
}

/** A championship of the Lega Pallavolo Serie A by its IdCampionato (different every season), downloaded at once. */
function AddLeague({ onAdded }: { onAdded: () => void }) {
  const errorMessage = useApiError();
  const [externalId, setExternalId] = useState('');
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const id = Number(externalId);
    const year = Number(season);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(year) || year < 1945 || year > 2100) {
      setError('Scrivi l’IdCampionato (un numero) e il primo anno della stagione (es. 2026).');
      return;
    }
    setBusy(true);
    try {
      const league = await apiRequest('/api/admin/leagues', LeagueSummarySchema, {
        method: 'POST',
        body: { provider: 'legavolley', externalId: id, season: year },
      });
      await apiRequest(`/api/admin/leagues/${encodeURIComponent(league.id)}/sync`, LeagueSummarySchema, {
        method: 'POST',
        body: {},
      });
      setExternalId('');
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Nuovo campionato della Lega"
      subtitle="I campionati sono comuni a tutti i clienti e si scaricano dal sito ufficiale."
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label="IdCampionato" hint="Dal sito legavolley.it: cambia ogni stagione (SuperLega 2026/27 = 999).">
          <input
            inputMode="numeric"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value.trim())}
            className={inputClass}
          />
        </Field>
        <Field label="Stagione (primo anno)" hint="2026 = stagione 2026/2027.">
          <input
            inputMode="numeric"
            value={season}
            onChange={(e) => setSeason(e.target.value.trim())}
            className={inputClass}
          />
        </Field>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Aggiunta…' : 'Aggiungi e scarica'}
        </Button>
      </form>
    </Card>
  );
}

function LeagueItem({ l, now, onChanged }: { l: LeagueSummary; now: number; onChanged: () => void }) {
  const errorMessage = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sync = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/admin/leagues/${encodeURIComponent(l.id)}/sync`, LeagueSummarySchema, {
        method: 'POST',
        body: {},
      });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const tone = l.sync.running ? 'text-warn' : l.sync.status === 'error' ? 'text-danger' : 'text-muted';
  return (
    <li className="space-y-2 py-3" data-testid="league">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-text">{leagueName(l)}</p>
          <p className="text-xs text-muted">
            IdCampionato {l.externalId} · {l.teamCount} squadre · {l.fixtureCount} partite
          </p>
          <p role="status" className={`text-sm ${tone}`}>
            {leagueSyncText(l)}
          </p>
          <p className="text-xs text-muted">{leaguePlanText(l, now)}</p>
        </div>
        <Button onClick={() => void sync()} disabled={busy || l.sync.running}>
          {busy ? 'Avvio…' : l.sync.running ? 'In corso…' : 'Aggiorna ora'}
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </li>
  );
}

/**
 * «Campionati» (superadmin): the championships downloaded from the site of the Lega, common to every client, with
 * the outcome of the last update, «Aggiorna ora» and the next automatic update (every night at 04:00, every 10
 * minutes on the days with a match of a club); a new championship by its IdCampionato.
 */
export function LeaguesPage() {
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/leagues', LeagueListResponseSchema, { signal }),
    [],
  );
  const leagues = useAsync(load);
  const running = leagues.data?.leagues.some((l) => l.sync.running) ?? false;
  const { reload } = leagues;

  useEffect(() => {
    document.title = 'Campionati · Area riservata';
  }, []);
  // While an update runs, its outcome appears by itself.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(reload, LEAGUES_REFRESH_MS);
    return () => clearInterval(id);
  }, [running, reload]);

  const list = leagues.data?.leagues;
  const now = Date.now();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card
        title="Campionati"
        subtitle="Calendari, classifiche e loghi scaricati dal sito della Lega Pallavolo Serie A, per tutti i clienti."
      >
        {leagues.loading && !list && <Spinner label="Caricamento dei campionati…" />}
        {leagues.error !== null && <ErrorBox onRetry={reload}>{errorMessage(leagues.error)}</ErrorBox>}
        {list && list.length === 0 && <Empty>Nessun campionato: aggiungilo con il suo IdCampionato.</Empty>}
        {list && list.length > 0 && (
          <ul className="divide-y divide-grid">
            {list.map((l) => (
              <LeagueItem key={l.id} l={l} now={now} onChanged={reload} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          Pianificazione automatica: ogni notte alle 04:00 (ora italiana) con la classifica; nei giorni con una partita
          di un club, ogni 10 minuti.
        </p>
      </Card>
      <AddLeague onAdded={reload} />
    </div>
  );
}
