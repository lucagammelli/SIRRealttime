import type { ClubResponse, TenantBranding, TenantIntermissions, TenantOverlays } from '@arenalive/shared';
import {
  BrandingResponseSchema,
  ClubResponseSchema,
  IntermissionsResponseSchema,
  OverlaysResponseSchema,
} from '@arenalive/shared';
import type { ReactNode } from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import { Button, ErrorBox, Spinner } from '../../../components/ui.tsx';
import { useModalDialog } from '../../../components/useModalDialog.ts';
import { apiRequest } from '../../../lib/api.ts';
import { useAsync } from '../../../lib/useAsync.ts';
import { useApiError } from '../auth.tsx';
import type { StudioScene } from '../studio/model.ts';
import { brandingWithClub, laterStep, ONBOARDING_STEPS, resumeStep, stepIndex } from './model.ts';
import type { OnboardingStep } from './model.ts';
import { OnboardingPreview } from './OnboardingPreview.tsx';
import type { StepProps, WizardData } from './steps.tsx';
import { ColorsStep, DoneStep, GraphicsStep, LogoStep, TeamStep } from './steps.tsx';

const SCENES: Record<OnboardingStep, StudioScene> = {
  logo: 'play',
  squadra: 'play',
  colori: 'play',
  grafica: 'setBreak',
  fatto: 'play',
};

/** Everything the procedure needs, read together (the saved data tell where to resume). */
async function loadAll(signal: AbortSignal): Promise<WizardData> {
  const [club, branding, intermissions, overlays] = await Promise.all([
    apiRequest('/api/admin/club', ClubResponseSchema, { signal }),
    apiRequest('/api/admin/branding', BrandingResponseSchema, { signal }),
    apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, { signal }),
    apiRequest('/api/admin/overlays', OverlaysResponseSchema, { signal }),
  ]);
  return {
    tenantName: branding.tenantName,
    club,
    branding: branding.branding,
    intermissions: intermissions.intermissions,
    overlays: overlays.overlays,
  };
}

/**
 * Guided first setup in five steps (logo, team, colours, graphics, done), with the preview of the public page beside
 * it. Every step saves when «Avanti» is pressed (the logos at once): the procedure can be closed and resumed from the
 * right step. «Salta per ora» closes it; «Fine» marks the client as configured.
 */
export function OnboardingWizard({
  initialStep,
  reached,
  onReach,
  onSkip,
  onFinish,
}: {
  /** Step asked by the notice (null: the one the saved data tell). */
  initialStep: OnboardingStep | null;
  /** Last step reached in this session. */
  reached: OnboardingStep | null;
  onReach: (step: OnboardingStep) => void;
  onSkip: () => void;
  /** «Fine»: marks the setup as done (rejects with the error to show). */
  onFinish: () => Promise<void>;
}) {
  const load = useCallback((signal: AbortSignal) => loadAll(signal), []);
  const loaded = useAsync(load);
  const errorMessage = useApiError();
  const { root, trap } = useModalDialog(onSkip);
  const titleId = useId();
  let content: ReactNode;
  if (loaded.error !== null) content = <ErrorBox onRetry={loaded.reload}>{errorMessage(loaded.error)}</ErrorBox>;
  else if (!loaded.data) content = <Spinner label="Caricamento della configurazione…" />;
  else
    content = (
      <Steps
        key="steps"
        initial={loaded.data}
        initialStep={initialStep ?? laterStep(reached ?? 'logo', resumeStep(loaded.data))}
        titleId={titleId}
        onReach={onReach}
        onSkip={onSkip}
        onFinish={onFinish}
      />
    );
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 p-2 sm:p-4">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trap}
        className="flex h-full max-h-[46rem] w-full max-w-6xl overflow-hidden rounded-panel border border-border bg-surface shadow-card"
      >
        {content}
      </div>
    </div>
  );
}

function Steps({
  initial,
  initialStep,
  titleId,
  onReach,
  onSkip,
  onFinish,
}: {
  initial: WizardData;
  initialStep: OnboardingStep;
  titleId: string;
  onReach: (step: OnboardingStep) => void;
  onSkip: () => void;
  onFinish: () => Promise<void>;
}) {
  const errorMessage = useApiError();
  const [data, setData] = useState<WizardData>(initial);
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const index = stepIndex(step);
  const current = ONBOARDING_STEPS[index] ?? ONBOARDING_STEPS[0];
  const last = step === 'fatto';

  const props: StepProps = {
    data,
    saveRef,
    onLeave: onSkip,
    onClub: (club: ClubResponse) => setData((d) => ({ ...d, club, branding: brandingWithClub(d.branding, club) })),
    onBranding: (branding: TenantBranding) => setData((d) => ({ ...d, branding })),
    onIntermissions: (intermissions: TenantIntermissions) => setData((d) => ({ ...d, intermissions })),
    onOverlays: (overlays: TenantOverlays) => setData((d) => ({ ...d, overlays })),
  };

  const go = (to: OnboardingStep): void => {
    setError(null);
    setStep(to);
    onReach(to);
  };

  const next = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!((await saveRef.current?.()) ?? true)) return;
      const to = ONBOARDING_STEPS[index + 1];
      if (to) go(to.id);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onFinish();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (step === 'logo') body = <LogoStep {...props} />;
  else if (step === 'squadra') body = <TeamStep {...props} />;
  else if (step === 'colori') body = <ColorsStep {...props} />;
  else if (step === 'grafica') body = <GraphicsStep {...props} />;
  else body = <DoneStep {...props} />;

  return (
    <div className="grid min-h-0 w-full grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] md:overflow-hidden">
      <div className="flex min-h-0 flex-col p-5">
        <div className="mb-4 flex gap-1.5" aria-hidden="true">
          {ONBOARDING_STEPS.map((s, i) => (
            <span key={s.id} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-surface-2'}`} />
          ))}
        </div>
        <p className="text-xs text-muted">
          Passo {index + 1} di {ONBOARDING_STEPS.length}
        </p>
        <h2 id={titleId} tabIndex={-1} className="text-xl font-semibold text-text outline-none">
          {current.title}
        </h2>
        <p className="mb-3 text-sm text-muted">{current.lead}</p>
        <div className="sir-thin-scroll min-h-0 flex-1 overflow-y-auto pr-1">{body}</div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
          <Button
            variant="ghost"
            disabled={index === 0 || busy}
            onClick={() => go(ONBOARDING_STEPS[index - 1]?.id ?? 'logo')}
          >
            Indietro
          </Button>
          <Button variant="ghost" onClick={onSkip}>
            Salta per ora
          </Button>
          {last ? (
            <Button variant="primary" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Salvataggio…' : 'Fine'}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void next()}>
              {busy ? 'Salvataggio…' : 'Avanti'}
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-[18rem] border-t border-border bg-bg md:min-h-0 md:border-l md:border-t-0">
        {step === 'fatto' ? null : (
          <OnboardingPreview
            tenantName={data.tenantName}
            branding={data.branding}
            intermissions={data.intermissions}
            overlays={data.overlays}
            scene={SCENES[step]}
            devices={step === 'grafica' || step === 'colori' ? ['tv', 'phone'] : ['tv']}
          />
        )}
      </div>
    </div>
  );
}
