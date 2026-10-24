import type {
  AssetSummary,
  CreatePlayerRequest,
  ImportRosterResponse,
  Player,
  PlayerEditableField,
  PlayerRole,
  RosterResponse,
  UpdatePlayerRequest,
} from '@arenalive/shared';
import {
  AssetListResponseSchema,
  CreatePlayerRequestSchema,
  ImportRosterResponseSchema,
  isVideoMime,
  PLAYER_MEDIA_MAX,
  PLAYER_ROLE_LABELS,
  PLAYER_ROLES,
  PLAYER_VIDEOS_MAX,
  PlayerMediaRequestSchema,
  PlayerSchema,
  RosterResponseSchema,
  seasonLabel,
  UpdatePlayerRequestSchema,
} from '@arenalive/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { READ_ONLY_TEXT, useCanEdit } from '../../lib/useCanEdit.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { assetLabel } from './imageUpload.ts';
import { LibraryLink } from './studio/ColorsSection.tsx';

/** Milliseconds between two updates of the page while the photos of an import are downloaded. */
export const ROSTER_POLL_MS = 2000;

/** Pure: the full name of a player, «Rossi Mario» (surname first, as in the lists of the volleyball). */
export const playerFullName = (p: Pick<Player, 'lastName' | 'firstName'>): string =>
  `${p.lastName} ${p.firstName}`.trim();

/** Pure: the result of an import as a sentence, «Aggiunti 3, aggiornati 1, invariati 8.». */
export const importSummary = (r: Pick<ImportRosterResponse, 'added' | 'updated' | 'unchanged'>): string =>
  `Aggiunti ${r.added}, aggiornati ${r.updated}, invariati ${r.unchanged}.`;

/** Pure: progress of the photos of an import, «Foto scaricate: 3 di 12», null when nothing is being downloaded. */
export function photoProgressText(state: RosterResponse['import']): string | null {
  if (!state.running) return null;
  return `Foto scaricate: ${state.photosDone} di ${state.photosTotal}`;
}

/** Marks a field of a player changed by hand (a new import does not overwrite it). */
function Edited({ player, field }: { player: Player; field: PlayerEditableField }) {
  if (!player.editedFields.includes(field)) return null;
  return (
    <>
      <span aria-hidden="true" title="Modificato a mano" className="ml-1 text-xs text-warn">
        ✎
      </span>
      <span className="sr-only"> (modificato a mano)</span>
    </>
  );
}

const cell = 'px-2 py-2 align-middle text-sm text-text';

/** Values of the form of a player, as the texts of the fields. */
interface PlayerDraft {
  number: string;
  lastName: string;
  firstName: string;
  role: string;
  birthYear: string;
  heightCm: string;
  birthplace: string;
  nationality: string;
}

const EMPTY_DRAFT: PlayerDraft = {
  number: '',
  lastName: '',
  firstName: '',
  role: '',
  birthYear: '',
  heightCm: '',
  birthplace: '',
  nationality: '',
};

const draftOf = (p: Player): PlayerDraft => ({
  number: String(p.number),
  lastName: p.lastName,
  firstName: p.firstName,
  role: p.role ?? '',
  birthYear: p.birthYear === null ? '' : String(p.birthYear),
  heightCm: p.heightCm === null ? '' : String(p.heightCm),
  birthplace: p.birthplace ?? '',
  nationality: p.nationality ?? '',
});

const isRole = (v: string): v is PlayerRole => (PLAYER_ROLES as readonly string[]).includes(v);

/** A number from a field: empty is null, not a number is NaN (the schema then refuses it). */
const numberOrNull = (text: string): number | null => (text.trim() === '' ? null : Number(text));
const textOrNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** Pure: the fields of the form as a request body (before the schema checks it). */
export function requestOf(d: PlayerDraft): Record<keyof PlayerDraft, unknown> {
  return {
    number: d.number.trim() === '' ? Number.NaN : Number(d.number),
    lastName: d.lastName,
    firstName: d.firstName,
    role: isRole(d.role) ? d.role : null,
    birthYear: numberOrNull(d.birthYear),
    heightCm: numberOrNull(d.heightCm),
    birthplace: textOrNull(d.birthplace),
    nationality: textOrNull(d.nationality),
  };
}

export const INVALID_PLAYER_TEXT =
  'Dati non validi: servono numero (da 0 a 99), cognome e nome; anno di nascita, altezza (da 120 a 250 cm) e nazionalità (come ITA) se indicati.';

