import type { ClubFixture, ClubFixtureState, ClubFixtureTeam, PendingMatch } from '@sir/shared';
import { CalendarResponseSchema, ClubSyncResponseSchema, formatShortCode } from '@sir/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, CopyButton, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatFixtureDate } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { ShareQr } from '../../qr/ShareQr.tsx';
import { useApiError } from './auth.tsx';
import { inputClass } from './forms.tsx';

export const STATE_TEXT: Record<ClubFixtureState, string> = {
  scheduled: 'Programmata',
  live: 'In diretta',
  finished: 'Finita',
  postponed: 'Rinviata',
  pending: 'Da confermare',
  removed: 'Non più in calendario',
};

const STATE_CLASS: Record<ClubFixtureState, string> = {
  scheduled: 'border-border text-muted',
  live: 'border-badge-live-border bg-badge-live text-on-badge-live',
  finished: 'border-badge-final-border text-text',
  postponed: 'border-warn text-warn',
  pending: 'border-warn text-warn',
  removed: 'border-danger text-danger',
};

/** Pure: «Avversario – dom 18 ott 2026» for the choices of a `.dvw` to confirm. */
export function fixtureChoiceText(f: ClubFixture): string {
  const opponent = f.ourSide === 'home' ? f.away.name : f.home.name;
  const where = f.ourSide === 'home' ? 'in casa' : 'in trasferta';
  return `${opponent} (${where}) – ${formatFixtureDate(f.startsAt).date}`;
}

function TeamCell({ team, our }: { team: ClubFixtureTeam; our: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {team.logoUrl ? (
        <img src={team.logoUrl} alt="" className="size-8 shrink-0 rounded bg-surface-2 object-contain" />
      ) : (
        <span aria-hidden="true" className="size-8 shrink-0 rounded bg-surface-2" />
      )}
      <span className={`min-w-0 break-words ${our ? 'font-semibold text-text' : 'text-text'}`}>{team.name}</span>
    </span>
  );
}

