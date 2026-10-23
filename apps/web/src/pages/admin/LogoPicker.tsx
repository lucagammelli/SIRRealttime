import type { AssetKind, AssetSummary } from '@arenalive/shared';
import { ASSET_MAX_BYTES, AssetSummarySchema } from '@arenalive/shared';
import { useId, useState } from 'react';
import { Button } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';
import { useApiError } from './auth.tsx';

/** Image types accepted by the server (it checks them again from the bytes). */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

/**
 * Uploads an image of the client (`POST /api/admin/assets`), of kind `logo` unless told otherwise: the same checks of
 * the server for every image.
 */
export async function uploadLogo(file: File, kind: AssetKind = 'logo'): Promise<AssetSummary> {
  return apiRequest('/api/admin/assets', AssetSummarySchema, {
    method: 'POST',
    body: { kind, data: await fileToBase64(file) },
  });
}

/**
 * A logo with «Carica» and «Predefinito»: `url` the logo shown now (null: none, the initials or nothing), `custom`
 * whether it is a logo chosen here (then «Predefinito» goes back to the default one). Disabled for a viewer.
 */
export function LogoPicker({
  label,
  url,
  custom,
  disabled = false,
  onChange,
  defaultLabel = 'Predefinito',
  kind = 'logo',
}: {
  label: string;
  url: string | null;
  custom: boolean;
  disabled?: boolean;
  /** The id of the new image, null for the default one; a rejection is shown under the logo. */
  onChange: (assetId: string | null) => Promise<void>;
  defaultLabel?: string;
  /** Kind of the uploaded image (default `logo`; `sponsor` for the photos of the pauses). */
  kind?: AssetKind;
}) {
  const errorMessage = useApiError();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = (file: File | undefined): void => {
    if (!file) return;
    if (file.size > ASSET_MAX_BYTES) {
      setError('Immagine troppo grande (massimo 2 MB).');
      return;
    }
    void run(async () => onChange((await uploadLogo(file, kind)).id));
  };

  return (
    <div className="flex min-w-0 items-center gap-3">
      {url ? (
        <img src={url} alt="" className="size-12 shrink-0 rounded-card bg-surface-2 object-contain p-1" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-card bg-surface-2 text-[0.6rem] text-muted"
        >
          nessuno
        </span>
      )}
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-text">{label}</p>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            aria-disabled={disabled || busy}
            className={`inline-flex min-h-9 cursor-pointer items-center rounded-button border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-surface-2 pointer-coarse:min-h-11 ${
              disabled || busy ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {busy ? 'Caricamento…' : 'Carica immagine'}
          </label>
          <input
            id={inputId}
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {custom && (
            <Button variant="ghost" disabled={disabled || busy} onClick={() => void run(() => onChange(null))}>
              {defaultLabel}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
