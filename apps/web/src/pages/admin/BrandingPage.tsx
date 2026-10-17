import type {
  AssetKind,
  AssetListResponse,
  AssetSummary,
  BrandColorKey,
  BrandingImageSlot,
  ContrastIssue,
  OurTeam,
  TemplateId,
  TenantBranding,
} from '@sir/shared';
import {
  ASSET_MAX_BYTES,
  AssetListResponseSchema,
  AssetSummarySchema,
  BRAND_COLOR_KEYS,
  BRANDING_IMAGE_SLOTS,
  brandContrastIssues,
  BrandingResponseSchema,
  defaultBranding,
  HEX_COLOR_PATTERN,
  MIN_TEXT_CONTRAST,
  OUR_TEAM_CODE_MAX,
  OUR_TEAM_NAME_MAX,
  publicAssetPath,
  TEMPLATE_IDS,
  TEMPLATES,
  templateOf,
} from '@sir/shared';
import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandingPreview } from '../../components/BrandingPreview.tsx';
import { PreviewDock } from '../../components/PreviewDock.tsx';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';
import { initBranding } from '../../lib/branding.ts';
import { megabytes } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useElementSize } from '../../lib/useLayout.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';

export const COLOR_LABELS: Record<BrandColorKey, { label: string; hint: string }> = {
  primary: { label: 'Colore principale', hint: 'Pulsanti e nome nella testata.' },
  accent: { label: 'Colore di risalto', hint: 'Barra in alto e indicatori.' },
  home: { label: 'Squadra di casa', hint: 'Tabellone, grafici e statistiche della squadra di casa.' },
  away: { label: 'Squadra ospite', hint: 'Tabellone, grafici e statistiche della squadra ospite.' },
  background: { label: 'Sfondo della pagina', hint: 'Nel tema scuro diventa una tinta scura dello stesso colore.' },
};

const IMAGE_LABELS: Record<BrandingImageSlot, { label: string; hint: string }> = {
  logoMain: { label: 'Logo orizzontale', hint: 'Nella testata della pagina pubblica e dell’area riservata.' },
  logoMark: { label: 'Logo quadrato', hint: 'Icona della scheda del browser e spazi piccoli.' },
  sponsorLogo: { label: 'Logo dello sponsor', hint: 'Facoltativo.' },
};

const SLOTS = Object.keys(BRANDING_IMAGE_SLOTS) as BrandingImageSlot[];
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

const ratio = (r: number): string => r.toLocaleString('it-IT', { maximumFractionDigits: 1 });

/** Pure: Italian text of a contrast warning. */
export function contrastText(issue: ContrastIssue): string {
  const min = ratio(MIN_TEXT_CONTRAST);
  if (issue.color === 'text')
    return `Lo sfondo è troppo scuro per il testo della pagina (contrasto ${ratio(issue.ratio)}:1, minimo ${min}:1).`;
  return `«${COLOR_LABELS[issue.color].label}» ha contrasto ${ratio(issue.ratio)}:1 sullo sfondo (minimo ${min}:1): i testi in questo colore si leggono male.`;
}

