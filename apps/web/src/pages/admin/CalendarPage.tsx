import type {
  ClubFixture,
  ClubFixtureState,
  ClubFixtureTeam,
  FixtureBroadcast,
  FixtureSettingsRequest,
  ManualFixtureKind,
  ManualFixtureRequest,
  PendingMatch,
} from '@arenalive/shared';
import {
  adminAssetPath,
  CalendarResponseSchema,
  ClubSyncResponseSchema,
  CreatedFixtureResponseSchema,
  FixtureDateRequestSchema,
  formatShortCode,
  ManualFixtureRequestSchema,
} from '@arenalive/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, CopyButton, Card, Empty, ErrorBox, Segmented, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatFixtureDate, romeDateTime, romeToIso } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { READ_ONLY_TEXT, useCanEdit } from '../../lib/useCanEdit.ts';
import { MATCH_LINKS_OFF_TEXT, useMatchLinks } from '../../lib/useMatchLinks.ts';
import { ShareQr } from '../../qr/ShareQr.tsx';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { LogoPicker } from './LogoPicker.tsx';

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

export const KIND_TEXT: Record<ManualFixtureKind, string> = { friendly: 'Amichevole', cup: 'Coppa', other: 'Altro' };

const BROADCAST_OPTIONS: { value: FixtureBroadcast; label: string }[] = [
  { value: 'auto', label: 'Come il profilo' },
  { value: 'on', label: 'Trasmessa' },
  { value: 'off', label: 'Non trasmessa' },
];

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

