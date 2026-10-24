import type { ClubSide, ScheduleResponse, TeamLogoPair, TenantLayout } from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import type { ReactNode } from 'react';
import type { BlockBrand } from '../blocks/env.ts';
import { renderLayoutBlock } from '../blocks/registry.tsx';
import { useOurTeamColors, useTemplate } from '../lib/branding.ts';
import type { Device, LayoutBlock } from '../lib/layout.ts';
import { blocksFor } from '../lib/layout.ts';
import { hasScheduleData, isScheduleType, useSchedule } from '../lib/schedule.ts';
import { TouchContext, useDevice } from '../lib/useLayout.ts';
import { BlockLayout } from './BlockLayout.tsx';

/**
 * Whole match page, shared by the public link, the reserved area and the preview of the editor: the visible blocks
 * of `layout` (the page chosen by the client; missing: the default page of the template of the client) for the device,
 * drawn by the block registry. While it is on screen the team of the client («nostra squadra», chosen in «Grafica»)
 * takes its colour in every view, whatever its side in the file.
 * Without `device` it follows the width of the window, at most as a tablet (the reserved area never rotates screens).
 * `brand`: logo of the client in the scoreboard (big screen of the public page).
 */
export function MatchView({
  state,
  status,
  device,
  brand = false,
  layout,
  look = null,
  pageUrl,
  rotationPaused = false,
  schedule,
  logos,
  ourSide,
}: {
  state: MatchState;
  status?: ReactNode;
  device?: Device;
  brand?: boolean;
  layout?: TenantLayout | null;
  /** Graphics of the client for the logo and QR blocks. */
  look?: BlockBrand | null;
  /** Address encoded by the QR block (default: the address of the page). */
  pageUrl?: string;
  /** Big screen: rotation of the groups (and of the sponsor images) stopped by the viewer. */
  rotationPaused?: boolean;
  /** Matches and standings of the club (the editor passes an example); missing: read from the server when needed. */
  schedule?: ScheduleResponse | null;
  /** Logos of the teams for the scoreboard (public messages); missing: none. */
  logos?: TeamLogoPair;
  /** Side of our team chosen by the server (public messages): it comes before «nostra squadra»; missing: unknown. */
  ourSide?: ClubSide;
}) {
  const auto = useDevice();
  const used: Device = device ?? (auto === 'tv' ? 'tablet' : auto);
  const template = useTemplate();
  useOurTeamColors(state.teams, ourSide ?? null);
  const all = blocksFor(layout, used, template.id);
  // The schedule is asked for only by a page that has «Prossima partita» or «Classifica»; read again at every set.
  const fetched = useSchedule(
    schedule === undefined && all.some((b) => isScheduleType(b.type)),
    `${state.status}:${state.setsWon.home}-${state.setsWon.away}`,
  );
  const data = schedule === undefined ? fetched : schedule;
  // A block without data (no club, nothing to show yet) is left out, not an empty card.
  const blocks = all.filter((b) => hasScheduleData(b.type, data));

  const renderBlock = (block: LayoutBlock): ReactNode =>
    renderLayoutBlock(block, {
      state,
      status,
      device: used,
      brandInScoreboard: brand,
      brand: look,
      paused: rotationPaused,
      schedule: data,
      ...(pageUrl === undefined ? {} : { pageUrl }),
      ...(logos ? { logos } : {}),
    });

  return (
    <TouchContext.Provider value={layout?.touch[used] ?? true}>
      <BlockLayout
        blocks={blocks}
        device={used}
        renderBlock={renderBlock}
        rotationPaused={rotationPaused}
        measureReset={`${state.status}:${state.setsWon.home}-${state.setsWon.away}`}
      />
    </TouchContext.Provider>
  );
}
