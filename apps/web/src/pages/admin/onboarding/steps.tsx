import type {
  ClubLeagueStatus,
  ClubResponse,
  ClubTeam,
  TenantBranding,
  TenantIntermissions,
  TenantOverlays,
} from '@sir/shared';
import {
  brandContrastIssues,
  CalendarResponseSchema,
  ClubLeagueStatusSchema,
  ClubResponseSchema,
  CreateShareTokenResponseSchema,
  IntermissionsResponseSchema,
  LEAGUE_GENDERS,
  OverlaysResponseSchema,
  publicAssetPath,
  seriesOfGender,
  ShareTokenSummarySchema,
  suggestedOurTeamName,
  templateOf,
} from '@sir/shared';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button, buttonClass, ErrorBox, Spinner } from '../../../components/ui.tsx';
import { apiRequest } from '../../../lib/api.ts';
import { formatFixtureDate } from '../../../lib/format.ts';
import { useAsync } from '../../../lib/useAsync.ts';
import { ShareQr } from '../../../qr/ShareQr.tsx';
import { AGENT_DOWNLOAD_PATH } from '../AgentsPage.tsx';
import { useApiError } from '../auth.tsx';
import { Field, inputClass } from '../forms.tsx';
import { LogoPicker } from '../LogoPicker.tsx';
import { ColorField, contrastText, TemplatePicker, withColor } from '../studio/ColorsSection.tsx';
import {
  activePauseModel,
  applyOverlayModel,
  applyPauseModel,
  PAUSE_MODEL_LABELS,
  sameValue,
  studioPath,
} from '../studio/model.ts';
import { ModelPicker } from '../studio/StudioUi.tsx';
import { saveBranding, saveProfile } from './api.ts';

/** Documents of the client the procedure works on; the steps change them and the shell keeps them. */
export interface WizardData {
  tenantName: string;
  club: ClubResponse;
  branding: TenantBranding;
  intermissions: TenantIntermissions;
  overlays: TenantOverlays;
}

export interface StepProps {
  data: WizardData;
  /** The club saved (the branding follows: name, square logo and «nostra squadra» are in both). */
  onClub: (club: ClubResponse) => void;
  onBranding: (branding: TenantBranding) => void;
  onIntermissions: (intermissions: TenantIntermissions) => void;
  onOverlays: (overlays: TenantOverlays) => void;
  /** The step puts here what «Avanti» runs: it saves and answers whether the next step can open. */
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
  /** A link of the step leaves the procedure (it closes: «Riprendi» stays in the notice). */
  onLeave: () => void;
}

