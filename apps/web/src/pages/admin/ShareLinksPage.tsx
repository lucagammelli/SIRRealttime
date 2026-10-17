import type { CreateShareTokenResponse, MatchSummary, ShareTokenSummary } from '@sir/shared';
import {
  CreateShareTokenRequestSchema,
  CreateShareTokenResponseSchema,
  formatShortCode,
  ShareTokenSummarySchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, SecretBox, Spinner } from '../../components/ui.tsx';
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
  const links = useAsync(loadLinks);
  const matches = useAsync(loadMatches);
  const [label, setLabel] = useState('');
  const canEdit = useCanEdit();
  const [mode, setMode] = useState<'channel' | 'match'>(preset ? 'match' : 'channel');
  const [matchId, setMatchId] = useState(preset ?? '');
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
      matchId: mode === 'channel' ? null : matchId || undefined,
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
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                  className={inputClass}
                  aria-label="Partita"
                >
                  <option value="">{matches.loading ? 'Caricamento…' : 'Scegli la partita'}</option>
                  {(matches.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {matchTitle(m)} · {formatDateTime(m.updatedAt)}
                    </option>
                  ))}
                </select>
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
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Creazione…' : 'Crea link'}
            </Button>
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
        {links.data && links.data.length > 0 && (
          <ul className="divide-y divide-grid">
            {links.data.map((s) => {
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
