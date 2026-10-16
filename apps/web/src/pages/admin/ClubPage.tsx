import type { ClubLeagueChoice, ClubLeagueOption, ClubResponse } from '@sir/shared';
import {
  CLUB_MAX_LEAGUES,
  ClubResponseSchema,
  ClubSyncResponseSchema,
  ClubTeamsResponseSchema,
  LeagueSummarySchema,
  seasonLabel,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError, useAuth } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';

/** Pure: name of a championship in the lists («Regular Season SuperLega 2026/2027», or its IdCampionato until known). */
export function leagueName(l: Pick<ClubLeagueOption, 'name' | 'season' | 'externalId'>): string {
  return `${l.name ?? `Campionato ${l.externalId}`} ${seasonLabel(l.season)}`;
}

/** Pure: state of the last update of a championship, as a short text. */
export function syncText(l: ClubLeagueOption): string {
  if (l.sync.running) return 'Aggiornamento in corso…';
  if (l.sync.status === 'never') return 'Mai scaricato';
  if (l.sync.status === 'error') return `Ultimo aggiornamento non riuscito: ${l.sync.message ?? 'errore'}`;
  const when = `aggiornato ${formatDateTime(l.sync.lastSuccessAt)}`;
  return l.sync.message ? `${when} · ${l.sync.message}` : when;
}

/** Choice of the team of the club among the teams of the downloaded championship. */
function TeamSelect({
  leagueId,
  value,
  onChange,
}: {
  leagueId: string;
  value: string | null;
  onChange: (teamId: string | null) => void;
}) {
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) =>
      apiRequest(`/api/admin/club/leagues/${encodeURIComponent(leagueId)}/teams`, ClubTeamsResponseSchema, { signal }),
    [leagueId],
  );
  const teams = useAsync(load);
  if (teams.error !== null) return <ErrorBox onRetry={teams.reload}>{errorMessage(teams.error)}</ErrorBox>;
  const list = teams.data?.teams ?? [];
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={inputClass}
      aria-label="Squadra del club"
      disabled={teams.loading && !teams.data}
    >
      <option value="">
        {teams.loading && !teams.data
          ? 'Caricamento delle squadre…'
          : list.length === 0
            ? 'Nessuna squadra: aggiorna il calendario'
            : 'Scegli la squadra del club'}
      </option>
      {list.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
          {t.city ? ` (${t.city})` : ''}
        </option>
      ))}
    </select>
  );
}

/** Superadmin: a championship of the Lega Pallavolo Serie A by its IdCampionato (different every season). */
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
      subtitle="Solo superadmin: i campionati sono comuni a tutti i clienti e si scaricano dal sito ufficiale."
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
        <Button type="submit" disabled={busy}>
          {busy ? 'Aggiunta…' : 'Aggiungi e scarica'}
        </Button>
      </form>
    </Card>
  );
}

