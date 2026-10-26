import type {
  AssetKind,
  Player,
  AssetListResponse,
  AssetSummary,
  Sponsor,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@arenalive/shared';
import {
  ASSET_MAX_BYTES,
  ASSET_NAME_MAX,
  AssetListResponseSchema,
  AssetNameSchema,
  BrandingResponseSchema,
  BRANDING_IMAGE_SLOTS,
  IntermissionsResponseSchema,
  intermissionImageIds,
  intermissionMedia,
  intermissionSponsorIds,
  isVideoMime,
  LayoutResponseSchema,
  layoutImageIds,
  layoutSponsorIds,
  OverlaysResponseSchema,
  overlayBackgrounds,
  RosterResponseSchema,
  SponsorListResponseSchema,
} from '@arenalive/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { megabytes } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import {
  ACCEPT,
  ACCEPT_VIDEO,
  assetDetails,
  assetLabel,
  IMAGE_TOO_LARGE,
  uploadImage,
  uploadVideo,
  videoProblem,
} from './imageUpload.ts';

/** The saved documents of the Studio: what the public page really uses. */
export interface SavedDocs {
  branding: TenantBranding;
  layout: TenantLayout;
  intermissions: TenantIntermissions;
  overlays: TenantOverlays;
}

/**
 * Pure: ids of the files the saved documents use: the logos of the graphics, the images of the sponsor blocks and of the
 * pauses («Sponsor», «Foto o video», «Dopo la partita»), the backgrounds of the overlays, and every image of a sponsor
 * chosen by a sponsor block or a sponsor slide.
 */
export function assetsInUse(saved: SavedDocs, assets: readonly AssetSummary[]): Set<string> {
  const used = new Set<string>();
  for (const slot of Object.keys(BRANDING_IMAGE_SLOTS) as (keyof typeof BRANDING_IMAGE_SLOTS)[]) {
    const id = saved.branding[slot];
    if (id !== null) used.add(id);
  }
  for (const id of layoutImageIds(saved.layout)) used.add(id);
  for (const id of intermissionImageIds(saved.intermissions)) used.add(id);
  for (const media of intermissionMedia(saved.intermissions)) used.add(media.assetId);
  for (const background of overlayBackgrounds(saved.overlays)) used.add(background.assetId);
  const sponsors = new Set([...layoutSponsorIds(saved.layout), ...intermissionSponsorIds(saved.intermissions)]);
  for (const a of assets) if (a.sponsorId && sponsors.has(a.sponsorId)) used.add(a.id);
  return used;
}

/**
 * Pure: the players of the roster that use each file (main photo or other photo or video), by asset id, as their
 * surnames in the order of the roster.
 */
export function playersByAsset(
  players: readonly Pick<Player, 'lastName' | 'photo' | 'media' | 'removed'>[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of players) {
    if (p.removed) continue;
    const ids = new Set([...(p.photo ? [p.photo.assetId] : []), ...p.media.map((m) => m.assetId)]);
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), p.lastName]);
  }
  return out;
}

/**
 * Pure: what a file of the list is for: «Logo», «Video dello sfondo di un avviso», «Sponsor: Bar Sport», «Giocatore:
 * Rossi»… (`playerNames`: the surnames of the players that use it).
 */
export function assetUseText(
  a: AssetSummary,
  sponsorName: ReadonlyMap<string, string>,
  playerNames: readonly string[] = [],
): string {
  if (a.kind === 'logo') return 'Logo';
  if (a.kind === 'player') {
    const what = isVideoMime(a.mime) ? 'Video di un giocatore' : 'Foto di un giocatore';
    return playerNames.length > 0 ? `Giocatore: ${playerNames.join(', ')}` : what;
  }
  if (a.kind === 'overlay') return isVideoMime(a.mime) ? 'Video dello sfondo di un avviso' : 'Sfondo di un avviso';
  const sponsor = a.sponsorId ? sponsorName.get(a.sponsorId) : undefined;
  return sponsor === undefined ? 'Sponsor (senza sponsor)' : `Sponsor: ${sponsor}`;
}

/**
 * «Rinomina» of a file of the list: the name shown in the lists (never the file on the server); empty: back to no
 * name. Checked with the shared schema before sending.
 */