/**
 * Form of a player: new one («Aggiungi giocatore») or the data of an existing one («Modifica»). Checked with the shared
 * schemas before sending; of an existing player only the changed fields are sent (they become «modificato a mano»).
 */
function PlayerForm({
  player,
  onSaved,
  onCancel,
}: {
  player: Player | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const errorMessage = useApiError();
  const [draft, setDraft] = useState<PlayerDraft>(player ? draftOf(player) : EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof PlayerDraft, value: string): void => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const body = requestOf(draft);
    let request: CreatePlayerRequest | UpdatePlayerRequest;
    if (player === null) {
      const parsed = CreatePlayerRequestSchema.safeParse(body);
      if (!parsed.success) return setError(INVALID_PLAYER_TEXT);
      request = parsed.data;
    } else {
      const before = requestOf(draftOf(player));
      const changed = Object.fromEntries(
        (Object.keys(body) as (keyof PlayerDraft)[]).filter((k) => body[k] !== before[k]).map((k) => [k, body[k]]),
      );
      if (Object.keys(changed).length === 0) return setError('Nessuna modifica da salvare.');
      const parsed = UpdatePlayerRequestSchema.safeParse(changed);
      if (!parsed.success) return setError(INVALID_PLAYER_TEXT);
      request = parsed.data;
    }
    setBusy(true);
    try {
      await apiRequest(
        player ? `/api/admin/roster/players/${encodeURIComponent(player.id)}` : '/api/admin/roster/players',
        PlayerSchema,
        {
          method: player ? 'PATCH' : 'POST',
          body: request,
        },
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={player ? `Modifica ${playerFullName(player)}` : 'Aggiungi giocatore'}>
      <form className="space-y-3" onSubmit={(e) => void submit(e)}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Numero">
            <input
              className={inputClass}
              inputMode="numeric"
              value={draft.number}
              onChange={(e) => set('number', e.target.value)}
            />
          </Field>
          <Field label="Cognome">
            <input className={inputClass} value={draft.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
          <Field label="Nome">
            <input className={inputClass} value={draft.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Ruolo">
            <select className={inputClass} value={draft.role} onChange={(e) => set('role', e.target.value)}>
              <option value="">Non indicato</option>
              {PLAYER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PLAYER_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Anno di nascita">
            <input
              className={inputClass}
              inputMode="numeric"
              value={draft.birthYear}
              onChange={(e) => set('birthYear', e.target.value)}
            />
          </Field>
          <Field label="Altezza (cm)">
            <input
              className={inputClass}
              inputMode="numeric"
              value={draft.heightCm}
              onChange={(e) => set('heightCm', e.target.value)}
            />
          </Field>
          <Field label="Luogo di nascita">
            <input
              className={inputClass}
              value={draft.birthplace}
              onChange={(e) => set('birthplace', e.target.value)}
            />
          </Field>
          <Field label="Nazionalità" hint="Tre lettere, come ITA.">
            <input
              className={inputClass}
              maxLength={3}
              value={draft.nationality}
              onChange={(e) => set('nationality', e.target.value)}
            />
          </Field>
        </div>
        {player && (
          <p className="text-xs text-muted">
            I campi che cambi restano come li scrivi: una nuova importazione dal sito della Lega non li sovrascrive.
          </p>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Salvataggio…' : player ? 'Salva giocatore' : 'Aggiungi'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Annulla
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Thumbnail of a file of the library (a still of the video for a video). */
function Thumb({ asset }: { asset: Pick<AssetSummary, 'url' | 'mime'> }) {
  return isVideoMime(asset.mime) ? (
    <video src={asset.url} muted playsInline preload="metadata" className="size-10 rounded object-cover" />
  ) : (
    <img src={asset.url} alt="" className="size-10 rounded object-cover" />
  );
}

/** Pure: the files of the library for the players (kind `player`), images first by their list order. */
export const playerFiles = (assets: readonly AssetSummary[]): AssetSummary[] =>
  assets.filter((a) => a.kind === 'player');

/**
 * «Foto e video» of a player: the main photo (an image) and the other photos and videos, chosen only among the files of
 * the library for the players (they are uploaded in «Immagini e video»). At most PLAYER_MEDIA_MAX files, of them
 * PLAYER_VIDEOS_MAX videos; the order is the one of the choice.
 */
function MediaEditor({
  player,
  assets,
  onSaved,
  onCancel,
}: {
  player: Player;
  assets: readonly AssetSummary[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const errorMessage = useApiError();
  const files = playerFiles(assets);
  const images = files.filter((a) => !isVideoMime(a.mime));
  const [photo, setPhoto] = useState(player.photo?.assetId ?? '');
  const [chosen, setChosen] = useState<string[]>(player.media.map((m) => m.assetId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(files.map((a) => [a.id, a]));
  const videosChosen = chosen.filter((id) => isVideoMime(byId.get(id)?.mime ?? '')).length;

  const toggle = (id: string, on: boolean): void =>
    setChosen((c) => (on ? [...c.filter((x) => x !== id), id] : c.filter((x) => x !== id)));

  const save = async (): Promise<void> => {
    setError(null);
    const parsed = PlayerMediaRequestSchema.safeParse({
      photoAssetId: photo === '' ? null : photo,
      mediaIds: chosen.filter((id) => id !== photo),
    });
    if (!parsed.success) return setError('Scelta non valida: ogni file una sola volta.');
    setBusy(true);
    try {
      await apiRequest(`/api/admin/roster/players/${encodeURIComponent(player.id)}/media`, PlayerSchema, {
        method: 'PUT',
        body: parsed.data,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`Foto e video di ${playerFullName(player)}`}
      subtitle="Si scelgono tra i file della libreria caricati per i giocatori."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <LibraryLink />
          <span className="text-xs text-muted">
            In «Immagini e video» scegli l’uso «Foto e video dei giocatori» per caricare foto e video.
          </span>
        </div>
        {files.length === 0 ? (
          <Empty>Nessun file per i giocatori nella libreria.</Empty>
        ) : (
          <>
            <Field label="Foto principale" hint="È la foto mostrata nell’elenco e negli avvisi.">
              <select className={inputClass} value={photo} onChange={(e) => setPhoto(e.target.value)}>
                <option value="">Nessuna</option>
                {images.map((a) => (
                  <option key={a.id} value={a.id}>
                    {assetLabel(a)}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-text">Altre foto e video</legend>
              <p className="text-xs text-muted">
                Al massimo {PLAYER_MEDIA_MAX} file, di cui {PLAYER_VIDEOS_MAX} video. Scelti: {chosen.length}, video:{' '}
                {videosChosen}.
              </p>
              <ul className="divide-y divide-grid">
                {files
                  .filter((a) => a.id !== photo)
                  .map((a) => {
                    const on = chosen.includes(a.id);
                    const video = isVideoMime(a.mime);
                    const full =
                      !on && (chosen.length >= PLAYER_MEDIA_MAX || (video && videosChosen >= PLAYER_VIDEOS_MAX));
                    return (
                      <li key={a.id} className="flex items-center gap-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={full}
                          aria-label={`${video ? 'Video' : 'Foto'}: ${assetLabel(a)}`}
                          onChange={(e) => toggle(a.id, e.target.checked)}
                        />
                        <Thumb asset={a} />
                        <span className="min-w-0 flex-1 truncate text-sm text-text">{assetLabel(a)}</span>
                        <span className="text-xs text-muted">{video ? 'Video' : 'Foto'}</span>
                      </li>
                    );
                  })}
              </ul>
            </fieldset>
          </>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva foto e video'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Annulla
          </Button>
        </div>
      </div>
    </Card>
  );
}

type Panel = { kind: 'new' } | { kind: 'edit' | 'media'; id: string };

/** Result of the last import: the counts, the players of the site not added (and why), the ones no longer on the site. */
function ImportResult({ result }: { result: ImportRosterResponse }) {
  return (
    <div className="space-y-1 rounded-card border border-border bg-surface-2 p-3 text-sm text-text" role="status">
      <p className="font-medium">{importSummary(result)}</p>
      {result.photosQueued > 0 && <p className="text-xs text-muted">Foto da scaricare: {result.photosQueued}.</p>}
      {result.skipped.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Saltati</p>
          <ul className="list-disc pl-5 text-xs">
            {result.skipped.map((s) => (
              <li key={`${s.number}-${s.name}`}>
                {s.number} {s.name}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.notOnSite.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Non più sul sito (restano nella rosa: decidi tu)</p>
          <ul className="list-disc pl-5 text-xs">
            {result.notOnSite.map((p) => (
              <li key={p.id}>
                {p.number} {p.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Page «Squadra» (`/admin/squadra`): the roster of the team of the club in a season. «Importa dal sito della Lega» reads
 * the page of the team (photos come in the background, shown as they arrive); players can be added, changed (what is
 * changed by hand is never overwritten by a new import), taken out and put back, and given a main photo and other
 * photos and videos chosen from the library. A viewer reads only.
 */
export function RosterPage() {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
  const [season, setSeason] = useState<number | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [result, setResult] = useState<ImportRosterResponse | null>(null);
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRoster = useCallback(
    (signal: AbortSignal) =>
      apiRequest(season === null ? '/api/admin/roster' : `/api/admin/roster?season=${season}`, RosterResponseSchema, {
        signal,
      }),
    [season],
  );
  const roster = useAsync(loadRoster);
  const loadAssets = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const assets = useAsync(loadAssets);

  useEffect(() => {
    document.title = 'Squadra · Area riservata';
  }, []);

  // While the photos of an import are downloaded the page asks again, to show them as they arrive.
  const running = roster.data?.import.running ?? false;
  const reloadRoster = roster.reload;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(reloadRoster, ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [running, reloadRoster]);

  if (roster.error !== null && !roster.data)
    return <ErrorBox onRetry={roster.reload}>{errorMessage(roster.error)}</ErrorBox>;
  if (!roster.data) return <Spinner label="Caricamento della squadra…" />;
  const data = roster.data;

  const notOnSite = new Set(result?.notOnSite.map((p) => p.id) ?? []);
  const shown = data.players.filter((p) => showRemoved || !p.removed);
  const removedCount = data.players.filter((p) => p.removed).length;
  const editing = panel && panel.kind !== 'new' ? data.players.find((p) => p.id === panel.id) : undefined;
  const isNewest = data.season === null || data.season === data.seasons[0];

  const saved = (): void => {
    setPanel(null);
    roster.reload();
  };

  const runImport = async (): Promise<void> => {
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      setResult(await apiRequest('/api/admin/roster/import', ImportRosterResponseSchema, { method: 'POST', body: {} }));
      roster.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const act = async (p: Player, what: () => Promise<void>): Promise<void> => {
    setError(null);
    setBusyId(p.id);
    try {
      await what();
      roster.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };
  const remove = (p: Player): Promise<void> =>
    act(p, () => apiCommand(`/api/admin/roster/players/${encodeURIComponent(p.id)}`, { method: 'DELETE' }));
  const restore = (p: Player): Promise<void> =>
    act(p, async () => {
      await apiRequest(`/api/admin/roster/players/${encodeURIComponent(p.id)}`, PlayerSchema, {
        method: 'PATCH',
        body: { removed: false },
      });
    });

  const progress = photoProgressText(data.import);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">Squadra</h1>
        {data.seasons.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-text">
            Stagione
            <select
              className={`${inputClass} w-auto`}
              value={data.season ?? ''}
              onChange={(e) => setSeason(Number(e.target.value))}
            >
              {data.seasons.map((s) => (
                <option key={s} value={s}>
                  {seasonLabel(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        {data.seasons.length <= 1 && data.season !== null && (
          <p className="text-sm text-muted">Stagione {seasonLabel(data.season)}</p>
        )}
      </div>
      {!canEdit && <p className="text-sm text-muted">{READ_ONLY_TEXT}</p>}
      {canEdit && (
        <Card
          title="Importa dal sito della Lega"
          subtitle={
            data.team
              ? `Legge la pagina di ${data.team.name} sul sito della Lega: aggiunge i giocatori nuovi e aggiorna gli altri, senza toccare ciò che hai modificato a mano.`
              : undefined
          }
        >
          <div className="space-y-3">
            {!data.team && (
              <p className="text-sm text-muted">
                Per importare la squadra scegli prima la serie e la squadra del club in{' '}
                <Link to="/admin/club" className="font-medium text-primary underline">
                  Club
                </Link>
                .
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => void runImport()} disabled={importing || running || !data.team}>
                {importing ? 'Importazione in corso…' : 'Importa dal sito della Lega'}
              </Button>
              {progress && (
                <p role="status" className="text-sm text-muted">
                  {progress}
                </p>
              )}
              {!running && data.import.lastError && (
                <p className="text-sm text-danger">Ultima importazione: {data.import.lastError}</p>
              )}
            </div>
            {result && <ImportResult result={result} />}
          </div>
        </Card>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {roster.error !== null && <ErrorBox onRetry={roster.reload}>{errorMessage(roster.error)}</ErrorBox>}
      <Card
        title="Giocatori"
        actions={
          <>
            {removedCount > 0 && (
              <label className="flex items-center gap-1.5 text-sm text-text">
                <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
                Mostra rimossi ({removedCount})
              </label>
            )}
            {canEdit && isNewest && (
              <Button onClick={() => setPanel({ kind: 'new' })} disabled={panel?.kind === 'new'}>
                Aggiungi giocatore
              </Button>
            )}
          </>
        }
      >
        {shown.length === 0 ? (
          <Empty>
            Nessun giocatore in squadra.
            {canEdit ? ' Importali dal sito della Lega o aggiungili a mano.' : ''}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <caption className="sr-only">Giocatori della squadra</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="px-2 py-1">
                    <span className="sr-only">Foto</span>
                  </th>
                  <th scope="col" className="px-2 py-1">
                    N°
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Cognome
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Nome
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Ruolo
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Anno
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Altezza
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Naz.
                  </th>
                  <th scope="col" className="px-2 py-1">
                    <span className="sr-only">Azioni</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-grid">
                {shown.map((p) => (
                  <tr key={p.id} className={p.removed ? 'opacity-60' : ''}>
                    <td className={cell}>
                      {p.photo ? (
                        <img src={p.photo.url} alt="" className="size-10 rounded-full object-cover" />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-xs text-muted"
                        >
                          {p.number}
                        </span>
                      )}
                      {p.photo && <Edited player={p} field="photo" />}
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {p.number}
                      <Edited player={p} field="number" />
                    </td>
                    <td className={`${cell} font-medium`}>
                      {p.lastName}
                      <Edited player={p} field="lastName" />
                      {p.removed && <span className="ml-2 text-xs text-muted">Rimosso</span>}
                      {notOnSite.has(p.id) && <span className="ml-2 text-xs text-warn">Non più sul sito</span>}
                    </td>
                    <td className={cell}>
                      {p.firstName}
                      <Edited player={p} field="firstName" />
                    </td>
                    <td className={cell}>
                      {p.role ? PLAYER_ROLE_LABELS[p.role] : '—'}
                      <Edited player={p} field="role" />
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {p.birthYear ?? '—'}
                      <Edited player={p} field="birthYear" />
                    </td>
                    <td className={`${cell} tabular-nums`}>
                      {p.heightCm === null ? '—' : `${p.heightCm} cm`}
                      <Edited player={p} field="heightCm" />
                    </td>
                    <td className={cell}>
                      {p.nationality ?? '—'}
                      <Edited player={p} field="nationality" />
                    </td>
                    <td className={cell}>
                      {canEdit &&
                        (p.removed ? (
                          <Button
                            variant="ghost"
                            disabled={busyId === p.id}
                            aria-label={`Ripristina ${playerFullName(p)}`}
                            onClick={() => void restore(p)}
                          >
                            Ripristina
                          </Button>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            <Button
                              variant="ghost"
                              aria-label={`Modifica ${playerFullName(p)}`}
                              onClick={() => setPanel({ kind: 'edit', id: p.id })}
                            >
                              Modifica
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`Foto e video di ${playerFullName(p)}`}
                              onClick={() => setPanel({ kind: 'media', id: p.id })}
                            >
                              Foto e video
                            </Button>
                            <ConfirmButton
                              label="Rimuovi"
                              confirmLabel="Conferma rimozione"
                              ariaLabel={`Rimuovi ${playerFullName(p)}`}
                              busy={busyId === p.id}
                              onConfirm={() => void remove(p)}
                            />
                          </span>
                        ))}
                      {!canEdit && (
                        <span className="text-xs text-muted">{p.media.length > 0 ? `${p.media.length} file` : ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pt-2 text-xs text-muted">
          Il segno ✎ indica un campo modificato a mano: una nuova importazione non lo sovrascrive. I giocatori si
          abbinano a quelli del file di scout dal numero di maglia.
        </p>
      </Card>
      {canEdit && panel?.kind === 'new' && <PlayerForm player={null} onSaved={saved} onCancel={() => setPanel(null)} />}
      {canEdit && panel?.kind === 'edit' && editing && (
        <PlayerForm key={editing.id} player={editing} onSaved={saved} onCancel={() => setPanel(null)} />
      )}
      {canEdit && panel?.kind === 'media' && editing && (
        <>
          {assets.error !== null && !assets.data ? (
            <ErrorBox onRetry={assets.reload}>{errorMessage(assets.error)}</ErrorBox>
          ) : !assets.data ? (
            <Spinner label="Caricamento dei file della libreria…" />
          ) : (
            <MediaEditor
              key={editing.id}
              player={editing}
              assets={assets.data.assets}
              onSaved={saved}
              onCancel={() => setPanel(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
