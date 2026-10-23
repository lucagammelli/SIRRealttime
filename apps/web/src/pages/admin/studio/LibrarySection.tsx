import type {
  AssetListResponse,
  AssetSummary,
  Sponsor,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@arenalive/shared';
import {
  ASSET_NAME_MAX,
  AssetNameSchema,
  BRANDING_IMAGE_SLOTS,
  intermissionImageIds,
  intermissionSponsorIds,
  isVideoMime,
  layoutImageIds,
  layoutSponsorIds,
  overlayBackgrounds,
} from '@arenalive/shared';
import { useState } from 'react';
import { Button, Empty, ErrorBox } from '../../../components/ui.tsx';
import { apiCommand } from '../../../lib/api.ts';
import { megabytes } from '../../../lib/format.ts';
import { useApiError } from '../auth.tsx';
import { ConfirmButton, inputClass } from '../forms.tsx';
import { assetDetails, assetLabel } from '../imageUpload.ts';

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

/**
 * Section «Immagini e video»: the files uploaded by the client (logos, sponsor images, backgrounds of the overlays) with
 * name, use, size and weight; «Rinomina» and «Elimina». No draft and no «Salva»: a change is made at once. The files
 * are uploaded where they are used (logos in «Colori e loghi», backgrounds in «Avvisi», sponsors on their page).
 */
export function LibrarySection({
  assets,
  sponsors,
  saved,
  onAssetsChanged,
  onDeleted,
}: {
  assets: AssetListResponse;
  sponsors: readonly Sponsor[];
  saved: SavedDocs;
  onAssetsChanged: () => void;
  /** A file was deleted: the Studio forgets it in its drafts. */
  onDeleted: (id: string) => void;
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
      onDeleted(id);
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
