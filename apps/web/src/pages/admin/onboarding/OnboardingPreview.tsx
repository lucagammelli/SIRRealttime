import type { BrandingResponse, LayoutDevice, TenantBranding, TenantIntermissions, TenantOverlays } from '@sir/shared';
import { defaultLayout, publicAssetPath } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import { useEffect, useMemo, useState } from 'react';
import { loadSampleMatch } from '../../../blocks/sampleMatch.ts';
import { Segmented } from '../../../components/ui.tsx';
import { blockBrandOf } from '../studio/blockEditors.tsx';
import type { StudioScene } from '../studio/model.ts';
import { sampleWithOurTeam } from '../studio/model.ts';
import { StudioPreview } from '../studio/StudioPreview.tsx';

const NO_PICK = () => undefined;

/**
 * Preview of the guided setup: the real components of the public page (the one of the Studio) on an example match,
 * with the drafts of the colours and of the pauses. TV or phone, at the choice of the user.
 */
export function OnboardingPreview({
  tenantName,
  branding,
  intermissions,
  overlays,
  scene,
  devices = ['tv', 'phone'],
}: {
  tenantName: string;
  branding: TenantBranding;
  intermissions: TenantIntermissions;
  overlays: TenantOverlays;
  scene: StudioScene;
  devices?: readonly LayoutDevice[];
}) {
  const [device, setDevice] = useState<LayoutDevice>('tv');
  const [sample, setSample] = useState<MatchState | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSampleMatch().then((s) => {
      if (alive) setSample(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  const name = branding.displayName ?? tenantName;
  const state = useMemo(
    () => (sample ? sampleWithOurTeam(sample, branding.ourTeam, name) : null),
    [sample, branding.ourTeam, name],
  );
  const look = useMemo(() => blockBrandOf({ tenantName, branding } satisfies BrandingResponse), [tenantName, branding]);
  const docs = useMemo(
    () => ({ branding, layout: defaultLayout(branding.template), intermissions, overlays }),
    [branding, intermissions, overlays],
  );
  return (
    <div className="flex h-full min-h-[18rem] flex-col">
      {devices.length > 1 && (
        <div className="flex justify-center p-2">
          <Segmented
            label="Anteprima su"
            value={device}
            onChange={setDevice}
            options={devices.map((d) => ({ value: d, label: d === 'tv' ? 'TV' : 'Telefono' }))}
          />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <StudioPreview
          device={device}
          onDevice={setDevice}
          scene={scene}
          onScene={NO_PICK}
          state={state}
          live={false}
          docs={docs}
          look={look}
          sponsorLogo={branding.sponsorLogo ? publicAssetPath(branding.sponsorLogo) : null}
          pauseTarget="setBreak"
          overlayKind="ace"
          trial={null}
          highlight={null}
          onPick={NO_PICK}
          toolbar={false}
        />
      </div>
    </div>
  );
}
