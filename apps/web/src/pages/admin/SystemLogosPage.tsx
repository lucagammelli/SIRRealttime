import type { SystemLogo, SystemLogos, SystemLogoSlot, SystemLogoVariant } from '@arenalive/shared';
import {
  ASSET_MAX_BYTES,
  hasSystemLogo,
  SYSTEM_LOGO_MAX_HEIGHT,
  SYSTEM_LOGO_MAX_WIDTH,
  SYSTEM_LOGO_SLOTS,
  SYSTEM_LOGO_VARIANTS,
  SystemLogosSchema,
} from '@arenalive/shared';
import type { ReactNode } from 'react';
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
const VARIANT_TITLE: Record<SystemLogoVariant, string> = {
  positive: 'Positivo · per sfondi chiari',
  negative: 'Negativo · per sfondi scuri',
};
const VARIANT_NAME: Record<SystemLogoVariant, string> = { positive: 'positivo', negative: 'negativo' };
/** Theme of the preview of a variant: the positive on a light background, the negative on a dark one. */
const VARIANT_THEME: Record<SystemLogoVariant, 'light' | 'dark'> = { positive: 'light', negative: 'dark' };
const LIMIT_TEXT = `PNG, JPEG, WebP o SVG, al massimo ${SYSTEM_LOGO_MAX_WIDTH}×${SYSTEM_LOGO_MAX_HEIGHT} px.`;

/**
 * Surface with its own light or dark tokens (`data-sir-scope`), independent of the theme and of the colours of the
 * page around it: the previews show the logos on a light and on a dark background.
 */
function ThemedSurface({
  theme,
  className = '',
  children,
}: {
  theme: 'light' | 'dark';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-sir-scope=""
      data-theme={theme}
      className={`rounded-card border border-border bg-surface text-text ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * «Loghi di sistema» (superadmin only): the logos of the platform, the same for every client, one at the left and one
 * at the right, each in a positive variant (light backgrounds) and a negative one (dark backgrounds): four places that
 * can be loaded, replaced or removed. The left logo stands at the top of the menu of the reserved area; both stand in
 * the header of the public live page. The clients cannot change them.
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
    // The headers of the portal (menu of this page included) follow at once.
    setSystemLogos(next);
  };

  const any = current !== null && (hasSystemLogo(current.left) || hasSystemLogo(current.right));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card
        title="Loghi di sistema"
        subtitle="Due loghi della piattaforma, uno a sinistra e uno a destra, ciascuno in due versioni: positivo per gli sfondi chiari e negativo per quelli scuri. Il portale sceglie da solo la versione adatta allo sfondo e, se ne manca una, usa l’altra. Il logo a sinistra compare in alto nel menu dell’area riservata, al posto del logo del cliente; entrambi compaiono in alto nella pagina live di ogni cliente. Sono uguali per tutti i clienti e solo il superadmin li può cambiare."
      >
        {loaded.loading && !current && <Spinner label="Caricamento dei loghi…" />}
        {loaded.error !== null && <ErrorBox onRetry={loaded.reload}>{errorMessage(loaded.error)}</ErrorBox>}
        {current && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-text">Anteprima della testata della pagina live</p>
            {any ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(['light', 'dark'] as const).map((theme) => (
                  <div key={theme} className="space-y-1" data-testid={`anteprima-testata-${theme}`}>
                    <p className="text-xs text-muted">{theme === 'light' ? 'Tema chiaro' : 'Tema scuro'}</p>
                    <ThemedSurface theme={theme} className="p-3">
                      <SystemLogosBar logos={current} />
                    </ThemedSurface>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-dashed border-border p-3">
                <p className="text-sm text-muted">Nessun logo: le testate restano come sono.</p>
              </div>
            )}
          </div>
        )}
      </Card>
      {current &&
        SYSTEM_LOGO_SLOTS.map((slot) => (
          <Card key={slot} title={SLOT_TITLE[slot]} subtitle={LIMIT_TEXT}>
            <div className="grid gap-4 sm:grid-cols-2">
              {SYSTEM_LOGO_VARIANTS.map((variant) => (
                <SlotCard
                  key={variant}
                  slot={slot}
                  variant={variant}
                  logo={current[slot][variant]}
                  onChanged={changed}
                />
              ))}
            </div>
          </Card>
        ))}
    </div>
  );
}

function SlotCard({
  slot,
  variant,
  logo,
  onChanged,
}: {
  slot: SystemLogoSlot;
  variant: SystemLogoVariant;
  logo: SystemLogo | null;
  onChanged: (logos: SystemLogos) => void;
}) {
  const errorMessage = useApiError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/admin/system-logos/${slot}/${variant}`;
  /** Name of the place, e.g. «Logo a sinistra positivo». */
  const name = `${SLOT_TITLE[slot]} ${VARIANT_NAME[variant]}`;

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
    <div className="space-y-3" aria-label={name} role="group">
      <p className="text-sm font-medium text-text">{VARIANT_TITLE[variant]}</p>
      <ThemedSurface theme={VARIANT_THEME[variant]} className="flex h-[66px] items-center justify-center p-2">
        {logo ? (
          <img
            src={logo.url}
            alt={name}
            className="max-h-[50px] max-w-[180px] object-contain"
            width={logo.width}
            height={logo.height}
          />
        ) : (
          <span className="text-sm text-muted">Nessun logo</span>
        )}
      </ThemedSurface>
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
            aria-label={`${logo ? 'Sostituisci' : 'Carica'}: ${name.toLowerCase()}`}
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
            ariaLabel={`Rimuovi ${name.toLowerCase()}`}
            busy={busy}
            onConfirm={() => void run(() => apiRequest(path, SystemLogosSchema, { method: 'DELETE' }))}
          />
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
