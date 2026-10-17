import type { ClubFixture, CreateShareTokenResponse, MatchSummary, ShareTokenSummary } from '@sir/shared';
import {
  CalendarResponseSchema,
  ClubResponseSchema,
  CreateShareTokenRequestSchema,
  CreateShareTokenResponseSchema,
  formatShortCode,
  ShareTokenSummarySchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button, Card, CopyButton, Empty, ErrorBox, SecretBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { READ_ONLY_TEXT, useCanEdit } from '../../lib/useCanEdit.ts';
import { ShareQr } from '../../qr/ShareQr.tsx';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { MatchListSchema } from './MatchesPage.tsx';
import { matchTitle } from './matchText.ts';

const ShareListSchema = z.array(ShareTokenSummarySchema);

function linkState(s: ShareTokenSummary, now: number): { text: string; className: string } {
  if (s.revoked) return { text: 'Revocato', className: 'text-danger' };
  if (s.expiresAt && Date.parse(s.expiresAt) <= now) return { text: 'Scaduto', className: 'text-warn' };
  return { text: 'Attivo', className: 'text-live' };
}

/** What a link shows, as written in the list. */
export function linkTargetText(s: Pick<ShareTokenSummary, 'clientFixtureId' | 'matchId'>, matchName?: string): string {
  if (s.clientFixtureId) return 'Partita del calendario (creato dal «Calendario»)';
  if (s.matchId) return `Partita: ${matchName ?? s.matchId}`;
  return 'Canale del club: tutte le partite del calendario';
}

const shortWhen = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Pure: a match of the calendar in the menu, «Perugia – Trento · sab 25/10, 18:00», our team with the club name. */
export function fixtureOptionText(
  f: Pick<ClubFixture, 'home' | 'away' | 'ourSide' | 'startsAt'>,
  ourName: string | null,
): string {
  const name = (side: 'home' | 'away') => (side === f.ourSide && ourName ? ourName : f[side].name);
  const when = f.startsAt ? shortWhen.format(new Date(f.startsAt)) : 'data da definire';
  return `${name('home')} – ${name('away')} · ${when}`;
}

/** A choice of «Una partita fissa»: a match of the calendar (its own link) or a `.dvw` live outside the calendar. */
export type FixedChoice =
  | { key: string; kind: 'fixture'; text: string; fixture: ClubFixture }
  | { key: string; kind: 'match'; text: string; matchId: string };

/**
 * Pure: what «Una partita fissa» offers. First what is live now (a match of the calendar being played, or a `.dvw`
 * live outside the calendar), then the coming matches of the calendar (not hidden, broadcast, not over), in order of
 * time; no past match. A match coming from «Partite» (`preset`) stays in the list.
 */
export function fixedChoices(input: {
  fixtures: readonly ClubFixture[];
  matches: readonly MatchSummary[];
  ourName: string | null;
  now: number;
  preset?: string | null;
}): FixedChoice[] {
  const { fixtures, matches, ourName, now, preset } = input;
  const visible = fixtures.filter((f) => !f.hidden && f.broadcasted && f.state !== 'removed' && f.state !== 'finished');
  const inCalendar = new Set(fixtures.flatMap((f) => (f.match ? [f.match.id] : [])));
  const out: FixedChoice[] = [];
  for (const f of visible.filter((f) => f.state === 'live'))
    out.push({ key: `f:${f.id}`, kind: 'fixture', text: `In diretta: ${fixtureOptionText(f, ourName)}`, fixture: f });
  for (const m of matches.filter((m) => m.live && m.status !== 'finished' && !inCalendar.has(m.id)))
    out.push({ key: `m:${m.id}`, kind: 'match', text: `In diretta: ${matchTitle(m)}`, matchId: m.id });
  const coming = visible
    .filter((f) => f.state !== 'live' && f.startsAt !== null && Date.parse(f.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? ''));
  for (const f of coming)
    out.push({ key: `f:${f.id}`, kind: 'fixture', text: fixtureOptionText(f, ourName), fixture: f });
  const presetMatch = preset ? matches.find((m) => m.id === preset) : undefined;
  if (presetMatch && !out.some((c) => c.key === `m:${presetMatch.id}`))
    out.push({
      key: `m:${presetMatch.id}`,
      kind: 'match',
      text: `${matchTitle(presetMatch)} · ${formatDateTime(presetMatch.updatedAt)}`,
      matchId: presetMatch.id,
    });
  return out;
}

/**
 * Public links: create (channel of the club or fixed match, optional expiry), long URL shown once with Copy, short link and QR code
 * of every active link (copy, PNG and SVG download), revoke.
 */
export function ShareLinksPage() {
  const errorMessage = useApiError();
  const [search] = useSearchParams();
  const preset = search.get('partita');
  const loadLinks = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/share-tokens', ShareListSchema, { signal }),
    [],
  );
  const loadMatches = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/matches', MatchListSchema, { signal }),
    [],
  );
  const loadCalendar = useCallback(
    (signal: AbortSignal) =>
      Promise.all([
        apiRequest('/api/admin/calendar', CalendarResponseSchema, { signal }),
        apiRequest('/api/admin/club', ClubResponseSchema, { signal }),
      ]).then(([calendar, club]) => ({ fixtures: calendar.fixtures, ourName: club.name })),
    [],
  );
  const links = useAsync(loadLinks);
  const matches = useAsync(loadMatches);
  const calendar = useAsync(loadCalendar);
  const [showRevoked, setShowRevoked] = useState(false);
  const [label, setLabel] = useState('');
  const canEdit = useCanEdit();
  const [mode, setMode] = useState<'channel' | 'match'>(preset ? 'match' : 'channel');
  const [choiceKey, setChoiceKey] = useState(preset ? `m:${preset}` : '');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateShareTokenResponse | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const now = Date.now();

  useEffect(() => {
    document.title = 'Link pubblici · Area riservata';
  }, []);

  const matchById = new Map<string, MatchSummary>((matches.data ?? []).map((m) => [m.id, m]));
  const choices = fixedChoices({
    fixtures: calendar.data?.fixtures ?? [],
    matches: matches.data ?? [],
    ourName: calendar.data?.ourName ?? null,
    now,
    preset,
  });
  const choice = mode === 'match' ? choices.find((c) => c.key === choiceKey) : undefined;
  // A match of the calendar has its own link already (made by the server, one per match): it is shown, never doubled.
  const fixtureLink = choice?.kind === 'fixture' ? choice.fixture.link : undefined;
  const loadingChoices = matches.loading || calendar.loading;
  const revokedCount = (links.data ?? []).filter((s) => s.revoked).length;
  const shownLinks = (links.data ?? []).filter((s) => showRevoked || !s.revoked);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    let expiresAt: string | null = null;
    if (expires) {
      const d = new Date(expires);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        setFormError('La scadenza deve essere una data futura.');
        return;
      }
      expiresAt = d.toISOString();
    }
    const body = CreateShareTokenRequestSchema.safeParse({
      label: label.trim(),
      matchId: mode === 'channel' ? null : choice?.kind === 'match' ? choice.matchId : undefined,
      expiresAt,
    });
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      setFormError(
        field === 'matchId'
          ? 'Scegli la partita da mostrare.'
          : 'Scrivi un’etichetta (al massimo 100 caratteri, senza caratteri speciali).',
      );
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest('/api/admin/share-tokens', CreateShareTokenResponseSchema, {
        method: 'POST',
        body: body.data,
      });
      setCreated(res);
      setLabel('');
      setExpires('');
      links.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setRevoking(id);
    setListError(null);
    try {
      await apiCommand(`/api/admin/share-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
      links.reload();
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className={canEdit ? 'grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]' : 'space-y-4'}>
      {canEdit && (
        <Card title="Nuovo link pubblico">
          <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
            <Field label="Etichetta" hint="Per riconoscerlo nell’elenco, es. «Tribuna» o «Maxischermo».">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                required
                className={inputClass}
              />
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-text">Cosa mostra</legend>
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="radio" name="mode" checked={mode === 'channel'} onChange={() => setMode('channel')} />
                Tutte le partite del calendario (canale del club)
              </label>
              {mode === 'channel' && (
                <p className="text-xs text-muted">
                  Mostra la partita in diretta; senza diretta la prossima partita trasmessa con il conto alla rovescia;
                  finita una partita resta su di essa fino al giorno della successiva.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="radio" name="mode" checked={mode === 'match'} onChange={() => setMode('match')} />
                Una partita fissa
              </label>
              {mode === 'match' && (
                <select
                  value={choiceKey}
                  onChange={(e) => setChoiceKey(e.target.value)}
                  className={inputClass}
                  aria-label="Partita"
                >
                  <option value="">
                    {loadingChoices
                      ? 'Caricamento…'
                      : choices.length
                        ? 'Scegli la partita'
                        : 'Nessuna partita in programma'}
                  </option>
                  {choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.text}
                    </option>
                  ))}
                </select>
              )}
              {mode === 'match' && (
                <p className="text-xs text-muted">
                  Le prossime partite del calendario e quella in diretta. Una partita del calendario ha già il suo link:
                  prima della gara mostra «Prossima partita», poi la diretta.
                </p>
              )}
            </fieldset>
            <Field label="Scadenza (facoltativa)" hint="Vuota: il link vale finché non lo revochi.">
              <input
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className={inputClass}
              />
            </Field>
            {formError && <ErrorBox>{formError}</ErrorBox>}
            {fixtureLink !== undefined ? (
              <ExistingFixtureLink link={fixtureLink} />
            ) : (
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Creazione…' : 'Crea link'}
              </Button>
            )}
          </form>
          {created && (
            <div className="mt-4">
              <SecretBox title={`Link «${created.label}»: copialo ora, non sarà più mostrato.`} value={created.url}>
                <p className="text-xs text-muted">Aggiungi «?tv=1» in fondo per la modalità maxischermo.</p>
                {created.shortUrl && (
                  <p className="text-xs text-muted">
                    Link breve (sempre disponibile nell’elenco, con il QR):{' '}
                    <span className="font-mono text-text select-all">{created.shortUrl}</span>
                  </p>
                )}
              </SecretBox>
            </div>
          )}
        </Card>
      )}

      <Card title="Link creati">
        {!canEdit && <p className="mb-2 text-sm text-muted">{READ_ONLY_TEXT}</p>}
        {links.loading && !links.data && <Spinner label="Caricamento dei link…" />}
        {links.error !== null && <ErrorBox onRetry={links.reload}>{errorMessage(links.error)}</ErrorBox>}
        {listError && <ErrorBox>{listError}</ErrorBox>}
        {links.data && links.data.length === 0 && <Empty>Nessun link creato.</Empty>}
        {revokedCount > 0 && (
          <Button variant="ghost" onClick={() => setShowRevoked((v) => !v)} aria-pressed={showRevoked}>
            {showRevoked ? `Nascondi revocati (${revokedCount})` : `Mostra revocati (${revokedCount})`}
          </Button>
        )}
        {links.data && shownLinks.length > 0 && (
          <ul className="divide-y divide-grid">
            {shownLinks.map((s) => {
              const st = linkState(s, now);
              const target = s.matchId ? matchById.get(s.matchId) : undefined;
              return (
                <li key={s.id} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-text">
                        {s.label}{' '}
                        <span className={`ml-1 text-xs font-semibold uppercase ${st.className}`}>{st.text}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {linkTargetText(s, target ? matchTitle(target) : undefined)} · scadenza{' '}
                        {s.expiresAt ? formatDateTime(s.expiresAt) : 'nessuna'} · creato {formatDateTime(s.createdAt)}
                      </p>
                    </div>
                    {canEdit && !s.revoked && (
                      <ConfirmButton
                        label="Revoca"
                        confirmLabel="Conferma revoca"
                        busy={revoking === s.id}
                        onConfirm={() => void revoke(s.id)}
                      />
                    )}
                  </div>
                  {s.shortUrl && s.shortCode && st.text === 'Attivo' && (
                    <div className="space-y-2">
                      <p className="text-sm text-muted">
                        Link breve <span className="font-mono text-text select-all">{s.shortUrl}</span> · codice{' '}
                        <span className="font-mono font-semibold text-text">{formatShortCode(s.shortCode)}</span>
                      </p>
                      <ShareQr url={s.shortUrl} code={s.shortCode} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** The link a match of the calendar already has (copy and QR), instead of a new one. */
function ExistingFixtureLink({ link }: { link: ClubFixture['link'] }) {
  if (!link)
    return (
      <p role="status" className="rounded-card bg-surface-2 px-3 py-2 text-sm text-text">
        Il link di questa partita non è ancora pronto: si crea al prossimo aggiornamento del calendario.
      </p>
    );
  if (link.revoked || !link.shortUrl || !link.shortCode)
    return (
      <p role="status" className="rounded-card bg-surface-2 px-3 py-2 text-sm text-text">
        Il link di questa partita è stato revocato: non se ne crea un altro (vedi «Calendario»).
      </p>
    );
  return (
    <div role="status" className="space-y-2 rounded-card border border-live bg-success-soft p-3">
      <p className="text-sm font-semibold text-text">Questa partita ha già il suo link</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all font-mono text-sm text-text select-all">{link.shortUrl}</span>
        <CopyButton text={link.shortUrl} label="Copia link" />
      </div>
      <ShareQr url={link.shortUrl} code={link.shortCode} actions={false} />
    </div>
  );
}