/** Runs a save, showing its error under the step; answers whether it worked. */
function useSaving(): { busy: boolean; error: string | null; run: (task: () => Promise<void>) => Promise<boolean> } {
  const errorMessage = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (task: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await task();
        return true;
      } catch (err) {
        setError(
          err instanceof TypeError
            ? 'Controlla i campi: testi su una riga, senza caratteri speciali.'
            : errorMessage(err),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [errorMessage],
  );
  return { busy, error, run };
}

// ----------------------------------------------------------------------------------------------- 1. Logo

export function LogoStep({ data, onClub, onBranding, saveRef }: StepProps) {
  const { club, branding } = data;
  useEffect(() => {
    saveRef.current = () => Promise.resolve(true);
  });
  return (
    <div className="space-y-5">
      <LogoPicker
        label="Logo quadrato della società"
        url={club.logoMark ? publicAssetPath(club.logoMark) : null}
        custom={club.logoMark !== null}
        defaultLabel="Togli"
        onChange={async (id) => onClub(await saveProfile(club, { logoMark: id }))}
      />
      <LogoPicker
        label="Logo orizzontale (facoltativo)"
        url={branding.logoMain ? publicAssetPath(branding.logoMain) : null}
        custom={branding.logoMain !== null}
        defaultLabel="Togli"
        onChange={async (id) => onBranding(await saveBranding({ ...branding, logoMain: id }))}
      />
      <p className="text-xs text-muted">
        Il logo quadrato serve per l’icona dell’app e gli spazi piccoli; quello orizzontale per la testata. Il logo si
        salva appena lo carichi.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- 2. Squadra

/** Milliseconds between two looks at the download of the championship (an object: the tests make it short). */
export const DOWNLOAD_POLL = { ms: 2000 };

function TeamChoice({
  teams,
  value,
  onChange,
  disabled,
}: {
  teams: (ClubTeam & { leagueId: string })[];
  value: string | null;
  onChange: (team: ClubTeam & { leagueId: string }) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Squadra del club"
      className="sir-thin-scroll grid max-h-64 gap-1 overflow-y-auto"
    >
      {teams.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={t.id === value}
          disabled={disabled}
          onClick={() => onChange(t)}
          className={`flex min-h-11 items-center gap-3 rounded-card border px-3 py-1.5 text-left text-sm text-text ${
            t.id === value
              ? 'border-primary bg-surface-2 ring-1 ring-primary'
              : 'border-border bg-surface hover:bg-hover'
          }`}
        >
          {t.logoUrl ? (
            <img src={t.logoUrl} alt="" className="size-8 shrink-0 object-contain" />
          ) : (
            <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-surface-2" />
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium">{t.name}</span>
            {t.city && <span className="block truncate text-xs text-muted">{t.city}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function TeamStep({ data, onClub, saveRef }: StepProps) {
  const { club } = data;
  const errorMessage = useApiError();
  const saving = useSaving();
  const [status, setStatus] = useState<ClubLeagueStatus | null>(null);
  const [loading, setLoading] = useState(club.profile.leagueId !== null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [name, setName] = useState(club.displayName ?? '');
  const [series, setSeries] = useState<string>(club.profile.seriesId ?? '');

  // The state of a series chosen before (the procedure was closed and resumed).
  useEffect(() => {
    if (club.profile.leagueId === null) return;
    const controller = new AbortController();
    apiRequest('/api/admin/club/league', ClubLeagueStatusSchema, { signal: controller.signal }).then(
      (s) => {
        setStatus(s);
        setLoading(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => controller.abort();
    // Only at the opening of the step.
  }, []);

  // While the championship downloads, the state is looked at again.
  const downloading = status?.state === 'downloading';
  useEffect(() => {
    if (!downloading) return;
    const controller = new AbortController();
    const id = setTimeout(() => {
      apiRequest('/api/admin/club/league', ClubLeagueStatusSchema, { signal: controller.signal }).then(
        (s) => setStatus(s),
        (err: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(err));
        },
      );
    }, DOWNLOAD_POLL.ms);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [downloading, status, errorMessage]);

  const chooseSeries = async (id: string): Promise<void> => {
    setSeries(id);
    setError(null);
    if (id === '') return;
    setChoosing(true);
    try {
      const next = await apiRequest('/api/admin/club/league', ClubLeagueStatusSchema, {
        method: 'POST',
        body: { gender: 'M', series: id },
      });
      setStatus(next);
      onClub(await apiRequest('/api/admin/club', ClubResponseSchema));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChoosing(false);
    }
  };

  const chooseTeam = async (team: ClubTeam & { leagueId: string }): Promise<void> => {
    if (!status) return;
    const leagueId = team.leagueId;
    // Only the championship (group) that holds the team stays linked: the other groups of the series go away.
    const ofSeries = new Set([...club.profile.leagueIds, ...(club.profile.leagueId ? [club.profile.leagueId] : [])]);
    await saving.run(async () => {
      const others = club.leagues
        .filter((l) => !ofSeries.has(l.league.id))
        .map((l) => ({ leagueId: l.league.id, teamId: l.team?.id ?? null }));
      const res = await apiRequest('/api/admin/club', ClubResponseSchema, {
        method: 'PUT',
        body: { leagues: [...others, { leagueId, teamId: team.id }] },
      });
      onClub(res);
      setStatus({ ...status, teamId: team.id });
      setManual(false);
      setName(team.name);
    });
  };

  // «Avanti»: the name of the club (and «nostra squadra» when still empty).
  useEffect(() => {
    saveRef.current = () => {
      const text = name.trim();
      const typed = text === '' ? null : text;
      if (typed === club.displayName) return Promise.resolve(true);
      const empty = club.ourTeam.name === null && club.ourTeam.code === null;
      const ourTeam =
        empty && typed !== null
          ? { code: null, name: suggestedOurTeamName({ name: typed, city: null }) }
          : club.ourTeam;
      return saving.run(async () => onClub(await saveProfile(club, { displayName: typed, ourTeam })));
    };
  });

  const catalog = seriesOfGender('M');
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">Maschile o femminile</p>
        <div role="radiogroup" aria-label="Maschile o femminile" className="flex flex-wrap gap-2">
          {LEAGUE_GENDERS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={g.available}
              disabled={!g.available}
              className={`min-h-9 rounded-button border px-3 text-sm font-medium pointer-coarse:min-h-11 ${
                g.available ? 'border-primary bg-surface-2 text-text' : 'border-border text-muted opacity-60'
              }`}
            >
              {g.label}
              {!g.available && <span className="block text-xs font-normal">Presto disponibile</span>}
            </button>
          ))}
        </div>
      </div>
      <Field label="In che serie gioca" hint="Il calendario della serie viene scaricato dal sito della Lega.">
        <select
          value={series}
          disabled={choosing}
          onChange={(e) => void chooseSeries(e.target.value)}
          className={inputClass}
        >
          <option value="">Scegli la serie</option>
          {catalog.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {(choosing || loading) && <Spinner label="Sto scaricando il calendario…" />}
      {!choosing && status?.state === 'downloading' && <Spinner label="Sto scaricando il calendario…" />}
      {status?.state === 'error' && (
        <ErrorBox {...(series ? { onRetry: () => void chooseSeries(series) } : {})}>
          {status.message ?? 'Il calendario non è stato scaricato.'}
        </ErrorBox>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {status?.state === 'ready' && !manual && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-text">
            La tua squadra{status.leagueName ? ` in «${status.leagueName}»` : ''}
          </p>
          {status.teams.length === 0 ? (
            <p className="text-sm text-muted">Il campionato non ha squadre: scrivi il nome a mano.</p>
          ) : (
            <TeamChoice
              teams={status.teams}
              value={status.teamId}
              onChange={(t) => void chooseTeam(t)}
              disabled={saving.busy}
            />
          )}
        </div>
      )}
      {status?.state === 'ready' && (
        <Button variant="ghost" onClick={() => setManual((m) => !m)}>
          {manual ? 'Torna all’elenco delle squadre' : 'La mia squadra non è nell’elenco'}
        </Button>
      )}
      {manual && (
        <p className="text-sm text-muted">
          Scrivi il nome della squadra: le partite si aggiungono a mano dal «Calendario».
        </p>
      )}
      <Field label="Nome della squadra o del club" hint="Compare nelle pagine pubbliche. Vuoto: il nome del cliente.">
        <input
          value={name}
          maxLength={100}
          placeholder={data.tenantName}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      {saving.error && <ErrorBox>{saving.error}</ErrorBox>}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- 3. Colori

export function ColorsStep({ data, onBranding, saveRef }: StepProps) {
  const { branding } = data;
  const saving = useSaving();
  const [saved, setSaved] = useState(branding);
  const template = templateOf(branding.template);
  const issues = brandContrastIssues(branding.colors, branding.template);
  useEffect(() => {
    saveRef.current = () => {
      if (sameValue(saved, branding)) return Promise.resolve(true);
      return saving.run(async () => {
        const next = await saveBranding(branding);
        setSaved(next);
        onBranding(next);
      });
    };
  });
  const color = (key: 'primary' | 'accent') => (
    <ColorField
      name={key}
      value={branding.colors[key]}
      fallback={template.colors[key]}
      onChange={(v) => onBranding(withColor(branding, key, v))}
    />
  );
  return (
    <div className="space-y-4">
      <TemplatePicker value={branding.template} onChange={(t) => onBranding({ ...branding, template: t })} />
      <p className="text-xs text-muted">Colore principale e accento sono facoltativi: vuoti, vale il modello.</p>
      {color('primary')}
      {color('accent')}
      {issues.length > 0 && (
        <ul className="space-y-1 text-xs text-danger" aria-label="Avvisi sul contrasto">
          {issues.map((i) => (
            <li key={i.color}>{contrastText(i)}</li>
          ))}
        </ul>
      )}
      {saving.error && <ErrorBox>{saving.error}</ErrorBox>}
    </div>
  );
}

// -------------------------------------------------------------------------------------------- 4. Grafica

export function GraphicsStep({ data, onIntermissions, onOverlays, saveRef }: StepProps) {
  const { intermissions, overlays } = data;
  const saving = useSaving();
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    saveRef.current = () => {
      if (!touched) return Promise.resolve(true);
      return saving.run(async () => {
        const p = await apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, {
          method: 'PUT',
          body: intermissions,
        });
        const o = await apiRequest('/api/admin/overlays', OverlaysResponseSchema, { method: 'PUT', body: overlays });
        onIntermissions(p.intermissions);
        onOverlays(o.overlays);
        setTouched(false);
      });
    };
  });
  return (
    <div className="space-y-3">
      <ModelPicker
        labels={PAUSE_MODEL_LABELS}
        active={activePauseModel(intermissions)}
        onApply={(m) => {
          onIntermissions(applyPauseModel(intermissions, m));
          onOverlays(applyOverlayModel(overlays, m));
          setTouched(true);
        }}
      />
      <p className="text-xs text-muted">
        Il modello sceglie le pause (fine set, time-out, fine partita) e gli avvisi (ace, muro, set point). Nello Studio
        grafico potrai cambiare ogni dettaglio, anche la pagina live.
      </p>
      {saving.error && <ErrorBox>{saving.error}</ErrorBox>}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- 5. Fatto

const ShareListSchema = z.array(ShareTokenSummarySchema);

/** Label of the link that shows all the matches of the calendar. */
export const CHANNEL_LABEL = 'Canale del club';

/** The channel link of the club (all the matches of the calendar): the existing one, otherwise a new one. */
function useChannel() {
  const load = useCallback(async (signal: AbortSignal) => {
    const list = await apiRequest('/api/admin/share-tokens', ShareListSchema, { signal });
    const found = list.find((s) => !s.revoked && s.matchId === null && s.clientFixtureId === null && s.shortUrl);
    if (found?.shortUrl) return { url: found.shortUrl, code: found.shortCode ?? undefined };
    const created = await apiRequest('/api/admin/share-tokens', CreateShareTokenResponseSchema, {
      method: 'POST',
      body: { label: CHANNEL_LABEL, matchId: null, expiresAt: null },
      signal,
    });
    return { url: created.shortUrl ?? created.url, code: created.shortCode ?? undefined };
  }, []);
  return useAsync(load);
}

export function DoneStep({ data, saveRef, onLeave }: StepProps) {
  const { club, branding, intermissions } = data;
  const errorMessage = useApiError();
  const channel = useChannel();
  const loadNext = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/calendar', CalendarResponseSchema, { signal }),
    [],
  );
  const calendar = useAsync(loadNext);
  useEffect(() => {
    saveRef.current = () => Promise.resolve(true);
  });
  const now = Date.now();
  const next = (calendar.data?.fixtures ?? []).find(
    (f) => f.state === 'scheduled' && f.startsAt !== null && new Date(f.startsAt).getTime() >= now,
  );
  const link = club.leagues[0]?.league;
  const rows: [string, string][] = [
    ['Società', club.displayName ?? club.name],
    ['Serie', club.profile.series ?? 'non indicata'],
    ['Campionato', link ? `${link.name ?? `Campionato ${link.externalId}`}` : 'nessuno'],
    ['Squadra', club.leagues[0]?.team?.name ?? club.ourTeam.name ?? 'da impostare'],
    ['Modello grafico', templateOf(branding.template).label],
    ['Pause', PAUSE_MODEL_LABELS[activePauseModel(intermissions) ?? 'completo'].label],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="truncate text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <p className="text-sm font-medium text-text">Link del canale del club</p>
        {channel.loading && !channel.data && <Spinner label="Preparo il link…" />}
        {channel.error !== null && <ErrorBox onRetry={channel.reload}>{errorMessage(channel.error)}</ErrorBox>}
        {channel.data && (
          <div className="space-y-2">
            <p className="break-all font-mono text-xs text-text">{channel.data.url}</p>
            <ShareQr
              url={channel.data.url}
              {...(channel.data.code ? { code: channel.data.code } : {})}
              logoSrc={club.logoUrl}
            />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">Prossima partita</p>
        {calendar.loading && !calendar.data ? (
          <Spinner label="Leggo il calendario…" />
        ) : next ? (
          <p className="text-sm text-text">
            {next.home.name} – {next.away.name}, {formatFixtureDate(next.startsAt).date}{' '}
            {formatFixtureDate(next.startsAt).time}
          </p>
        ) : (
          <p className="text-sm text-muted">
            Nessuna partita in calendario: se la squadra non è nell’elenco, aggiungile a mano dal «Calendario».
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={AGENT_DOWNLOAD_PATH} download className={buttonClass('primary')}>
          Scarica l’agente
        </a>
        <Link to={studioPath('colori')} className={buttonClass()} onClick={onLeave}>
          Apri lo Studio grafico
        </Link>
      </div>
    </div>
  );
}
