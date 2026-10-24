import type {
  ClubCompetition,
  ClubCoverage,
  ClubLeagueChoice,
  ClubLeagueOption,
  ClubLeagueStatus,
  ClubLogoSize,
  ClubResponse,
  TeamLogosMode,
  UpdateClubProfileRequest,
} from '@arenalive/shared';
import {
  CLUB_COMPETITIONS_PATH,
  CLUB_LOGO_SIZES,
  CLUB_MAX_LEAGUES,
  ClubCompetitionsResponseSchema,
  ClubLeagueStatusSchema,
  ClubResponseSchema,
  ClubSyncResponseSchema,
  ClubTeamsResponseSchema,
  LEAGUE_GENDERS,
  OUR_TEAM_CODE_MAX,
  OUR_TEAM_NAME_MAX,
  adminAssetPath,
  seasonLabel,
  seriesOfGender,
  UpdateClubProfileRequestSchema,
} from '@arenalive/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass, Card, Empty, ErrorBox, Segmented, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { READ_ONLY_TEXT, useCanEdit } from '../../lib/useCanEdit.ts';
import { useApiError, useAuth } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';
import { LogoPicker } from './LogoPicker.tsx';
import { studioPath } from './studio/model.ts';

export const COVERAGE_TEXT: Record<ClubCoverage, string> = {
  homeAndAway: 'Casa e trasferta',
  homeOnly: 'Solo partite in casa',
};

export const TEAM_LOGOS_TEXT: Record<TeamLogosMode, string> = {
  all: 'Tutti',
  ours: 'Solo il mio',
  none: 'Nessuno',
};

