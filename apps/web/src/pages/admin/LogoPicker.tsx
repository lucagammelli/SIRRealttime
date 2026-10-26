import type { AssetKind, AssetSummary } from '@arenalive/shared';
import { AssetListResponseSchema, isVideoMime } from '@arenalive/shared';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { inputClass } from './forms.tsx';
import { assetOptionText } from './imageUpload.ts';

/**
 * A logo chosen from the library of the client with «Predefinito»: `url` the logo shown now (null: none, the initials or
 * nothing), `custom` whether it is a logo chosen here (then «Predefinito» goes back to the default one). The files are
 * not uploaded here: the list offers the images of the library of the kind asked, and «Carica nella libreria» opens
 * «Immagini e video». With `videos` the list offers also the videos (as `kind`), and `urlIsVideo` says the file shown is
 * one. Disabled for a viewer.
 */
export function LogoPicker({
  label,
  url,
  custom,
  disabled = false,
  onChange,
  defaultLabel = 'Predefinito',
  kind = 'logo',
  videos = false,
  urlIsVideo = false,
  onLibrary,
}: {
  label: string;
  url: string | null;
  custom: boolean;
  disabled?: boolean;
  /** The id of the new image (with its file of the library), null for the default one; a rejection is shown under the logo. */
  onChange: (assetId: string | null, asset?: AssetSummary) => Promise<void>;
  defaultLabel?: string;
  /** Kind of the images offered (default `logo`; `sponsor` for the photos of the pauses; null: every use). */
  kind?: AssetKind | null;
  /** The videos of the library are offered too. */
  videos?: boolean;
  /** The file shown (`url`) is a video. */
  urlIsVideo?: boolean;
  /**
   * «Carica nella libreria» goes to the library by this action instead of a plain link (a modal procedure closes itself
   * first, otherwise it would stay over the library).
   */
  onLibrary?: () => void;
}) {
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const library = useAsync(load);
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

  const files = (library.data?.assets ?? []).filter(
    (a) => (kind === null || a.kind === kind) && (videos || !isVideoMime(a.mime)),
  );
  const placeholder = library.loading
    ? 'Caricamento…'
    : files.length === 0
      ? 'Nessun file nella libreria'
      : 'Scegli dalla libreria…';

  return (
    <div className="flex min-w-0 items-center gap-3">
      {url && urlIsVideo ? (
        <video
          src={url}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="size-12 shrink-0 rounded-card bg-surface-2 object-contain p-1"
        />
      ) : url ? (
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
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputClass} w-auto max-w-full`}
            aria-label={`Scegli dalla libreria: ${label}`}
            value=""
            disabled={disabled || busy || library.loading}
            onChange={(e) => {
              const id = e.target.value;
              const asset = files.find((a) => a.id === id);
              if (id) void run(() => onChange(id, asset));
            }}
          >
            <option value="">{placeholder}</option>
            {files.map((a) => (
              <option key={a.id} value={a.id}>
                {assetOptionText(a)}
              </option>
            ))}
          </select>
          {custom && (
            <Button variant="ghost" disabled={disabled || busy} onClick={() => void run(() => onChange(null))}>
              {defaultLabel}
            </Button>
          )}
          {!disabled &&
            (onLibrary ? (
              <Button variant="ghost" onClick={onLibrary}>
                Carica nella libreria
              </Button>
            ) : (
              <Link to="/admin/media" className="text-sm font-medium text-primary underline">
                Carica nella libreria
              </Link>
            ))}
        </div>
        {library.error !== null && (
          <p role="alert" className="text-xs text-danger">
            {errorMessage(library.error)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
