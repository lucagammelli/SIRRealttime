import { useEffect, useMemo, useState } from 'react';
import { LiveScreen } from '../components/LiveScreen.tsx';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { TvCanvas } from '../components/TvCanvas.tsx';
import { displayAuthMessage, readDisplayToken, sessionStorageOrNull } from '../lib/displayToken.ts';
import { useIdle, useTvRootClass, useWakeLock } from '../lib/tvScreen.ts';
import { socketUrl, useLiveSocket } from '../lib/useLiveSocket.ts';

/** A player with an invalid token tries again this often (the admin may download a new configuration). */
export const DISPLAY_INVALID_RETRY_MS = 60_000;
/** Wait between the `ack` of a reload and the reload (the frame leaves before the page goes). */
export const DISPLAY_RELOAD_DELAY_MS = 500;

/** Title of the screen of a player without a valid token. */
export const DISPLAY_INVALID_TITLE = 'Player non valido';
export const DISPLAY_INVALID_TEXT = 'Scarica di nuovo la configurazione dal portale e copiala sulla scheda SD.';

/**
 * Page `/schermo#<token>` of a player (Raspberry Pi of a big screen, Chromium in kiosk mode): always the big screen
 * on the fixed canvas, nothing to tap (no buttons, no «Ferma rotazione»), pointer hidden, screen kept on. The token
 * is read from the fragment (then removed from the address and kept in `sessionStorage` for the reloads) and sent as
 * the first message of `/ws/display`; the server decides what to show (`standby`: the waiting screen) and can ask a
 * reload. Network down: the last state stays and the connection comes back by itself; an invalid token is tried
 * again every minute.
 */
export function DisplayPage() {
  const [token] = useState(() => readDisplayToken(window.location.hash, sessionStorageOrNull()));
  useEffect(() => {
    if (window.location.hash === '') return;
    // The token does not stay in the address bar (nor in the history).
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }, []);
  useTvRootClass(true);
  useWakeLock(true);
  const idle = useIdle(true);
  const hello = useMemo(() => (token ? () => displayAuthMessage(token) : undefined), [token]);
  const display = useMemo(
    () => ({ onReload: () => setTimeout(() => window.location.reload(), DISPLAY_RELOAD_DELAY_MS) }),
    [],
  );
  const received = useLiveSocket(token ? socketUrl('/ws/display') : null, {
    ...(hello ? { hello } : {}),
    display,
    retryInvalidMs: DISPLAY_INVALID_RETRY_MS,
  });

  const invalid = token === null || received.status === 'invalid' || received.status === 'unauthorized';
  return (
    <TvCanvas>
      {invalid ? (
        <div className={`flex h-full items-center justify-center ${idle ? 'cursor-none' : ''}`}>
          <StatusScreen title={DISPLAY_INVALID_TITLE} tone="error">
            {DISPLAY_INVALID_TEXT}
          </StatusScreen>
        </div>
      ) : (
        <LiveScreen
          received={received}
          device="tv"
          idle={idle}
          touch={false}
          rotationPaused={false}
          onTogglePaused={() => undefined}
        />
      )}
    </TvCanvas>
  );
}