/** Form of a match added by hand (new, or the change of one): kind, date and time, opponent and its logo, venue. */
function ManualFixtureForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: ClubFixture | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const errorMessage = useApiError();
  const start = romeDateTime(initial?.startsAt ?? null);
  const opponentSide = initial?.ourSide === 'away' ? 'home' : 'away';
  const [kind, setKind] = useState<ManualFixtureKind>(initial?.kind ?? 'friendly');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time || '18:00');
  const [opponent, setOpponent] = useState(initial ? initial[opponentSide].name : '');
  const [opponentLogo, setOpponentLogo] = useState<{ id: string; url: string } | null>(initial?.logos.opponent ?? null);
  const [ourSide, setOurSide] = useState<'home' | 'away'>(initial?.ourSide ?? 'home');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [venueCity, setVenueCity] = useState(initial?.venueCity ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const startsAt = romeToIso(date, time);
    if (!startsAt) {
      setError('Scegli data e ora della partita.');
      return;
    }
    const body = ManualFixtureRequestSchema.safeParse({
      kind,
      startsAt,
      opponent: opponent.trim(),
      opponentLogo: opponentLogo?.id ?? null,
      ourSide,
      venue: venue.trim() || null,
      venueCity: venueCity.trim() || null,
    } satisfies ManualFixtureRequest);
    if (!body.success) {
      setError('Scrivi il nome dell’avversario (al massimo 100 caratteri, senza caratteri speciali).');
      return;
    }
    setBusy(true);
    try {
      if (initial) {
        await apiCommand(`/api/admin/calendar/fixtures/${encodeURIComponent(initial.id)}`, {
          method: 'PUT',
          body: body.data,
        });
      } else {
        await apiRequest('/api/admin/calendar/fixtures', CreatedFixtureResponseSchema, {
          method: 'POST',
          body: body.data,
        });
        setOpponent('');
        setOpponentLogo(null);
        setVenue('');
        setVenueCity('');
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate aria-label="Partita aggiunta a mano">
      <Segmented
        label="Tipo di partita"
        value={kind}
        onChange={setKind}
        options={(['friendly', 'cup', 'other'] as const).map((k) => ({ value: k, label: KIND_TEXT[k] }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Ora">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} required />
        </Field>
      </div>
      <Field label="Avversario">
        <input
          value={opponent}
          onChange={(e) => setOpponent(e.target.value)}
          maxLength={100}
          required
          className={inputClass}
        />
      </Field>
      <LogoPicker
        label="Logo dell’avversario (facoltativo)"
        url={opponentLogo?.url ?? null}
        custom={opponentLogo !== null}
        defaultLabel="Togli"
        onChange={async (id) => {
          setOpponentLogo(id ? { id, url: adminAssetPath(id) } : null);
          return Promise.resolve();
        }}
      />
      <Segmented
        label="Dove si gioca"
        value={ourSide}
        onChange={setOurSide}
        options={[
          { value: 'home', label: 'In casa' },
          { value: 'away', label: 'In trasferta' },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Palazzetto (facoltativo)">
          <input value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={100} className={inputClass} />
        </Field>
        <Field label="Città (facoltativa)">
          <input
            value={venueCity}
            onChange={(e) => setVenueCity(e.target.value)}
            maxLength={100}
            className={inputClass}
          />
        </Field>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Salvataggio…' : initial ? 'Salva la partita' : 'Aggiungi la partita'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Annulla
          </Button>
        )}
      </div>
    </form>
  );
}

/** Date and time of a downloaded match changed by hand (Italian time); the update of the calendar leaves it alone. */
function FixtureDateForm({ f, onSaved, onCancel }: { f: ClubFixture; onSaved: () => void; onCancel: () => void }) {
  const errorMessage = useApiError();
  const start = romeDateTime(f.startsAt);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time || '18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const iso = romeToIso(date, time);
    const body = FixtureDateRequestSchema.safeParse({ startsAt: iso });
    if (!iso || !body.success) {
      setError('Scegli data e ora della partita.');
      return;
    }
    setBusy(true);
    try {
      await apiCommand(`/api/admin/calendar/fixtures/${encodeURIComponent(f.id)}/date`, {
        method: 'PUT',
        body: body.data,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" noValidate aria-label="Data e ora della partita">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data (ora italiana)">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Ora (ora italiana)">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} required />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Una data cambiata a mano non si aggiorna più da sola con il calendario della Lega; risultato e stato sì.
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Salva data e ora'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

function FixtureItem({ f, onChanged }: { f: ClubFixture; onChanged: () => void }) {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
  const matchLinks = useMatchLinks();
  const [qr, setQr] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingDate, setChangingDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = formatFixtureDate(f.startsAt);
  const sets = f.match?.setsWon ?? f.result;
  const manual = f.origin === 'manual';
  const opponentSide = f.ourSide === 'home' ? 'away' : 'home';

  const change = async (body: FixtureSettingsRequest): Promise<void> => {
    await apiCommand(`/api/admin/calendar/fixtures/${encodeURIComponent(f.id)}/settings`, { method: 'PATCH', body });
    onChanged();
  };
  const act = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const backToOfficial = () =>
    act(async () => {
      await apiCommand(`/api/admin/calendar/fixtures/${encodeURIComponent(f.id)}/date`, {
        method: 'PUT',
        body: { startsAt: null },
      });
      onChanged();
    });
  const unlink = (matchId: string) =>
    act(async () => {
      await apiCommand(`/api/admin/matches/${encodeURIComponent(matchId)}/fixture`, {
        method: 'PUT',
        body: { clientFixtureId: null },
      });
      onChanged();
    });
  const remove = () =>
    act(async () => {
      await apiCommand(`/api/admin/calendar/fixtures/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      onChanged();
    });

  return (
    <li className="space-y-3 py-3" data-testid="calendar-fixture">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_18rem] space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted">
            {f.roundLabel} · {when.date}
            {f.startsAt && ` · ore ${when.time}`}
            {manual && ' · aggiunta a mano'}
          </p>
          {f.dateOverridden && (
            <p className="flex flex-wrap items-center gap-2 text-xs" data-testid="date-overridden">
              <span className="inline-flex items-center rounded-full border border-warn px-2 py-0.5 font-bold uppercase tracking-wider text-warn">
                Modificata a mano
              </span>
              <span className="text-muted">
                data ufficiale:{' '}
                <s data-testid="official-date">
                  {formatFixtureDate(f.officialStartsAt).date}
                  {f.officialStartsAt && ` · ore ${formatFixtureDate(f.officialStartsAt).time}`}
                </s>
              </span>
            </p>
          )}
          {f.movedByLeague && (
            <p className="text-xs font-semibold text-warn" role="status" data-testid="moved-by-league">
              La Lega ha spostato la partita al {formatFixtureDate(f.officialStartsAt).date}
              {f.officialStartsAt && ` · ore ${formatFixtureDate(f.officialStartsAt).time}`}.
            </p>
          )}
          <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
            <TeamCell team={f.home} our={f.ourSide === 'home'} />
            <span className="text-sm font-semibold text-muted">{sets ? `${sets.home} - ${sets.away}` : 'vs'}</span>
            <TeamCell team={f.away} our={f.ourSide === 'away'} />
          </div>
          {(f.venue || f.venueCity) && (
            <p className="text-xs text-muted">{[f.venue, f.venueCity].filter(Boolean).join(' · ')}</p>
          )}
          {f.match && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="fixture-match">
              <span>File .dvw:</span>
              <Link className="text-text underline" to={`/admin/partite/${f.match.id}`}>
                {[f.match.homeName, f.match.awayName].filter(Boolean).join(' – ') || 'partita'}
              </Link>
              <span>{f.match.link === 'manual' ? '(abbinata a mano)' : '(abbinata da sola)'}</span>
              {canEdit && (
                <ConfirmButton
                  label="Scollega"
                  confirmLabel="Conferma: scollega il file"
                  ariaLabel="Scollega il file .dvw dalla partita"
                  busy={busy}
                  onConfirm={() => void unlink(f.match?.id ?? '')}
                />
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="broadcast-state"
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              f.broadcasted ? 'border-border text-text' : 'border-warn text-warn'
            }`}
          >
            {f.broadcasted ? 'Trasmessa' : 'Non trasmessa'}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${STATE_CLASS[f.state]}`}
          >
            {STATE_TEXT[f.state]}
          </span>
        </div>
      </div>
      {!matchLinks ? null : !f.broadcasted ? (
        <p className="text-sm text-muted">
          Link non attivo: la partita non è trasmessa
          {f.broadcast === 'auto' ? ' (il profilo del club trasmette solo le partite in casa).' : '.'}
        </p>
      ) : f.link?.shortUrl && f.link.shortCode ? (
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
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Chiudi impostazioni' : 'Impostazioni'}
          </Button>
          {manual ? (
            <>
              <Button variant="ghost" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
                {editing ? 'Chiudi modifica' : 'Modifica'}
              </Button>
              <ConfirmButton
                label="Cancella"
                confirmLabel="Conferma cancellazione"
                busy={busy}
                onConfirm={() => void remove()}
              />
            </>
          ) : (
            <>
              <Button variant="ghost" aria-expanded={changingDate} onClick={() => setChangingDate((c) => !c)}>
                {changingDate ? 'Chiudi data e ora' : 'Cambia data e ora'}
              </Button>
              {f.dateOverridden && (
                <Button variant="ghost" disabled={busy} onClick={() => void backToOfficial()}>
                  Torna alla data ufficiale
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => change({ hidden: !f.hidden }))}>
                {f.hidden ? 'Mostra' : 'Nascondi'}
              </Button>
            </>
          )}
        </div>
      )}
      {canEdit && changingDate && !manual && (
        <div className="rounded-card border border-border p-3">
          <FixtureDateForm
            f={f}
            onSaved={() => {
              setChangingDate(false);
              onChanged();
            }}
            onCancel={() => setChangingDate(false)}
          />
        </div>
      )}
      {canEdit && editing && manual && (
        <div className="rounded-card border border-border p-3">
          <ManualFixtureForm
            initial={f}
            onSaved={() => {
              setEditing(false);
              onChanged();
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
      {canEdit && open && (
        <div className="space-y-3 rounded-card border border-border p-3">
          <Segmented
            label="Trasmissione della partita"
            value={f.broadcast}
            onChange={(broadcast) => void act(() => change({ broadcast }))}
            options={BROADCAST_OPTIONS}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <LogoPicker
              label="Logo della nostra squadra"
              url={f[f.ourSide].logoUrl}
              custom={f.logos.our !== null}
              onChange={(ourLogo) => change({ ourLogo })}
            />
            <LogoPicker
              label={`Logo di ${f[opponentSide].name}`}
              url={f[opponentSide].logoUrl}
              custom={f.logos.opponent !== null}
              onChange={(opponentLogo) => change({ opponentLogo })}
            />
          </div>
          <p className="text-xs text-muted">
            Predefiniti: il logo quadrato del profilo per la nostra squadra, quello della Lega per gli avversari.
          </p>
        </div>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </li>
  );
}

/** A `.dvw` whose match of the calendar the admin confirms: one of the candidates, any match, or «nessuna». */
function PendingItem({ m, fixtures, onDone }: { m: PendingMatch; fixtures: ClubFixture[]; onDone: () => void }) {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
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
      {canEdit && (
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
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </li>
  );
}

/**
 * «Calendario»: the matches of the club, from the calendars of its championships and added by hand (friendly, cup,
 * other), with date, time, teams with logos, venue, state and «Trasmessa» / «Non trasmessa», the link of each (copy,
 * QR; only with «Link e QR per singola partita»), the `.dvw` to confirm and «Aggiorna calendario». The admin adds, changes and deletes the matches added by
 * hand, hides the downloaded ones, chooses the broadcast and the logos of each; a viewer only reads.
 */
export function CalendarPage() {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
  const matchLinks = useMatchLinks();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/calendar', CalendarResponseSchema, { signal }),
    [],
  );
  const calendar = useAsync(load);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
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
  const visible = data?.fixtures.filter((f) => !f.hidden) ?? [];
  const hidden = data?.fixtures.filter((f) => f.hidden) ?? [];
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
      {canEdit && adding && (
        <Card
          title="Nuova partita"
          subtitle={
            matchLinks
              ? 'Amichevole, coppa o altro: compare nel calendario con il suo link e il suo QR, e il file .dvw si abbina da solo.'
              : 'Amichevole, coppa o altro: compare nel calendario e il file .dvw si abbina da solo.'
          }
        >
          <ManualFixtureForm
            initial={null}
            onSaved={() => {
              setAdding(false);
              setNotice(matchLinks ? 'Partita aggiunta: il suo link e il QR sono qui sotto.' : 'Partita aggiunta.');
              calendar.reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}
      <Card
        title="Calendario"
        subtitle={
          matchLinks
            ? 'Le partite della squadra del club, ognuna con il suo link e il suo QR, pronti prima della gara.'
            : 'Le partite della squadra del club.'
        }
        actions={
          canEdit ? (
            <span className="inline-flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                {adding ? 'Chiudi' : 'Aggiungi partita'}
              </Button>
              <Button onClick={() => void sync()} disabled={syncing}>
                {syncing ? 'Avvio…' : 'Aggiorna calendario'}
              </Button>
            </span>
          ) : undefined
        }
      >
        {!canEdit && <p className="mb-2 text-sm text-muted">{READ_ONLY_TEXT}</p>}
        {!matchLinks && (
          <p className="mb-2 text-sm text-muted">
            {MATCH_LINKS_OFF_TEXT}{' '}
            <Link to="/admin/link" className="underline">
              Vai ai link pubblici
            </Link>
          </p>
        )}
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
            {canEdit ? ' oppure aggiungi una partita.' : '.'}
          </Empty>
        )}
        {visible.length > 0 && (
          <ul className="divide-y divide-grid">
            {visible.map((f) => (
              <FixtureItem key={f.id} f={f} onChanged={calendar.reload} />
            ))}
          </ul>
        )}
        {hidden.length > 0 && (
          <div className="mt-3 border-t border-grid pt-3">
            <Button variant="ghost" aria-expanded={showHidden} onClick={() => setShowHidden((s) => !s)}>
              {showHidden ? 'Nascondi' : 'Mostra'} le partite nascoste ({hidden.length})
            </Button>
            {showHidden && (
              <ul className="divide-y divide-grid" aria-label="Partite nascoste">
                {hidden.map((f) => (
                  <FixtureItem key={f.id} f={f} onChanged={calendar.reload} />
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
