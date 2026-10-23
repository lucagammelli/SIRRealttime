import type {
  AssetKind,
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
  intermissionSponsorIds,
  isVideoMime,
  LayoutResponseSchema,
  layoutImageIds,
  layoutSponsorIds,
  OverlaysResponseSchema,
  overlayBackgrounds,
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
 * pauses («Sponsor», «Dopo la partita»), the backgrounds of the overlays, and every image of a sponsor chosen by a
 * sponsor block or a sponsor slide.
 */
export function assetsInUse(saved: SavedDocs, assets: readonly AssetSummary[]): Set<string> {
  const used = new Set<string>();
  for (const slot of Object.keys(BRANDING_IMAGE_SLOTS) as (keyof typeof BRANDING_IMAGE_SLOTS)[]) {
    const id = saved.branding[slot];
    if (id !== null) used.add(id);
  }
  for (const id of layoutImageIds(saved.layout)) used.add(id);
  for (const id of intermissionImageIds(saved.intermissions)) used.add(id);
  for (const background of overlayBackgrounds(saved.overlays)) used.add(background.assetId);
  const sponsors = new Set([...layoutSponsorIds(saved.layout), ...intermissionSponsorIds(saved.intermissions)]);
  for (const a of assets) if (a.sponsorId && sponsors.has(a.sponsorId)) used.add(a.id);
  return used;
}

/** Pure: what a file of the list is for: «Logo», «Video dello sfondo di un avviso», «Sponsor: Bar Sport»… */
export function assetUseText(a: AssetSummary, sponsorName: ReadonlyMap<string, string>): string {
  if (a.kind === 'logo') return 'Logo';
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
export type UploadUse = 'logo' | 'sponsor' | 'overlay';
export const UPLOAD_USES: readonly { value: UploadUse; label: string }[] = [
  { value: 'logo', label: 'Logo' },
  { value: 'sponsor', label: 'Sponsor o foto delle pause' },
  { value: 'overlay', label: 'Sfondo degli avvisi' },
];
const NO_SPONSOR = '';

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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = async (what: 'image' | 'video', file: File): Promise<void> => {
    setDone(null);
    const problem = what === 'video' ? videoProblem(file) : file.size > ASSET_MAX_BYTES ? IMAGE_TOO_LARGE : null;
    setError(problem);
    if (problem) return;
    setBusy(what);
    try {
      const asset =
        what === 'video'
          ? await uploadVideo(file)
          : await uploadImage(file, use satisfies AssetKind, use === 'sponsor' && sponsorId ? sponsorId : undefined);
      if (!asset) setError(IMAGE_TOO_LARGE);
      else {
        setDone(`Caricato: ${assetLabel(asset)}.`);
        onUploaded();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
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
            {busy === 'image' ? 'Caricamento…' : 'Carica immagine'}
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy !== null}
              aria-label="Carica immagine nella libreria"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void send('image', file);
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
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void send('video', file);
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Immagini PNG, JPEG, WebP o SVG, al massimo 2 MB. Video MP4 o WebM, al massimo 15 MB: servono solo come sfondo
          degli avvisi.
        </p>
        {busy !== null && (
          <p role="status" className="text-xs text-muted">
            Caricamento del file in corso…
          </p>
        )}
        {done && (
          <p role="status" className="text-xs text-text">
            {done}
          </p>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Card>
  );
}

/**
 * Section «Immagini e video»: the files uploaded by the client (logos, sponsor images, backgrounds of the overlays) with
 * name, use, size and weight; «Rinomina» and «Elimina». No draft and no «Salva»: a change is made at once. The files
 * are uploaded only here (`UploadCard`): the other pages choose from this library.
 */
function LibraryList({
  assets,
  sponsors,
  saved,
  onAssetsChanged,
}: {
  assets: AssetListResponse;
  sponsors: readonly Sponsor[];
  saved: SavedDocs;
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
                    {assetUseText(a, sponsorName)} · {assetDetails(a)}
                    {usedIds.has(a.id) && ' · in uso'}
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
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text">Immagini e video</h1>
      <UploadCard sponsors={sponsors.data.sponsors} onUploaded={reload} />
      <LibraryList assets={assets.data} sponsors={sponsors.data.sponsors} saved={saved.data} onAssetsChanged={reload} />
    </div>
  );
}
