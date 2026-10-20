import type {
  AssetListResponse,
  BlockType,
  BrandColorKey,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
} from '@sir/shared';
import { LAYOUT_DEVICES, templateOf } from '@sir/shared';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { BLOCKS } from '../../../blocks/registry.tsx';
import { Button, ErrorBox } from '../../../components/ui.tsx';
import { useModalDialog } from '../../../components/useModalDialog.ts';
import { useApiError } from '../auth.tsx';
import { Field, inputClass } from '../forms.tsx';
import { IMAGE_TOO_LARGE, uploadImage } from '../imageUpload.ts';
import { ColorField, ImageField, OurTeamFields, withColor } from './ColorsSection.tsx';
import type { StudioScene } from './model.ts';
import { activePauseModel, applyPauseModel, PAUSE_MODEL_LABELS } from './model.ts';
import { ModelPicker, SwitchRow } from './StudioUi.tsx';

export const WIZARD_STEPS: readonly { title: string; lead: string; scene: StudioScene }[] = [
  {
    title: 'Logo e colori',
    lead: 'Scegli i colori e il logo della società. Si vedono subito a destra.',
    scene: 'play',
  },
  {
    title: 'La tua squadra',
    lead: 'Come riconoscere la tua squadra nei file e i colori delle due squadre.',
    scene: 'play',
  },
  { title: 'La pagina', lead: 'Quali blocchi mostrare durante la partita, su TV, tablet e telefono.', scene: 'play' },
  { title: 'Le pause', lead: 'Scegli un modello: potrai cambiarlo quando vuoi.', scene: 'setBreak' },
];

/** Pure: the block types of the page (any device), in the order of their first appearance. */
export function pageBlockTypes(layout: TenantLayout): BlockType[] {
  const seen: BlockType[] = [];
  for (const device of LAYOUT_DEVICES) for (const b of layout[device]) if (!seen.includes(b.type)) seen.push(b.type);
  return seen;
}

/** Pure: a block type visible (or hidden) on every device; visible when it is visible on at least one. */
export const typeVisible = (layout: TenantLayout, type: BlockType): boolean =>
  LAYOUT_DEVICES.some((d) => layout[d].some((b) => b.type === type && b.visible));

export function withTypeVisible(layout: TenantLayout, type: BlockType, visible: boolean): TenantLayout {
  const next = { ...layout };
  for (const device of LAYOUT_DEVICES)
    next[device] = layout[device].map((b) => (b.type === type ? { ...b, visible } : b));
  return next;
}

/**
 * Guided setup in four steps (logo and colours, team, page, pauses), with the preview of the TV beside it. It edits
 * the drafts of the sections; «Fine e salva» saves the sections changed, «Chiudi» keeps the changes unsaved.
 */