/** Colour picker and hexadecimal field of one colour; empty: the colour of the template. */
function ColorField({
  name,
  value,
  fallback,
  onChange,
}: {
  name: BrandColorKey;
  value: string | undefined;
  /** Colour of the template when none is chosen. */
  fallback: string;
  onChange: (value: string | undefined) => void;
}) {
  const shown = value ?? fallback;
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const { label, hint } = COLOR_LABELS[name];
  const typed = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value.trim().toLowerCase();
    setText(e.target.value);
    if (HEX_COLOR_PATTERN.test(next)) onChange(next);
  };
  const invalid = !HEX_COLOR_PATTERN.test(text.trim().toLowerCase());
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: selettore`}
          value={shown}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-9 w-12 cursor-pointer rounded-card border border-border bg-surface-2"
        />
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-sm font-medium text-text">{label}</span>
          <input
            type="text"
            value={text}
            onChange={typed}
            spellCheck={false}
            maxLength={7}
            aria-invalid={invalid}
            className={`${inputClass} font-mono`}
          />
        </label>
        {value !== undefined && (
          <Button variant="ghost" onClick={() => onChange(undefined)}>
            Predefinito
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        {invalid ? 'Scrivi il colore come #rrggbb (es. #1d4ed8).' : hint}
        {value === undefined && !invalid && ' Ora: colore del modello.'}
      </p>
    </div>
  );
}

/**
 * Choice of the graphic template (closed list of @sir/shared): name and description of each one; the preview of the
 * page follows the choice at once.
 */
function TemplatePicker({ value, onChange }: { value: TemplateId; onChange: (value: TemplateId) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text">Modello grafico</legend>
      <div role="radiogroup" aria-label="Modello grafico" className="grid gap-2 sm:grid-cols-2">
        {TEMPLATE_IDS.map((id) => {
          const t = TEMPLATES[id];
          const active = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(id)}
              className={`flex min-h-11 flex-col items-start gap-1 rounded-card border px-3 py-2 text-left ${
                active ? 'border-primary bg-surface-2' : 'border-border bg-surface hover:bg-hover'
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-text">
                {t.label}
                <span aria-hidden="true" className="flex gap-1">
                  {[t.colors.background, t.colors.primary, t.colors.home, t.colors.away].map((c, i) => (
                    <span
                      // Swatches of the template: colours of the contract, the same as tokens.css (a test checks them).
                      key={`${c}-${i}`}
                      className="inline-block size-3.5 rounded-full border border-border"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
              </span>
              <span className="text-xs text-muted">{t.description}</span>
            </button>
          );
        })}
      </div>
      {templateOf(value).forcedTheme === 'dark' && (
        <p className="text-xs text-muted">
          Questo modello usa sempre il tema scuro: il pulsante chiaro/scuro non compare.
        </p>
      )}
    </fieldset>
  );
}

/** Pure: the team of the client with a typed field: trimmed, empty as null. */
export function withOurTeamField(team: OurTeam, field: keyof OurTeam, text: string): OurTeam {
  const trimmed = text.trim();
  return { ...team, [field]: trimmed === '' ? null : text };
}

