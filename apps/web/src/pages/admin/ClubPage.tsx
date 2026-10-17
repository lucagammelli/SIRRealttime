import type {
  ClubCoverage,
  ClubLeagueChoice,
  ClubLeagueOption,
  ClubResponse,
  TeamLogosMode,
  UpdateClubProfileRequest,
} from '@sir/shared';
import {
  CLUB_MAX_LEAGUES,
  CLUB_SERIES_MAX,
  ClubResponseSchema,
  ClubSyncResponseSchema,
  ClubTeamsResponseSchema,
  OUR_TEAM_CODE_MAX,
  OUR_TEAM_NAME_MAX,
  publicAssetPath,
  seasonLabel,
  UpdateClubProfileRequestSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass, Card, Empty, ErrorBox, Segmented, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { READ_ONLY_TEXT, useCanEdit } from '../../lib/useCanEdit.ts';
import { useApiError, useAuth } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';
import { LogoPicker } from './LogoPicker.tsx';

export const COVERAGE_TEXT: Record<ClubCoverage, string> = {
  homeAndAway: 'Casa e trasferta',
  homeOnly: 'Solo partite in casa',
};

export const TEAM_LOGOS_TEXT: Record<TeamLogosMode, string> = {
  all: 'Tutti',
  ours: 'Solo il mio',
  none: 'Nessuno',
};

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
  disabled = false,
}: {
  leagueId: string;
  value: string | null;
  onChange: (teamId: string | null) => void;
  disabled?: boolean;
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
      disabled={disabled || (teams.loading && !teams.data)}
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
  const canEdit = useCanEdit();
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
        canEdit ? (
          <Button onClick={() => void sync()} disabled={syncing || club.leagues.length === 0}>
            {syncing ? 'Avvio…' : 'Aggiorna calendario'}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {club.available.length === 0 && (
          <Empty>
            Nessun campionato disponibile.{' '}
            {isSuperadmin ? (
              <Link to="/admin/campionati" className="underline">
                Aggiungilo in «Campionati».
              </Link>
            ) : (
              'Chiedi al superadmin di aggiungere il campionato del club.'
            )}
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
                        disabled={!canEdit}
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
                      disabled={!canEdit}
                    />
                  </div>
                  {canEdit && (
                    <Button variant="ghost" onClick={() => setChoices((list) => list.filter((_, i) => i !== index))}>
                      Togli
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && (
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
        )}
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
 * Profile of the club: name shown, square logo, series, «nostra squadra» of the `.dvw` files, coverage of the matches
 * («casa e trasferta» or «solo partite in casa») and «Loghi delle squadre» (tutti / solo il mio / nessuno). Saved
 * together (`PUT /api/admin/club/profile`); read-only for a viewer.
 */
function ProfileForm({ club, onSaved }: { club: ClubResponse; onSaved: (c: ClubResponse) => void }) {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
  const [displayName, setDisplayName] = useState(club.displayName ?? '');
  const [logoMark, setLogoMark] = useState<string | null>(club.logoMark);
  const [series, setSeries] = useState(club.profile.series ?? '');
  const [code, setCode] = useState(club.ourTeam.code ?? '');
  const [teamName, setTeamName] = useState(club.ourTeam.name ?? '');
  const [coverage, setCoverage] = useState<ClubCoverage>(club.profile.coverage);
  const [teamLogos, setTeamLogos] = useState<TeamLogosMode>(club.profile.teamLogos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const body = UpdateClubProfileRequestSchema.safeParse({
      displayName: displayName.trim() || null,
      logoMark,
      ourTeam: { code: code.trim() || null, name: teamName.trim() || null },
      profile: { series: series.trim() || null, coverage, teamLogos },
    } satisfies UpdateClubProfileRequest);
    if (!body.success) {
      setError('Controlla i campi: testi su una riga, senza caratteri speciali.');
      return;
    }
    setBusy(true);
    try {
      onSaved(await apiRequest('/api/admin/club/profile', ClubResponseSchema, { method: 'PUT', body: body.data }));
      setNotice('Profilo salvato: le pagine pubbliche lo mostrano subito.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Profilo del club"
      subtitle="Come il club compare nelle pagine pubbliche e quali partite si trasmettono."
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        {!canEdit && <p className="text-sm text-muted">{READ_ONLY_TEXT}</p>}
        <fieldset disabled={!canEdit} className="space-y-4">
          <LogoPicker
            label="Logo quadrato del club"
            url={logoMark ? publicAssetPath(logoMark) : null}
            custom={logoMark !== null}
            defaultLabel="Togli"
            disabled={!canEdit}
            onChange={(id) => {
              setLogoMark(id);
              return Promise.resolve();
            }}
          />
          <Field label="Nome" hint={`Vuoto: «${club.name}». Compare nelle pagine pubbliche e nell’app installata.`}>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              className={inputClass}
            />
          </Field>
          <Field label="Serie" hint="Es. «SuperLega» o «Serie A2 femminile» (facoltativa).">
            <input
              value={series}
              onChange={(e) => setSeries(e.target.value)}
              maxLength={CLUB_SERIES_MAX}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Field label="Codice squadra" hint="Nei file .dvw, es. PER.">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={OUR_TEAM_CODE_MAX}
                className={inputClass}
              />
            </Field>
            <Field label="Nome della squadra contiene" hint="Es. «Perugia»: riconosce la nostra squadra nei .dvw.">
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={OUR_TEAM_NAME_MAX}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-text">Partite trasmesse</p>
            <Segmented
              label="Partite trasmesse"
              value={coverage}
              onChange={setCoverage}
              options={(['homeAndAway', 'homeOnly'] as const).map((v) => ({ value: v, label: COVERAGE_TEXT[v] }))}
            />
            <p className="text-xs text-muted">
              Con «solo partite in casa» le trasferte non hanno il link attivo e non compaiono in «Prossima partita».
              Nel «Calendario» ogni partita può fare eccezione.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-text">Loghi delle squadre</p>
            <Segmented
              label="Loghi delle squadre"
              value={teamLogos}
              onChange={setTeamLogos}
              options={(['all', 'ours', 'none'] as const).map((v) => ({ value: v, label: TEAM_LOGOS_TEXT[v] }))}
            />
            <p className="text-xs text-muted">
              Accanto ai nomi nel tabellone, in «Prossima partita», nel calendario e nella classifica.
            </p>
          </div>
        </fieldset>
        {error && <ErrorBox>{error}</ErrorBox>}
        {notice && (
          <p role="status" className="text-sm text-text">
            {notice}
          </p>
        )}
        {canEdit && (
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva profilo'}
          </Button>
        )}
      </form>
    </Card>
  );
}

/**
 * «Club»: the profile of the club (name, logo, series, «nostra squadra», coverage, team logos) and its championships
 * with its team in each (from the championships downloaded from the official site), «Aggiorna calendario». The
 * championships are added by the superadmin in «Campionati». A viewer only reads.
 */
export function ClubPage() {
  const errorMessage = useApiError();
  const { isSuperadmin } = useAuth();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/club', ClubResponseSchema, { signal }), []);
  const club = useAsync(load);
  const [current, setCurrent] = useState<ClubResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [profileVersion, setProfileVersion] = useState(0);

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
  // Saving the championships may fill «nostra squadra»: the profile form then starts again from the saved data.
  const leaguesSaved = (c: ClubResponse): void => {
    if (JSON.stringify(c.ourTeam) !== JSON.stringify(current.ourTeam)) setProfileVersion((v) => v + 1);
    setCurrent(c);
  };
  const our = current.ourTeam;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
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
              {current.profile.series && <p className="text-sm text-muted">{current.profile.series}</p>}
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
          {isSuperadmin && (
            <Link to="/admin/campionati" className={`${buttonClass()} mt-4`}>
              Apri «Campionati»
            </Link>
          )}
        </Card>
        <ProfileForm key={`${version}-${profileVersion}`} club={current} onSaved={setCurrent} />
      </div>
      <ClubForm key={version} club={current} onSaved={leaguesSaved} reload={club.reload} />
    </div>
  );
}