export function StudioWizard({
  tenantName,
  branding,
  layout,
  intermissions,
  onBranding,
  onLayout,
  onIntermissions,
  assets,
  onAssetsChanged,
  preview,
  busy,
  error,
  onClose,
  onFinish,
}: {
  tenantName: string;
  branding: TenantBranding;
  layout: TenantLayout;
  intermissions: TenantIntermissions;
  onBranding: (change: (b: TenantBranding) => TenantBranding) => void;
  onLayout: (change: (l: TenantLayout) => TenantLayout) => void;
  onIntermissions: (change: (c: TenantIntermissions) => TenantIntermissions) => void;
  assets: AssetListResponse;
  onAssetsChanged: () => void;
  /** Preview of a scene (TV). */
  preview: (scene: StudioScene) => ReactNode;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onFinish: () => void;
}) {
  const errorMessage = useApiError();
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const titleId = useId();
  const current = WIZARD_STEPS[step] ?? { title: '', lead: '', scene: 'play' as const };
  const last = step === WIZARD_STEPS.length - 1;
  const template = templateOf(branding.template);

  const { root, trap } = useModalDialog(onClose);

  const color = (key: BrandColorKey) => (
    <ColorField
      key={key}
      name={key}
      value={branding.colors[key]}
      fallback={template.colors[key]}
      onChange={(v) => onBranding((b) => withColor(b, key, v))}
    />
  );

  const uploadLogo = async (file: File): Promise<void> => {
    setUploadError(null);
    setUploading(true);
    try {
      const asset = await uploadImage(file, 'logo');
      if (!asset) setUploadError(IMAGE_TOO_LARGE);
      else {
        onBranding((b) => ({ ...b, logoMain: asset.id }));
        onAssetsChanged();
      }
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  let body: ReactNode;
  if (step === 0)
    body = (
      <div className="space-y-4">
        {color('primary')}
        {color('accent')}
        {color('background')}
        <ImageField
          slot="logoMain"
          assetId={branding.logoMain}
          asset={assets.assets.find((a) => a.id === branding.logoMain)}
          busy={uploading}
          onUpload={(_s, f) => void uploadLogo(f)}
          onClear={() => onBranding((b) => ({ ...b, logoMain: null }))}
        />
        {uploadError && <ErrorBox>{uploadError}</ErrorBox>}
        <Field label="Nome visualizzato" hint="Facoltativo: titolo delle pagine e testata senza logo.">
          <input
            type="text"
            value={branding.displayName ?? ''}
            maxLength={100}
            placeholder={tenantName}
            onChange={(e) => onBranding((b) => ({ ...b, displayName: e.target.value.trim() ? e.target.value : null }))}
            className={inputClass}
          />
        </Field>
      </div>
    );
  else if (step === 1)
    body = (
      <div className="space-y-4">
        <OurTeamFields value={branding.ourTeam} onChange={(t) => onBranding((b) => ({ ...b, ourTeam: t }))} />
        {color('home')}
        {color('away')}
      </div>
    );
  else if (step === 2)
    body = (
      <div className="space-y-1">
        {pageBlockTypes(layout).map((type) => (
          <SwitchRow
            key={type}
            label={BLOCKS[type].label}
            ariaLabel={`Mostra: ${BLOCKS[type].label}`}
            checked={typeVisible(layout, type)}
            onChange={(on) => onLayout((l) => withTypeVisible(l, type, on))}
          />
        ))}
        <p className="pt-2 text-xs text-muted">Ordine, larghezze e altri blocchi: in «Pagina live».</p>
      </div>
    );
  else
    body = (
      <div className="space-y-3">
        <ModelPicker
          labels={PAUSE_MODEL_LABELS}
          active={activePauseModel(intermissions)}
          onApply={(m) => onIntermissions((c) => applyPauseModel(c, m))}
        />
        <SwitchRow
          label="Pausa a fine set"
          checked={intermissions.setBreak.enabled}
          onChange={(on) => onIntermissions((c) => ({ ...c, setBreak: { ...c.setBreak, enabled: on } }))}
        />
        <p className="text-xs text-muted">Sul telefono la pausa di fine set è una banda in basso.</p>
      </div>
    );

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 p-2 sm:p-4">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trap}
        className="grid h-full max-h-[44rem] w-full max-w-6xl overflow-hidden rounded-panel border border-border bg-surface shadow-card md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 flex-col p-5">
          <div className="mb-4 flex gap-1.5" aria-hidden="true">
            {WIZARD_STEPS.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-surface-2'}`}
              />
            ))}
          </div>
          <p className="text-xs text-muted">
            Passo {step + 1} di {WIZARD_STEPS.length}
          </p>
          <h2 id={titleId} tabIndex={-1} className="text-xl font-semibold text-text outline-none">
            {current.title}
          </h2>
          <p className="mb-3 text-sm text-muted">{current.lead}</p>
          <div className="sir-thin-scroll min-h-0 flex-1 overflow-y-auto pr-1">{body}</div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex items-center justify-between gap-2 pt-4">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Indietro
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Chiudi
            </Button>
            {last ? (
              <Button variant="primary" disabled={busy} onClick={onFinish}>
                {busy ? 'Salvataggio…' : 'Fine e salva'}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                Avanti
              </Button>
            )}
          </div>
        </div>
        <div className="hidden min-h-0 border-l border-border bg-bg md:block">{preview(current.scene)}</div>
      </div>
    </div>
  );
}
