import type { SystemLogo, SystemLogos, SystemLogoSlot } from '@sir/shared';
import {
  ASSET_MAX_BYTES,
  SYSTEM_LOGO_MAX_HEIGHT,
  SYSTEM_LOGO_MAX_WIDTH,
  SYSTEM_LOGO_SLOTS,
  SystemLogosSchema,
} from '@sir/shared';
import { useCallback, useEffect, useState } from 'react';
import { SystemLogosBar } from '../../components/SystemLogosBar.tsx';
import { Card, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';
import { setSystemLogos } from '../../lib/systemLogos.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton } from './forms.tsx';
import { ACCEPT, IMAGE_TOO_LARGE } from './imageUpload.ts';

const SLOT_TITLE: Record<SystemLogoSlot, string> = { left: 'Logo a sinistra', right: 'Logo a destra' };
const LIMIT_TEXT = `PNG, JPEG, WebP o SVG, al massimo ${SYSTEM_LOGO_MAX_WIDTH}×${SYSTEM_LOGO_MAX_HEIGHT} px.`;

/**
 * «Loghi di sistema» (superadmin only): the two logos of the platform, at the left and at the right of the header of
 * the public live page and of the reserved area, the same for every client. Each can be loaded, replaced or removed;
 * the clients cannot change them.
 */
export function SystemLogosPage() {
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/public/system-logos', SystemLogosSchema, { signal }),
    [],
  );
  const loaded = useAsync(load);
  const errorMessage = useApiError();
  const [logos, setLogos] = useState<SystemLogos | null>(null);
  const current = logos ?? loaded.data;

  useEffect(() => {
    document.title = 'Loghi di sistema · Area riservata';
  }, []);

  const changed = (next: SystemLogos): void => {
    setLogos(next);
    // The headers of this page follow at once.
    setSystemLogos(next);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card
        title="Loghi di sistema"
        subtitle="Compaiono in alto, uno a sinistra e uno a destra, nella pagina live di ogni cliente e nell’area riservata. Sono uguali per tutti i clienti e solo il superadmin li può cambiare."
      >
        {loaded.loading && !current && <Spinner label="Caricamento dei loghi…" />}
        {loaded.error !== null && <ErrorBox onRetry={loaded.reload}>{errorMessage(loaded.error)}</ErrorBox>}
        {current && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Anteprima della testata</p>
            <div className="rounded-card border border-dashed border-border p-3">
              {current.left || current.right ? (
                <SystemLogosBar logos={current} />
              ) : (
                <p className="text-sm text-muted">Nessun logo: la testata resta com’è.</p>
              )}
            </div>
          </div>
        )}
      </Card>
      {current && (
        <div className="grid gap-4 md:grid-cols-2">
          {SYSTEM_LOGO_SLOTS.map((slot) => (
            <SlotCard key={slot} slot={slot} logo={current[slot]} onChanged={changed} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotCard({
  slot,
  logo,
  onChanged,
}: {
  slot: SystemLogoSlot;
  logo: SystemLogo | null;
  onChanged: (logos: SystemLogos) => void;
}) {
  const errorMessage = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/admin/system-logos/${slot}`;
  const title = SLOT_TITLE[slot];

  const run = async (action: () => Promise<SystemLogos>): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      onChanged(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File): void => {
    if (file.size > ASSET_MAX_BYTES) {
      setError(IMAGE_TOO_LARGE);
      return;
    }
    void run(async () =>
      apiRequest(path, SystemLogosSchema, { method: 'PUT', body: { data: await fileToBase64(file) } }),
    );
  };

  return (
    <Card title={title} subtitle={LIMIT_TEXT}>
      <div className="space-y-3" aria-label={title} role="group">
        <div className="flex h-[66px] items-center justify-center rounded-card border border-border bg-surface-2 p-2">
          {logo ? (
            <img
              src={logo.url}
              alt={title}
              className="max-h-[50px] max-w-[150px] object-contain"
              width={logo.width}
              height={logo.height}
            />
          ) : (
            <span className="text-sm text-muted">Nessun logo</span>
          )}
        </div>
        {logo && (
          <p className="text-xs text-muted">
            {logo.width}×{logo.height} px
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`inline-flex min-h-9 items-center rounded-card border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text ${
              busy ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2'
            }`}
          >
            {busy ? 'Caricamento…' : logo ? 'Sostituisci logo' : 'Carica logo'}
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy}
              aria-label={`${logo ? 'Sostituisci' : 'Carica'}: ${title.toLowerCase()}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) upload(file);
              }}
            />
          </label>
          {logo && (
            <ConfirmButton
              label="Rimuovi"
              confirmLabel="Conferma rimozione"
              ariaLabel={`Rimuovi ${title.toLowerCase()}`}
              busy={busy}
              onConfirm={() => void run(() => apiRequest(path, SystemLogosSchema, { method: 'DELETE' }))}
            />
          )}
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Card>
  );
}