export const CLUB_LOGO_SIZE_TEXT: Record<ClubLogoSize, string> = {
  small: 'Piccolo',
  medium: 'Medio',
  large: 'Grande',
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

/** Text under a championship without the team of the club (null: the team is chosen). */
export function missingTeamText(league: ClubLeagueOption | undefined): string {
  return league && league.sync.lastSuccessAt === null
    ? 'Scaricamento in corso: la squadra del club si sceglie da sola appena è pronto, se la riconosciamo. Senza squadra non arriva nessuna partita.'
    : 'Senza squadra non arriva nessuna partita: scegli la squadra del club.';
}

/**
 * «Aggiungi competizione»: the other competitions of the series of the club on the official site (cups, Supercoppa,
 * play off…), read when opened; the chosen one is added by the server, which downloads it and chooses the team.
 */
function CompetitionAdder({ onAdded, blocked }: { onAdded: (c: ClubResponse) => void; blocked: string | null }) {
  const errorMessage = useApiError();
  const [list, setList] = useState<ClubCompetition[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest(CLUB_COMPETITIONS_PATH, ClubCompetitionsResponseSchema);
      setList(res.competitions);
      setChosen(res.competitions[0] ? String(res.competitions[0].externalId) : '');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const club = await apiRequest(CLUB_COMPETITIONS_PATH, ClubResponseSchema, {
        method: 'POST',
        body: { externalId: Number(chosen) },
      });
      setList(null);
      onAdded(club);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (list === null)
    return (
      <div className="space-y-2">
        <Button disabled={busy || blocked !== null} onClick={() => void open()}>
          {busy ? 'Lettura dal sito…' : 'Aggiungi competizione'}
        </Button>
        {blocked && <p className="text-xs text-muted">{blocked}</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  return (
    <div className="space-y-2 rounded-card border border-border p-3">
      <p className="text-sm font-medium text-text">Competizioni della serie sul sito della Lega</p>
      {list.length === 0 ? (
        <Empty>Nessun’altra competizione della serie in questa stagione.</Empty>
      ) : (
        <select
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className={inputClass}
          aria-label="Competizione da aggiungere"
        >
          {list.map((c) => (
            <option key={c.externalId} value={c.externalId}>
              {`${c.name} ${seasonLabel(c.season)}`}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-muted">
        La squadra del club si sceglie da sola (la stessa della serie): se non la riconosciamo, sceglila tu, perché
        senza squadra non arriva nessuna partita.
      </p>
      <div className="flex flex-wrap gap-2">
        {list.length > 0 && (
          <Button variant="primary" disabled={busy} onClick={() => void add()}>
            {busy ? 'Aggiunta…' : 'Aggiungi'}
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => setList(null)}>
          Annulla
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

function ClubForm({
  club,
  onSaved,
  onReplaced,
  reload,
}: {
  club: ClubResponse;
  onSaved: (c: ClubResponse) => void;
  /** The championships changed on the server (a competition added): the list starts again from them. */
  onReplaced: (c: ClubResponse) => void;
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
  const withoutTeam = choices.filter((c) => c.teamId === null).length;

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
                    {choice.teamId === null && <p className="text-xs text-warn">{missingTeamText(league)}</p>}
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
        {canEdit && dirty && withoutTeam > 0 && (
          <p role="alert" className="text-sm text-warn">
            {withoutTeam === 1
              ? 'Un campionato è senza squadra: senza squadra non arriva nessuna partita.'
              : `${withoutTeam} campionati sono senza squadra: senza squadra non arriva nessuna partita.`}
          </p>
        )}
        {canEdit && club.profile.seriesId && (
          <CompetitionAdder
            blocked={
              dirty
                ? 'Salva prima le modifiche ai campionati.'
                : choices.length >= CLUB_MAX_LEAGUES
                  ? `Al massimo ${CLUB_MAX_LEAGUES} campionati: togline uno.`
                  : null
            }
            onAdded={onReplaced}
          />
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
 * Profile of the club: name shown, square logo, gender and series (from the catalog), «nostra squadra» of the `.dvw` files, coverage of the matches
 * («casa e trasferta» or «solo partite in casa») and «Loghi delle squadre» (tutti / solo il mio / nessuno). Saved
 * together (`PUT /api/admin/club/profile`); read-only for a viewer.
 */
/** Milliseconds between two looks at the download of the championship of the series. */
export const SERIES_POLL_MS = 3000;

/**
 * Gender and series of the club, from the catalog: choosing the series links the championship of the season (the
 * server downloads it in the background) and the team can then be chosen below, in «Campionati».
 */
function SeriesFields({
  club,
  disabled,
  onChosen,
}: {
  club: ClubResponse;
  disabled: boolean;
  /** The club after the choice (and after the download ends): its championships changed. */
  onChosen: (c: ClubResponse) => void;
}) {
  const errorMessage = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ClubLeagueStatus | null>(null);
  const chosen = useRef(onChosen);
  chosen.current = onChosen;
  const downloading = status?.state === 'downloading';

  // While the championship downloads the state is looked at again; at the end the club is read again.
  useEffect(() => {
    if (!downloading) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      apiRequest('/api/admin/club/league', ClubLeagueStatusSchema, { signal: controller.signal })
        .then(async (s) => {
          setStatus(s);
          if (s.state !== 'downloading')
            chosen.current(await apiRequest('/api/admin/club', ClubResponseSchema, { signal: controller.signal }));
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(err));
        });
    }, SERIES_POLL_MS);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [downloading, status, errorMessage]);

  const choose = async (series: string): Promise<void> => {
    if (series === '') return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiRequest('/api/admin/club/league', ClubLeagueStatusSchema, {
        method: 'POST',
        body: { gender: 'M', series },
      });
      setStatus(next);
      onChosen(await apiRequest('/api/admin/club', ClubResponseSchema));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const legacy = club.profile.seriesId === null ? club.profile.series : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Genere" hint="Il femminile arriva presto.">
        <select
          value={club.profile.gender ?? 'M'}
          disabled={disabled}
          className={inputClass}
          onChange={() => undefined}
        >
          {LEAGUE_GENDERS.map((g) => (
            <option key={g.id} value={g.id} disabled={!g.available}>
              {g.label}
              {g.available ? '' : ' (presto disponibile)'}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Serie"
        {...(legacy
          ? { hint: `Ora: «${legacy}» (testo libero). Scegli la serie dall’elenco per avere il calendario.` }
          : {})}
      >
        <select
          value={club.profile.seriesId ?? ''}
          disabled={disabled || busy}
          className={inputClass}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="" disabled>
            Scegli la serie
          </option>
          {seriesOfGender('M').map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        {club.profile.newSeason && club.profile.seriesId && (
          <div
            role="status"
            className="mb-2 space-y-2 rounded-card border border-border bg-surface-2 p-3 text-sm text-text"
          >
            <p>Nuova stagione: scegli di nuovo la squadra.</p>
            <Button disabled={disabled || busy} onClick={() => void choose(club.profile.seriesId ?? '')}>
              Scegli la squadra della nuova stagione
            </Button>
          </div>
        )}
        {(busy || downloading) && <Spinner label="Sto scaricando il calendario…" />}
        {status?.state === 'error' && <ErrorBox>{status.message ?? 'Il calendario non è stato scaricato.'}</ErrorBox>}
        {status?.state === 'ready' && (
          <p role="status" className="text-xs text-muted">
            Calendario pronto: scegli la squadra del club in «Campionati».
          </p>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </div>
  );
}

function ProfileForm({
  club,
  onSaved,
  onSeriesChosen,
}: {
  club: ClubResponse;
  onSaved: (c: ClubResponse) => void;
  onSeriesChosen: (c: ClubResponse) => void;
}) {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
  const [displayName, setDisplayName] = useState(club.displayName ?? '');
  const [logoMark, setLogoMark] = useState<string | null>(club.logoMark);
  const [ourLogoSize, setOurLogoSize] = useState<ClubLogoSize>(club.ourLogoSize);
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
      ourLogoSize,
      ourTeam: { code: code.trim() || null, name: teamName.trim() || null },
      profile: { coverage, teamLogos },
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
            url={logoMark ? adminAssetPath(logoMark) : null}
            custom={logoMark !== null}
            defaultLabel="Togli"
            disabled={!canEdit}
            onChange={(id) => {
              setLogoMark(id);
              return Promise.resolve();
            }}
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-text">Dimensione del logo del club</p>
            <Segmented
              label="Dimensione del logo del club"
              value={ourLogoSize}
              onChange={setOurLogoSize}
              options={CLUB_LOGO_SIZES.map((v) => ({ value: v, label: CLUB_LOGO_SIZE_TEXT[v] }))}
            />
            <p className="text-xs text-muted">
              Il logo del club compare sempre per la nostra squadra, al posto di quello della Lega: nel tabellone, in
              «Prossima partita» e nell’intestazione ha la dimensione scelta qui.
            </p>
          </div>
          <Field label="Nome" hint={`Vuoto: «${club.name}». Compare nelle pagine pubbliche e nell’app installata.`}>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              className={inputClass}
            />
          </Field>
          <SeriesFields club={club} disabled={!canEdit} onChosen={onSeriesChosen} />
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
  const canEdit = useCanEdit();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/club', ClubResponseSchema, { signal }), []);
  const club = useAsync(load);
  const [current, setCurrent] = useState<ClubResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [profileVersion, setProfileVersion] = useState(0);
  const [leaguesVersion, setLeaguesVersion] = useState(0);

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
          <div className="mt-4 flex flex-wrap gap-2">
            {/* Colours, horizontal logo and the rest of the graphics are in the Studio (admins only). */}
            {canEdit && (
              <Link to={studioPath('colori')} className={buttonClass()}>
                Apri «Colori e loghi»
              </Link>
            )}
            {isSuperadmin && (
              <Link to="/admin/campionati" className={buttonClass()}>
                Apri «Campionati»
              </Link>
            )}
          </div>
        </Card>
        <ProfileForm
          key={`${version}-${profileVersion}`}
          club={current}
          onSaved={setCurrent}
          onSeriesChosen={(c) => {
            // The championship of the series is linked: the list of «Campionati» starts again from it.
            setCurrent(c);
            setLeaguesVersion((v) => v + 1);
          }}
        />
      </div>
      <ClubForm
        key={`${version}-${leaguesVersion}`}
        club={current}
        onSaved={leaguesSaved}
        onReplaced={(c) => {
          leaguesSaved(c);
          setLeaguesVersion((v) => v + 1);
        }}
        reload={club.reload}
      />
    </div>
  );
}
