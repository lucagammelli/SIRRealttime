import { hasSystemLogo, publicAssetPath } from '@arenalive/shared';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useAfterMatchImage } from '../lib/afterMatch.ts';
import {
  useBrandName,
  useTemplate,
  useTenantIntermissions,
  useTenantLook,
  useTenantOverlays,
} from '../lib/branding.ts';
import { teamName } from '../lib/format.ts';
import type { Device } from '../lib/layout.ts';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { usePointSequence } from '../lib/pointSequence.ts';
import { nextFixture, useSchedule } from '../lib/schedule.ts';
import { useSystemLogos } from '../lib/systemLogos.ts';
import { TouchContext } from '../lib/useLayout.ts';
import { afterMatchFile, AfterMatchScreen } from './AfterMatchScreen.tsx';
import { BrandMark } from './BrandMark.tsx';
import { Intermission } from './Intermission.tsx';
import { LiveMatch, screensFor } from './LiveMatch.tsx';
import { Overlay } from './Overlay.tsx';
import { SystemLogosBar } from './SystemLogosBar.tsx';

/**
 * What a live socket shows, on the public page (`LivePage`) and on the page of a player (`DisplayPage`): header,
 * match (`LiveMatch`), overlays, pauses and «Dopo la partita», with the graphics of the client of the hostname.
 * Several new points in one update are shown one at a time (`usePointSequence`). `controls`: the buttons of the page,
 * drawn only when the client allows touch on the device; `touch` false: nothing can be tapped whatever the client
 * chose (a player). `idle`: the pointer is hidden. `extra`: drawn after the match (the hint of the full screen).
 */
export function LiveScreen({
  received,
  device,
  idle,
  controls = null,
  touch: allowTouch = true,
  rotationPaused,
  onTogglePaused,
  extra = null,
}: {
  received: LiveSnapshot;
  device: Device;
  idle: boolean;
  controls?: ReactNode;
  touch?: boolean;
  rotationPaused: boolean;
  onTogglePaused: () => void;
  extra?: ReactNode;
}) {
  const tv = device === 'tv';
  // Several new points in one update are shown one at a time (scoreboard, momentum, last point, overlays and pauses
  // all read the same state): only presentation, it always ends on the state of the server.
  const receivedData = received.data;
  const receivedMatch = receivedData?.kind === 'state' ? receivedData : null;
  const shownState = usePointSequence(
    receivedMatch?.state ?? null,
    receivedMatch?.live === true,
    receivedMatch?.matchId ?? '',
  );
  const snapshot = useMemo(
    () =>
      receivedData?.kind === 'state' && shownState !== null && shownState !== receivedData.state
        ? { ...received, data: { ...receivedData, state: shownState } }
        : received,
    [received, receivedData, shownState],
  );

  const data = snapshot.data;
  const brand = useBrandName();
  const look = useTenantLook();
  const intermissions = useTenantIntermissions();
  const overlays = useTenantOverlays();
  const template = useTemplate();
  const [pauseFullscreen, setPauseFullscreen] = useState(false);
  const afterMatchImage = useAfterMatchImage(data, intermissions?.afterMatch ?? null);
  // The schedule is read only while «Dopo la partita» is on screen (shared with the blocks that read it).
  const afterMatchFixture = nextFixture(useSchedule(afterMatchImage !== null));
  const blockBrand = useMemo(
    () =>
      look
        ? {
            name: look.name,
            logoMain: look.images.logoMain,
            logoMark: look.images.logoMark,
            sponsors: look.sponsors,
          }
        : null,
    [look],
  );
  useEffect(() => {
    if (data?.kind === 'state') {
      const s = data.state;
      document.title = `${teamName(s.teams, 'home')} ${s.setsWon.home}-${s.setsWon.away} ${teamName(s.teams, 'away')} · ${brand}`;
    } else if (data?.kind === 'scheduled') {
      const f = data.fixture;
      document.title = `${f.home.name} – ${f.away.name} · Prossima partita · ${brand}`;
    } else document.title = `${brand} · Diretta`;
  }, [data, brand]);

  // «Touch» of the device chosen by the client: without it nothing on the page can be tapped or clicked.
  const touch = allowTouch && (look?.layout.touch[device] ?? true);
  // Over the match (pauses, tables, maps) nothing can be tapped until the look is known: a device without touch must
  // never see a button, not even while it loads.
  const touchReady = look === null ? false : touch;
  // Screens without scrolling: the big screen only (the «Touch» option never changes the layout).
  const screens = screensFor(device);
  const shownControls = touch ? controls : null;
  // Big screen with a match: no page header, the logo and the buttons go in the scoreboard (one row less).
  const inScoreboard = tv && data?.kind === 'state';
  // With the bar of the system logos the brand is not repeated in the page header nor in the scoreboard.
  const systemLogos = useSystemLogos();
  const showBrand = !hasSystemLogo(systemLogos.left) && !hasSystemLogo(systemLogos.right);

  return (
    <TouchContext.Provider value={touchReady}>
      <div
        className={`${template.id === 'standard' ? 'border-t-4 border-accent' : ''} ${
          // Big screen: the page fills the fixed canvas (1920 × 1080), not the window.
          screens ? 'flex h-full w-full flex-col overflow-hidden p-3 lg:p-5' : 'flex min-h-dvh flex-col'
        } ${idle ? 'cursor-none' : ''}`}
        data-device={device}
      >
        {/* Logos of the platform (superadmin), above everything, also on the big screen; nothing without them. */}
        <SystemLogosBar className={screens ? 'shrink-0 pb-3' : 'sir-page mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5'} />
        {/* The waiting screen of a player is the logo of the client: no header with it again. */}
        {!inScoreboard && data?.kind !== 'standby' && (
          <header
            className={`sir-navbar flex shrink-0 items-center justify-between gap-3 ${screens ? 'pb-3' : 'sir-page mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5'}`}
          >
            {showBrand ? <BrandMark clubSize /> : <span />}
            {shownControls}
          </header>
        )}
        <main className={screens ? 'min-h-0 flex-1' : 'sir-page mx-auto w-full max-w-7xl flex-1 px-3 py-3 sm:px-5'}>
          <LiveMatch
            snapshot={snapshot}
            device={device}
            brand={inScoreboard && showBrand}
            rotationPaused={rotationPaused}
            layout={look?.layout ?? null}
            look={blockBrand}
            {...(inScoreboard && shownControls ? { controls: shownControls } : {})}
          />
        </main>
        {extra}
        {data?.kind === 'state' && (
          <Overlay
            key={`avvisi-${data.matchId}`}
            state={data.state}
            live={data.live === true}
            config={overlays}
            device={device}
            blocked={pauseFullscreen || afterMatchImage !== null}
          />
        )}
        {data?.kind === 'state' && afterMatchImage === null && (
          <Intermission
            key={data.matchId}
            onFullscreenChange={setPauseFullscreen}
            state={data.state}
            live={data.live === true}
            config={intermissions}
            device={device}
            paused={rotationPaused}
            onTogglePaused={onTogglePaused}
            look={blockBrand}
            sponsorLogo={look?.images.sponsorLogo ?? null}
          />
        )}
        {afterMatchImage !== null && intermissions && (
          <AfterMatchScreen
            file={afterMatchFile(intermissions.afterMatch, publicAssetPath(afterMatchImage))}
            fixture={afterMatchFixture}
            device={device}
          />
        )}
      </div>
    </TouchContext.Provider>
  );
}