/** Code and name of the team of the client in the `.dvw` files («nostra squadra»). */
function OurTeamFields({ value, onChange }: { value: OurTeam; onChange: (value: OurTeam) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text">Nostra squadra</legend>
      <p className="text-xs text-muted">
        Riconosce la squadra del cliente nel file della partita, con il codice della squadra e/o un testo contenuto nel
        nome (senza distinguere maiuscole e accenti). Quando è in campo prende sempre il colore della nostra squadra e
        l’avversaria il colore dell’avversario, in casa o in trasferta; se nessuna squadra corrisponde valgono i colori
        di casa e ospite.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Codice squadra" hint="Facoltativo, es. PER.">
          <input
            type="text"
            value={value.code ?? ''}
            maxLength={OUR_TEAM_CODE_MAX}
            spellCheck={false}
            onChange={(e) => onChange(withOurTeamField(value, 'code', e.target.value))}
            className={`${inputClass} font-mono uppercase`}
          />
        </Field>
        <Field label="Testo nel nome della squadra" hint="Facoltativo, es. Perugia.">
          <input
            type="text"
            value={value.name ?? ''}
            maxLength={OUR_TEAM_NAME_MAX}
            onChange={(e) => onChange(withOurTeamField(value, 'name', e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>
    </fieldset>
  );
}

/** One image of the branding: preview, upload, removal from the branding (the file stays in the list below). */
function ImageField({
  slot,
  asset,
  assetId,
  busy,
  onUpload,
  onClear,
}: {
  slot: BrandingImageSlot;
  asset: AssetSummary | undefined;
  assetId: string | null;
  busy: boolean;
  onUpload: (slot: BrandingImageSlot, file: File) => void;
  onClear: (slot: BrandingImageSlot) => void;
}) {
  const { label, hint } = IMAGE_LABELS[slot];
  const notSquare = slot === 'logoMark' && asset !== undefined && asset.width !== asset.height;
  return (
    <div className="space-y-2 rounded-card border border-border bg-surface-2 p-3">
      <p className="text-sm font-medium text-text">{label}</p>
      <div className="flex min-h-14 items-center justify-center rounded-card border border-dashed border-border bg-surface p-2">
        {assetId ? (
          <img src={publicAssetPath(assetId)} alt={label} className="max-h-16 w-auto max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted">Nessuna immagine</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center rounded-card border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2">
          {busy ? 'Caricamento…' : 'Carica immagine'}
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            aria-label={`Carica ${label.toLowerCase()}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onUpload(slot, file);
            }}
          />
        </label>
        {assetId && (
          <Button variant="ghost" onClick={() => onClear(slot)}>
            Togli
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        {hint} PNG, JPEG, WebP o SVG, al massimo 2 MB.
        {asset && ` ${asset.width}×${asset.height} px.`}
      </p>
      {notSquare && <p className="text-xs text-warn">L’immagine non è quadrata: verrà adattata.</p>}
    </div>
  );
}

/** Editor of the graphics of the client of the session: colours, logos, live preview, save. */
function BrandingEditor({
  tenantName,
  saved,
  assets,
  onAssetsChanged,
}: {
  tenantName: string;
  saved: TenantBranding;
  assets: AssetListResponse;
  onAssetsChanged: () => void;
}) {
  const errorMessage = useApiError();
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<BrandingImageSlot | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const issues = useMemo(() => brandContrastIssues(draft.colors, draft.template), [draft.colors, draft.template]);
  const template = templateOf(draft.template);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const byId = useMemo(() => new Map(assets.assets.map((a) => [a.id, a])), [assets]);
  const usedIds = new Set(SLOTS.map((s) => base[s]).filter((id) => id !== null));

  const setColor = (key: BrandColorKey, value: string | undefined): void => {
    setDraft((d) => {
      const colors = { ...d.colors };
      if (value === undefined) delete colors[key];
      else colors[key] = value;
      return { ...d, colors };
    });
  };

  const upload = async (slot: BrandingImageSlot, file: File): Promise<void> => {
    setError(null);
    setDone(null);
    if (file.size > ASSET_MAX_BYTES) {
      setError('Immagine troppo grande: al massimo 2 MB.');
      return;
    }
    setUploading(slot);
    try {
      const data = await fileToBase64(file);
      const kind: AssetKind = BRANDING_IMAGE_SLOTS[slot];
      const asset = await apiRequest('/api/admin/assets', AssetSummarySchema, { method: 'POST', body: { kind, data } });
      setDraft((d) => ({ ...d, [slot]: asset.id }));
      onAssetsChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  const save = async (): Promise<void> => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await apiRequest('/api/admin/branding', BrandingResponseSchema, { method: 'PUT', body: draft });
      setBase(res.branding);
      setDraft(res.branding);
      setDone('Grafica salvata: la pagina pubblica la usa da subito.');
      // The reserved area of the same client shows it at once too.
      void initBranding({ fresh: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    setDone(null);
    setDeleting(id);
    try {
      await apiCommand(`/api/admin/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setDraft((d) => {
        const next = { ...d };
        for (const slot of SLOTS) if (next[slot] === id) next[slot] = null;
        return next;
      });
      onAssetsChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  };

  const name = draft.displayName ?? tenantName;
  const preview = (
    <BrandingPreview
      template={draft.template}
      colors={draft.colors}
      name={name}
      logoMain={draft.logoMain ? publicAssetPath(draft.logoMain) : null}
      logoMark={draft.logoMark ? publicAssetPath(draft.logoMark) : null}
      sponsorLogo={draft.sponsorLogo ? publicAssetPath(draft.sponsorLogo) : null}
    />
  );
  return (
    <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-4">
        <Card title="Grafica del cliente" subtitle={`Cliente: ${tenantName}`}>
          <div className="space-y-4">
            <Field label="Nome visualizzato" hint="Facoltativo: titolo delle pagine e testata senza logo.">
              <input
                type="text"
                value={draft.displayName ?? ''}
                maxLength={100}
                placeholder={tenantName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, displayName: e.target.value.trim() ? e.target.value : null }))
                }
                className={inputClass}
              />
            </Field>
            <TemplatePicker value={draft.template} onChange={(t) => setDraft((d) => ({ ...d, template: t }))} />
            <OurTeamFields value={draft.ourTeam} onChange={(t) => setDraft((d) => ({ ...d, ourTeam: t }))} />
            <p className="text-xs text-muted">
              I colori scelti qui vanno sopra quelli del modello; vuoti: i colori del modello.{' '}
              {template.ourColor === 'accent'
                ? 'Nostra squadra: il colore di risalto; avversaria: il colore della squadra ospite.'
                : 'Nostra squadra: il colore della squadra di casa; avversaria: il colore della squadra ospite.'}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {BRAND_COLOR_KEYS.map((key) => (
                <ColorField
                  key={key}
                  name={key}
                  value={draft.colors[key]}
                  fallback={template.colors[key]}
                  onChange={(v) => setColor(key, v)}
                />
              ))}
            </div>
            {issues.length > 0 && (
              <ul role="status" className="space-y-1 rounded-card border border-warn bg-surface-2 px-3 py-2 text-sm">
                {issues.map((issue) => (
                  <li key={issue.color} className="text-text">
                    {contrastText(issue)}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              {SLOTS.map((slot) => (
                <ImageField
                  key={slot}
                  slot={slot}
                  assetId={draft[slot]}
                  asset={draft[slot] ? byId.get(draft[slot]) : undefined}
                  busy={uploading === slot}
                  onUpload={(s, f) => void upload(s, f)}
                  onClear={(s) => setDraft((d) => ({ ...d, [s]: null }))}
                />
              ))}
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            {done && (
              <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
                {done}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
                {busy ? 'Salvataggio…' : 'Salva'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setDraft(defaultBranding());
                  setDone(null);
                }}
              >
                Ripristina predefiniti
              </Button>
              {dirty && <span className="text-xs text-muted">Modifiche non salvate.</span>}
            </div>
          </div>
        </Card>
        <Card
          title="Immagini caricate"
          subtitle={`Spazio usato: ${megabytes(assets.usedBytes)} MB di ${megabytes(assets.quotaBytes)} MB`}
        >
          {assets.assets.length === 0 ? (
            <Empty>Nessuna immagine caricata.</Empty>
          ) : (
            <ul className="divide-y divide-grid">
              {assets.assets.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <img src={a.url} alt="" className="size-10 rounded object-contain" />
                  <span className="min-w-0 flex-1 text-sm text-text">
                    {a.kind === 'logo' ? 'Logo' : 'Sponsor'} · {a.width}×{a.height} px · {megabytes(a.bytes)} MB
                    {usedIds.has(a.id) && <span className="text-muted"> · in uso</span>}
                  </span>
                  <ConfirmButton
                    label="Elimina"
                    confirmLabel="Conferma eliminazione"
                    busy={deleting === a.id}
                    onConfirm={() => void remove(a.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <PreviewDock
        subtitle="Pagina pubblica con dati d’esempio, con le modifiche non ancora salvate."
        fullscreen={<ZoomToFit>{preview}</ZoomToFit>}
      >
        {preview}
      </PreviewDock>
    </div>
  );
}

/** Width and height (CSS px) the example page of the preview has at zoom 1: the full screen view scales from them. */
const PREVIEW_BASE = { width: 460, height: 400 };

/** Centres `children` in the room of the parent, enlarged (CSS `zoom`) as much as fits, never smaller than 1. */
function ZoomToFit({ children }: { children: ReactNode }) {
  const area = useRef<HTMLDivElement>(null);
  const room = useElementSize(area);
  const zoom =
    room.width > 0 ? Math.max(1, Math.min(room.width / PREVIEW_BASE.width, room.height / PREVIEW_BASE.height)) : 1;
  return (
    <div ref={area} className="flex h-full w-full items-center justify-center overflow-auto">
      <div style={{ width: PREVIEW_BASE.width, zoom }} data-testid="anteprima-grafica-ingrandita">
        {children}
      </div>
    </div>
  );
}

/** Page «Grafica» (admin): colours and logos of the client of the session, shown by hostname on its portal. */
export function BrandingPage() {
  const errorMessage = useApiError();
  const loadBranding = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/branding', BrandingResponseSchema, { signal }),
    [],
  );
  const loadAssets = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const branding = useAsync(loadBranding);
  const assets = useAsync(loadAssets);

  useEffect(() => {
    document.title = 'Grafica · Area riservata';
  }, []);

  if (branding.error !== null) return <ErrorBox onRetry={branding.reload}>{errorMessage(branding.error)}</ErrorBox>;
  if (assets.error !== null && !assets.data)
    return <ErrorBox onRetry={assets.reload}>{errorMessage(assets.error)}</ErrorBox>;
  if (!branding.data || !assets.data) return <Spinner label="Caricamento della grafica…" />;
  return (
    <BrandingEditor
      tenantName={branding.data.tenantName}
      saved={branding.data.branding}
      assets={assets.data}
      onAssetsChanged={assets.reload}
    />
  );
}
