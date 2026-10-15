import type { MatchState } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import type { Device, LayoutBlock } from '../lib/layout.ts';
import { defaultLayouts } from '../lib/layout.ts';
import { useDevice } from '../lib/useLayout.ts';
import { BlockLayout } from './BlockLayout.tsx';
import { CourtMap } from './CourtMap.tsx';
import { MomentumChart } from './MomentumChart.tsx';
import { PlayerTable } from './PlayerTable.tsx';
import { Rotations } from './Rotations.tsx';
import { Scoreboard } from './Scoreboard.tsx';
import { TeamComparison } from './TeamComparison.tsx';

/** On the big screen every card fills its cell and never grows it. */
const TV_CARD = 'h-full min-h-0 overflow-hidden';

/**
 * Whole match page, shared by the public link and the reserved area: the blocks of `defaultLayouts` for the device.
 * Without `device` it follows the width of the window, at most as a tablet (the reserved area never rotates screens).
 * `brand`: logo of the client in the scoreboard (big screen of the public page).
 */
export function MatchView({
  state,
  status,
  device,
  brand = false,
  layout,
  rotationPaused = false,
}: {
  state: MatchState;
  status?: ReactNode;
  device?: Device;
  brand?: boolean;
  layout?: readonly LayoutBlock[];
  /** Big screen: rotation of the groups stopped by the viewer. */
  rotationPaused?: boolean;
}) {
  const auto = useDevice();
  const used: Device = device ?? (auto === 'tv' ? 'tablet' : auto);
  const tv = used === 'tv';

  const renderBlock = (block: LayoutBlock): ReactNode => {
    switch (block.type) {
      case 'scoreboard':
        return <Scoreboard state={state} status={status} device={used} brand={brand && tv} />;
      case 'momentum':
        return tv ? (
          <MomentumChart state={state} className={TV_CARD} chartClassName="min-h-0 flex-1" />
        ) : (
          <MomentumChart state={state} className="h-full" />
        );
      case 'comparison':
        return <TeamComparison state={state} compact={tv} className={tv ? TV_CARD : 'h-full'} />;
      case 'players':
        return <PlayerTable state={state} className={tv ? TV_CARD : ''} />;
      case 'court':
        return <CourtMap state={state} className={tv ? TV_CARD : 'h-full'} />;
      case 'rotations':
        return tv ? (
          <Rotations state={state} className={TV_CARD} chartClassName="h-[min(28vh,14rem)]" />
        ) : (
          <Rotations state={state} className="h-full" />
        );
    }
  };

  return (
    <BlockLayout
      blocks={layout ?? defaultLayouts[used]}
      device={used}
      renderBlock={renderBlock}
      rotationPaused={rotationPaused}
    />
  );
}