function RenameAsset({
  asset,
  onRenamed,
  onError,
}: {
  asset: AssetSummary;
  onRenamed: () => void;
  onError: (err: unknown) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = assetLabel(asset);
  if (draft === null)
    return (
      <Button variant="ghost" aria-label={`Rinomina ${label}`} onClick={() => setDraft(asset.name ?? '')}>
        Rinomina
      </Button>
    );
  const trimmed = draft.trim();
  const parsed = trimmed === '' ? null : AssetNameSchema.safeParse(trimmed);
  const invalid = parsed !== null && !parsed.success;
  const save = async (): Promise<void> => {
    if (invalid) return;
    setBusy(true);
    onError(null);
    try {
      await apiCommand(`/api/admin/assets/${encodeURIComponent(asset.id)}`, {
        method: 'PATCH',
        body: { name: parsed?.success ? parsed.data : null },
      });
      setDraft(null);
      onRenamed();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        type="text"
        value={draft}
        maxLength={ASSET_NAME_MAX}
        aria-label={`Nuovo nome di ${label}`}
        aria-invalid={invalid}
        onChange={(e) => setDraft(e.target.value)}
        className={inputClass}
      />
      <Button type="submit" disabled={busy || invalid}>
        {busy ? 'Attendere…' : 'Salva nome'}
      </Button>
      <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
        Annulla
      </Button>
      {invalid && (
        <p role="alert" className="w-full text-xs text-danger">
          Nome non valido: niente «/», «\» né caratteri speciali invisibili.
        </p>
      )}
    </form>
  );
}

/** What a new image is for: the kind the server asks for (and, for a sponsor, the sponsor). */
export type UploadUse = 'logo' | 'sponsor' | 'overlay' | 'player';
export const UPLOAD_USES: readonly { value: UploadUse; label: string }[] = [
  { value: 'logo', label: 'Logo' },
  { value: 'sponsor', label: 'Sponsor o foto delle pause' },
  { value: 'overlay', label: 'Sfondo degli avvisi' },
  { value: 'player', label: 'Foto e video dei giocatori' },
];
const NO_SPONSOR = '';
/** Start of the message of the server when the space of the library is over. */
const LIBRARY_FULL = 'Spazio per i file esaurito';

interface UploadSummary {
  uploaded: number;
  failed: { name: string; reason: string }[];
  full: boolean;
  /** Names of the files not tried because the library is full. */
  notSent?: string[];
}

/** End of an upload of many files: how many were uploaded, and for every refused file its name and why. */
function UploadSummaryBox({ summary }: { summary: UploadSummary }) {
  const { uploaded, failed, full, notSent = [] } = summary;
  return (
    <div className="space-y-1 text-xs" role="status">
      <p className="text-text">
        {uploaded === 0 ? 'Nessun file caricato.' : uploaded === 1 ? 'Caricato 1 file.' : `Caricati ${uploaded} file.`}
      </p>
      {full && (
        <ErrorBox>
          Spazio della libreria esaurito: il caricamento si è fermato
          {notSent.length > 0 ? ` (non provati: ${notSent.join(', ')})` : ''}. Elimina i file che non usi.
        </ErrorBox>
      )}
      {failed.length > 0 && (
        <ul className="list-disc pl-4 text-danger">
          {failed.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.name}: {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * «Carica nella libreria»: the only place where images and videos are uploaded. An image is for a logo, a sponsor (of one
 * of the sponsors, or without one: the photos of the pauses) or the background of the overlays; a video only for the
 * background of the overlays. The other pages choose the files from the library.
 */
function UploadCard({ sponsors, onUploaded }: { sponsors: readonly Sponsor[]; onUploaded: () => void }) {
  const errorMessage = useApiError();
  const [use, setUse] = useState<UploadUse>('logo');
  const [sponsorId, setSponsorId] = useState(NO_SPONSOR);
  const [busy, setBusy] = useState<'image' | 'video' | null>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);

  /** Uploads the chosen files one after the other (never in parallel), with the same use and sponsor; a refused file does not stop the others, a full library does. */
  const sendAll = async (what: 'image' | 'video', files: readonly File[]): Promise<void> => {
    if (files.length === 0) return;
    setSummary(null);
    setBusy(what);
    const result: UploadSummary = { uploaded: 0, failed: [], full: false };
    try {
      for (const [i, file] of files.entries()) {
        setProgress({ n: i + 1, total: files.length });
        const problem = what === 'video' ? videoProblem(file) : file.size > ASSET_MAX_BYTES ? IMAGE_TOO_LARGE : null;
        if (problem) {
          result.failed.push({ name: file.name, reason: problem });
          continue;
        }
        try {
          const asset =
            what === 'video'
              ? await uploadVideo(file, use === 'player' ? 'player' : 'overlay')
              : await uploadImage(
                  file,
                  use satisfies AssetKind,
                  use === 'sponsor' && sponsorId ? sponsorId : undefined,
                );
          if (asset) result.uploaded += 1;
          else result.failed.push({ name: file.name, reason: IMAGE_TOO_LARGE });
        } catch (err) {
          const reason = errorMessage(err);
          result.failed.push({ name: file.name, reason });
          if (reason.startsWith(LIBRARY_FULL)) {
            result.full = true;
            result.notSent = files.slice(i + 1).map((f) => f.name);
            break;
          }
        }
      }
    } finally {
      setBusy(null);
      setProgress(null);
      setSummary(result);
      if (result.uploaded > 0) onUploaded();
    }
  };
  const pickerClass =
    'inline-flex min-h-9 cursor-pointer items-center rounded-card border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2';
  return (
    <Card
      title="Carica nella libreria"
      subtitle="Qui si caricano tutte le immagini e i video; nelle altre pagine si scelgono da qui."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Uso dell’immagine">
            <select
              className={inputClass}
              value={use}
              onChange={(e) => setUse(UPLOAD_USES.find((u) => u.value === e.target.value)?.value ?? 'logo')}
              disabled={busy !== null}
            >
              {UPLOAD_USES.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          {use === 'sponsor' && (
            <Field
              label="Sponsor"
              hint="Facoltativo: senza sponsor la foto resta nell’elenco «Immagini senza sponsor»."
            >
              <select
                className={inputClass}
                value={sponsorId}
                onChange={(e) => setSponsorId(e.target.value)}
                disabled={busy !== null}
              >
                <option value={NO_SPONSOR}>Nessuno sponsor</option>
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={pickerClass}>
            {busy === 'image' ? 'Caricamento…' : 'Carica immagini'}
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy !== null}
              aria-label="Carica immagine nella libreria"
              multiple
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                void sendAll('image', files);
              }}
            />
          </label>
          <label className={pickerClass}>
            {busy === 'video' ? 'Caricamento…' : 'Carica video'}
            <input
              type="file"
              accept={ACCEPT_VIDEO}
              className="sr-only"
              disabled={busy !== null}
              aria-label="Carica video nella libreria"
              multiple
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                void sendAll('video', files);
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Immagini PNG, JPEG, WebP o SVG, al massimo 2 MB. Video MP4, MOV o WebM, al massimo 15 MB: servono come sfondo
          degli avvisi o come video dei giocatori: il video segue l’uso scelto sopra («Foto e video dei giocatori»; con
          gli altri usi è per gli avvisi). Ogni immagine e ogni video si possono mostrare anche nelle pause, con la
          diapositiva «Foto o video».
        </p>
        <p role="status" aria-live="polite" className="text-xs text-muted">
          {progress ? `Caricamento ${progress.n} di ${progress.total}…` : ''}
        </p>
        {summary && <UploadSummaryBox summary={summary} />}
      </div>
    </Card>
  );
}

/**
 * Section «Immagini e video»: the files uploaded by the client (logos, sponsor images, backgrounds of the overlays, photos and videos of the players) with
 * name, use, size and weight; «Rinomina» and «Elimina». No draft and no «Salva»: a change is made at once. The files
 * are uploaded only here (`UploadCard`): the other pages choose from this library.
 */
function LibraryList({
  assets,
  sponsors,
  saved,
  playerNames,
  onAssetsChanged,
}: {
  assets: AssetListResponse;
  sponsors: readonly Sponsor[];
  saved: SavedDocs;
  /** Surnames of the players of the roster that use each file, by asset id. */
  playerNames: ReadonlyMap<string, string[]>;
  onAssetsChanged: () => void;
}) {
  const errorMessage = useApiError();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usedIds = assetsInUse(saved, assets.assets);
  const sponsorName = new Map(sponsors.map((s) => [s.id, s.name]));

  const remove = async (id: string): Promise<void> => {
    setError(null);
    setDeleting(id);
    try {
      await apiCommand(`/api/admin/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      onAssetsChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-3">
      <section aria-labelledby="immagini-caricate" className="rounded-panel border border-border bg-surface p-3">
        <h3 id="immagini-caricate" className="text-sm font-semibold text-text">
          Immagini e video caricati
        </h3>
        <p className="pb-2 text-xs text-muted">
          Spazio usato: {megabytes(assets.usedBytes)} MB di {megabytes(assets.quotaBytes)} MB
        </p>
        {assets.assets.length === 0 ? (
          <Empty>Nessun file caricato.</Empty>
        ) : (
          <ul className="divide-y divide-grid">
            {assets.assets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                {isVideoMime(a.mime) ? (
                  <video src={a.url} muted playsInline preload="metadata" className="size-10 rounded object-cover" />
                ) : (
                  <img src={a.url} alt="" className="size-10 rounded object-contain" />
                )}
                <span className="min-w-0 flex-1 text-sm text-text">
                  <span className="block truncate font-medium" title={assetLabel(a)}>
                    {assetLabel(a)}
                  </span>
                  <span className="block text-xs text-muted">
                    {assetUseText(a, sponsorName, playerNames.get(a.id))} · {assetDetails(a)}
                    {(usedIds.has(a.id) || playerNames.has(a.id)) && ' · in uso'}
                  </span>
                </span>
                <RenameAsset
                  asset={a}
                  onRenamed={onAssetsChanged}
                  onError={(err) => setError(err === null ? null : errorMessage(err))}
                />
                <ConfirmButton
                  label="Elimina"
                  confirmLabel="Conferma eliminazione"
                  busy={deleting === a.id}
                  ariaLabel={`Elimina ${assetLabel(a)}`}
                  onConfirm={() => void remove(a.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

/**
 * Page «Immagini e video» (`/admin/media`): the library of the files of the client: where they are uploaded, with name,
 * use, size, weight, «Rinomina» and «Elimina», and whether the saved graphics use them («in uso»).
 */
export function MediaPage() {
  const errorMessage = useApiError();
  const loadAssets = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const loadSponsors = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/sponsors', SponsorListResponseSchema, { signal }),
    [],
  );
  const loadSaved = useCallback(async (signal: AbortSignal): Promise<SavedDocs> => {
    const [branding, layout, intermissions, overlays] = await Promise.all([
      apiRequest('/api/admin/branding', BrandingResponseSchema, { signal }),
      apiRequest('/api/admin/layout', LayoutResponseSchema, { signal }),
      apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, { signal }),
      apiRequest('/api/admin/overlays', OverlaysResponseSchema, { signal }),
    ]);
    return {
      branding: branding.branding,
      layout: layout.layout,
      intermissions: intermissions.intermissions,
      overlays: overlays.overlays,
    };
  }, []);
  const assets = useAsync(loadAssets);
  const sponsors = useAsync(loadSponsors);
  const saved = useAsync(loadSaved);
  // The roster tells which player uses each file; without it («Squadra» not readable) the files show no player.
  const loadRoster = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/roster', RosterResponseSchema, { signal }),
    [],
  );
  const roster = useAsync(loadRoster);

  useEffect(() => {
    document.title = 'Immagini e video · Area riservata';
  }, []);

  for (const part of [assets, sponsors, saved]) {
    if (part.error !== null) return <ErrorBox onRetry={part.reload}>{errorMessage(part.error)}</ErrorBox>;
  }
  if (!assets.data || !sponsors.data || !saved.data) return <Spinner label="Caricamento delle immagini e dei video…" />;
  const reload = (): void => {
    assets.reload();
    saved.reload();
    sponsors.reload();
    roster.reload();
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text">Immagini e video</h1>
      <UploadCard sponsors={sponsors.data.sponsors} onUploaded={reload} />
      <LibraryList
        assets={assets.data}
        sponsors={sponsors.data.sponsors}
        saved={saved.data}
        playerNames={playersByAsset(roster.data?.players ?? [])}
        onAssetsChanged={reload}
      />
    </div>
  );
}