function ClubForm({
  club,
  onSaved,
  reload,
}: {
  club: ClubResponse;
  onSaved: (c: ClubResponse) => void;
  reload: () => void;
}) {
  const errorMessage = useApiError();
  const { isSuperadmin } = useAuth();
  const [choices, setChoices] = useState<ClubLeagueChoice[]>(() =>
    club.leagues.map((l) => ({ leagueId: l.league.id, teamId: l.team?.id ?? null })),
  );
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const byId = new Map(club.available.map((l) => [l.id, l]));
  const free = club.available.filter((l) => !choices.some((c) => c.leagueId === l.id));
  const saved = club.leagues.map((l) => ({ leagueId: l.league.id, teamId: l.team?.id ?? null }));
  const dirty = JSON.stringify(saved) !== JSON.stringify(choices);

  const set = (index: number, choice: ClubLeagueChoice): void =>
    setChoices((list) => list.map((c, i) => (i === index ? choice : c)));

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest('/api/admin/club', ClubResponseSchema, {
        method: 'PUT',
        body: { leagues: choices },
      });
      onSaved(res);
      setNotice('Campionati salvati: le partite del club sono nel «Calendario», ognuna con il suo link.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sync = async (): Promise<void> => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest('/api/admin/club/sync', ClubSyncResponseSchema, { method: 'POST', body: {} });
      setNotice(
        res.started > 0
          ? 'Aggiornamento avviato: calendario, classifica e loghi arrivano dal sito ufficiale in pochi minuti.'
          : 'Aggiornamento già in corso.',
      );
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card
      title="Campionati"
      subtitle="Uno o più (per esempio regular season e play off): per ognuno la squadra del club."
      actions={
        <Button onClick={() => void sync()} disabled={syncing || club.leagues.length === 0}>
          {syncing ? 'Avvio…' : 'Aggiorna calendario'}
        </Button>
      }
    >
      <div className="space-y-4">
        {club.available.length === 0 && (
          <Empty>
            Nessun campionato disponibile.{' '}
            {isSuperadmin ? 'Aggiungilo qui sotto.' : 'Chiedi al superadmin di aggiungere il campionato del club.'}
          </Empty>
        )}
        {choices.length > 0 && (
          <ul className="divide-y divide-grid">
            {choices.map((choice, index) => {
              const league = byId.get(choice.leagueId);
              return (
                <li key={choice.leagueId} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0 space-y-2">
                    <div className="min-w-0 space-y-1">
                      <select
                        value={choice.leagueId}
                        onChange={(e) => set(index, { leagueId: e.target.value, teamId: null })}
                        className={inputClass}
                        aria-label="Campionato"
                      >
                        {[...(league ? [league] : []), ...free].map((l) => (
                          <option key={l.id} value={l.id}>
                            {leagueName(l)}
                          </option>
                        ))}
                      </select>
                      {league && <p className="text-xs text-muted">{syncText(league)}</p>}
                    </div>
                    <TeamSelect
                      leagueId={choice.leagueId}
                      value={choice.teamId}
                      onChange={(teamId) => set(index, { ...choice, teamId })}
                    />
                  </div>
                  <Button variant="ghost" onClick={() => setChoices((list) => list.filter((_, i) => i !== index))}>
                    Togli
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={free.length === 0 || choices.length >= CLUB_MAX_LEAGUES}
            onClick={() => {
              const next = free[0];
              if (next) setChoices((list) => [...list, { leagueId: next.id, teamId: null }]);
            }}
          >
            Aggiungi campionato
          </Button>
          <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </Button>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {notice && (
          <p role="status" className="text-sm text-text">
            {notice}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * «Club»: name and logo of the club (from «Grafica»), «nostra squadra» of the `.dvw` files, the championships of the
 * club and its team in each (from the championships downloaded from the official site), «Aggiorna calendario». The
 * superadmin can also add a championship of the Lega by its IdCampionato.
 */
export function ClubPage() {
  const errorMessage = useApiError();
  const { isSuperadmin } = useAuth();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/club', ClubResponseSchema, { signal }), []);
  const club = useAsync(load);
  const [current, setCurrent] = useState<ClubResponse | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    document.title = 'Club · Area riservata';
  }, []);
  useEffect(() => {
    if (club.data) {
      setCurrent(club.data);
      setVersion((v) => v + 1);
    }
  }, [club.data]);

  if (club.error !== null && !current) return <ErrorBox onRetry={club.reload}>{errorMessage(club.error)}</ErrorBox>;
  if (!current) return <Spinner label="Caricamento del club…" />;
  const our = current.ourTeam;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card title="Club">
          <div className="flex items-center gap-4">
            {current.logoUrl ? (
              <img src={current.logoUrl} alt="" className="size-16 rounded-card bg-surface-2 object-contain p-1" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-card bg-surface-2 text-xs text-muted">
                Nessun logo
              </span>
            )}
            <div className="min-w-0">
              <p className="break-words font-display text-xl font-bold uppercase tracking-wide text-text">
                {current.name}
              </p>
              <p className="text-sm text-muted">Nome e logo si cambiano nella pagina «Grafica».</p>
            </div>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <dt className="font-medium text-text">Nostra squadra nei file .dvw</dt>
            <dd className="text-muted">
              {our.code || our.name
                ? [our.code && `codice ${our.code}`, our.name && `nome che contiene «${our.name}»`]
                    .filter(Boolean)
                    .join(', ')
                : 'non impostata: si imposta da sola quando scegli la squadra del club'}
            </dd>
          </dl>
          <Link to="/admin/grafica" className={`${buttonClass()} mt-4`}>
            Apri «Grafica»
          </Link>
        </Card>
        {isSuperadmin && <AddLeague onAdded={club.reload} />}
      </div>
      <ClubForm key={version} club={current} onSaved={setCurrent} reload={club.reload} />
    </div>
  );
}
