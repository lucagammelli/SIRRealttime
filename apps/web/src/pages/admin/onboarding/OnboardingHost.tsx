import type { MeResponse } from '@sir/shared';
import { OnboardingStatusSchema } from '@sir/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonClass } from '../../../components/ui.tsx';
import { apiRequest } from '../../../lib/api.ts';
import { useAsync } from '../../../lib/useAsync.ts';
import type { OnboardingStep } from './model.ts';
import {
  noticeFor,
  ONBOARDING_STEPS,
  opensByItself,
  readSession,
  reachedKey,
  skippedKey,
  writeSession,
} from './model.ts';
import { OnboardingWizard } from './OnboardingWizard.tsx';

const isStep = (value: string | null): value is OnboardingStep => ONBOARDING_STEPS.some((s) => s.id === value);

/**
 * The guided first setup in the reserved area of a client: opens by itself to the first admin («Lettura e scrittura»)
 * while the client is not configured (`tenants.onboarded_at` is empty), and until then shows the notice «Configurazione
 * da completare» above the pages. A viewer sees nothing; the superadmin inside a client only a link to open it.
 */
export function OnboardingHost({ tenantId, role }: { tenantId: string; role: MeResponse['role'] }) {
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/onboarding', OnboardingStatusSchema, { signal }),
    [],
  );
  const status = useAsync(load);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  // A status that cannot be read shows nothing: the procedure never gets in the way of the pages.
  const completed = done || status.data === null || status.data.completed;

  useEffect(() => {
    if (opened.current || status.data === null) return;
    opened.current = true;
    if (opensByItself({ role, completed: status.data.completed, skipped: readSession(skippedKey(tenantId)) === '1' }))
      setOpen(true);
  }, [status.data, role, tenantId]);

  const skip = useCallback(() => {
    writeSession(skippedKey(tenantId), '1');
    setOpen(false);
  }, [tenantId]);
  const onReach = useCallback((step: OnboardingStep) => writeSession(reachedKey(tenantId), step), [tenantId]);
  const finish = useCallback(async () => {
    await apiRequest('/api/admin/onboarding/complete', OnboardingStatusSchema, { method: 'POST', body: {} });
    setDone(true);
    setOpen(false);
  }, []);

  const notice = noticeFor({ role, completed });
  const reached = readSession(reachedKey(tenantId));
  return (
    <>
      {notice && !open && (
        <section
          aria-label="Configurazione da completare"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">Configurazione da completare</p>
            <p className="text-xs text-muted">
              Logo, squadra, colori e grafica: pochi passi e il portale è pronto per la prima partita.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/guida" className={buttonClass()}>
              Guida
            </Link>
            <Button variant="primary" onClick={() => setOpen(true)}>
              {notice === 'resume' ? 'Riprendi' : 'Apri la configurazione guidata'}
            </Button>
          </div>
        </section>
      )}
      {open && (
        <OnboardingWizard
          initialStep={null}
          reached={isStep(reached) ? reached : null}
          onReach={onReach}
          onSkip={skip}
          onFinish={finish}
        />
      )}
    </>
  );
}