function FixtureItem({ f }: { f: ClubFixture }) {
  const [qr, setQr] = useState(false);
  const when = formatFixtureDate(f.startsAt);
  const sets = f.match?.setsWon ?? f.result;
  return (
    <li className="space-y-3 py-3" data-testid="calendar-fixture">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_18rem] space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">
            {f.roundLabel} · {when.date}
            {f.startsAt && ` · ore ${when.time}`}
          </p>
          <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
            <TeamCell team={f.home} our={f.ourSide === 'home'} />
            <span className="text-sm font-semibold text-muted">{sets ? `${sets.home} - ${sets.away}` : 'vs'}</span>
            <TeamCell team={f.away} our={f.ourSide === 'away'} />
          </div>
          {(f.venue || f.venueCity) && (
            <p className="text-xs text-muted">{[f.venue, f.venueCity].filter(Boolean).join(' · ')}</p>
          )}
          {f.match && (
            <p className="text-xs text-muted">
              File .dvw:{' '}
              <Link className="text-text underline" to={`/admin/partite/${f.match.id}`}>
                {[f.match.homeName, f.match.awayName].filter(Boolean).join(' – ') || 'partita'}
              </Link>
              {f.match.link === 'manual' ? ' (abbinata a mano)' : ' (abbinata da sola)'}
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${STATE_CLASS[f.state]}`}
        >
          {STATE_TEXT[f.state]}
        </span>
      </div>
      {f.link?.shortUrl && f.link.shortCode ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              Link <span className="font-mono text-text select-all">{f.link.shortUrl}</span> · codice{' '}
              <span className="font-mono font-semibold text-text">{formatShortCode(f.link.shortCode)}</span>
            </span>
            <CopyButton text={f.link.shortUrl} label="Copia link" />
            <Button variant="ghost" aria-expanded={qr} onClick={() => setQr((q) => !q)}>
              {qr ? 'Nascondi QR' : 'Scarica QR'}
            </Button>
          </div>
          {qr && <ShareQr url={f.link.shortUrl} code={f.link.shortCode} />}
        </div>
      ) : (
        <p className="text-sm text-muted">{f.link?.revoked ? 'Link revocato.' : 'Link non ancora pronto.'}</p>
      )}
    </li>
  );
}

/** A `.dvw` whose match of the calendar the admin confirms: one of the candidates, any match, or «nessuna». */
function PendingItem({ m, fixtures, onDone }: { m: PendingMatch; fixtures: ClubFixture[]; onDone: () => void }) {
  const errorMessage = useApiError();
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const candidates = m.candidates.filter((c) => byId.has(c.clientFixtureId));
  const [choice, setChoice] = useState<string>(candidates[0]?.clientFixtureId ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiCommand(`/api/admin/matches/${encodeURIComponent(m.id)}/fixture`, {
        method: 'PUT',
        body: { clientFixtureId: choice === 'none' ? null : choice },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  const title = [m.homeName, m.awayName].filter(Boolean).join(' – ') || m.matchKey;
  return (
    <li className="space-y-3 py-3">
      <div>
        <p className="font-medium text-text">
          {title}
          {m.live && <span className="ml-2 text-xs font-semibold uppercase text-live">live</span>}
        </p>
        <p className="text-xs text-muted">
          Data nel file: {m.date ? formatFixtureDate(`${m.date}T12:00:00Z`).date : 'non indicata'} ·{' '}
          {candidates.length === 0
            ? 'nessuna partita del calendario corrisponde (amichevole?)'
            : `${candidates.length === 1 ? 'una partita simile' : `${candidates.length} partite simili`} nel calendario`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className={`${inputClass} max-w-md`}
          aria-label={`Partita del calendario di ${title}`}
        >
          {candidates.map((c) => {
            const f = byId.get(c.clientFixtureId);
            return f ? (
              <option key={c.clientFixtureId} value={c.clientFixtureId}>
                {fixtureChoiceText(f)} · somiglianza {Math.round(c.score * 100)}%
              </option>
            ) : null;
          })}
          <option value="none">Nessuna (amichevole)</option>
          <optgroup label="Altre partite del calendario">
            {fixtures
              .filter((f) => !candidates.some((c) => c.clientFixtureId === f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {fixtureChoiceText(f)}
                </option>
              ))}
          </optgroup>
        </select>
        <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Conferma…' : 'Conferma'}
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </li>
  );
}

/**
 * «Calendario»: the matches of the club from the calendars of its championships (date, time, teams with logos,
 * venue, state) with the link of each (copy, QR), the `.dvw` to confirm and «Aggiorna calendario».
 */
export function CalendarPage() {
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/calendar', CalendarResponseSchema, { signal }),
    [],
  );
  const calendar = useAsync(load);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Calendario · Area riservata';
  }, []);

  const sync = async (): Promise<void> => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest('/api/admin/club/sync', ClubSyncResponseSchema, { method: 'POST', body: {} });
      setNotice(
        res.started + res.busy === 0
          ? 'Nessun campionato scelto: scegli campionato e squadra nella pagina «Club».'
          : 'Aggiornamento avviato: ricarica tra qualche minuto per vedere orari e risultati nuovi.',
      );
      calendar.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const data = calendar.data;
  return (
    <div className="space-y-4">
      {data && data.pending.length > 0 && (
        <Card
          title="Da confermare"
          subtitle="File .dvw di cui il server non è sicuro della partita del calendario: intanto la partita ha i suoi link come sempre."
        >
          <ul className="divide-y divide-grid">
            {data.pending.map((m) => (
              <PendingItem key={m.id} m={m} fixtures={data.fixtures} onDone={calendar.reload} />
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="Calendario"
        subtitle="Le partite della squadra del club, ognuna con il suo link e il suo QR, pronti prima della gara."
        actions={
          <Button onClick={() => void sync()} disabled={syncing}>
            {syncing ? 'Avvio…' : 'Aggiorna calendario'}
          </Button>
        }
      >
        {calendar.loading && !data && <Spinner label="Caricamento del calendario…" />}
        {calendar.error !== null && <ErrorBox onRetry={calendar.reload}>{errorMessage(calendar.error)}</ErrorBox>}
        {error && <ErrorBox>{error}</ErrorBox>}
        {notice && (
          <p role="status" className="mb-2 text-sm text-text">
            {notice}
          </p>
        )}
        {data && data.fixtures.length === 0 && (
          <Empty>
            Nessuna partita: scegli campionato e squadra nella pagina{' '}
            <Link to="/admin/club" className="underline">
              «Club»
            </Link>
            .
          </Empty>
        )}
        {data && data.fixtures.length > 0 && (
          <ul className="divide-y divide-grid">
            {data.fixtures.map((f) => (
              <FixtureItem key={f.id} f={f} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
