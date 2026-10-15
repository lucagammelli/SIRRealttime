import type { MatchState } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import type { Device } from '../lib/layout.ts';

/** Graphics of the client used by the blocks (logo block, QR logo). */
export interface BlockBrand {
  name: string;
  logoMain: string | null;
  logoMark: string | null;
}

/** What every block of the match page can read besides its own options. */
export interface BlockEnv {
  state: MatchState;
  device: Device;
  /** Connection badge and buttons, shown in the scoreboard. */
  status?: ReactNode;
  /** Logo of the client in the scoreboard (big screen of the public page). */
  brandInScoreboard: boolean;
  /** Graphics of the client; null: the portal defaults. */
  brand: BlockBrand | null;
  /** Address of the page for the QR block (default: the address in the browser bar). */
  pageUrl?: string;
  /** Automatic changes stopped by the viewer (big screen): the sponsor images do not rotate either. */
  paused: boolean;
}
