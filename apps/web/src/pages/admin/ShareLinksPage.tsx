import type { CreateShareTokenResponse, MatchSummary, ShareTokenSummary } from '@sir/shared';
import { CreateShareTokenRequestSchema, CreateShareTokenResponseSchema, ShareTokenSummarySchema } from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, SecretBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
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

/** Public links: create (live or fixed match, optional expiry), URL shown once with Copy, revoke. */
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
  const [mode, setMode] = useState<'live' | 'match'>(preset ? 'match' : 'live');
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
      matchId: mode === 'live' ? null : matchId || undefined,
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
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
              <input type="radio" name="mode" checked={mode === 'live'} onChange={() => setMode('live')} />
              Segue la partita live (anche le prossime)
            </label>
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
            </SecretBox>
          </div>
        )}
      </Card>

      <Card title="Link creati">
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
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">
                      {s.label}{' '}
                      <span className={`ml-1 text-xs font-semibold uppercase ${st.className}`}>{st.text}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {s.matchId ? `Partita: ${target ? matchTitle(target) : s.matchId}` : 'Segue la partita live'} ·
                      scadenza {s.expiresAt ? formatDateTime(s.expiresAt) : 'nessuna'} · creato{' '}
                      {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  {!s.revoked && (
                    <ConfirmButton
                      label="Revoca"
                      confirmLabel="Conferma revoca"
                      busy={revoking === s.id}
                      onConfirm={() => void revoke(s.id)}
                    />
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
