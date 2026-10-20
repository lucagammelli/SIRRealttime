import type { PublicSponsor, ScheduleResponse, TeamLogoPair } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import type { Device } from '../lib/layout.ts';

/** Graphics of the client used by the blocks (logo block, QR logo). */
export interface BlockBrand {
  name: string;
  logoMain: string | null;
  logoMark: string | null;
  /** Sponsors chosen by the page or the pauses, in the order of the list of the client (missing: none). */
  sponsors?: readonly PublicSponsor[];
  /** Path of an image chosen by id in a block (missing: publicAssetPath; the previews of `/admin`: adminAssetPath). */
  assetPath?: (id: string) => string;
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
  /** Matches and standings of the club for «Prossima partita» and «Classifica»; null: not loaded (or no club). */
  schedule: ScheduleResponse | null;
  /** Automatic changes stopped by the viewer (big screen): the sponsor images do not rotate either. */
  paused: boolean;
  /** Logos of the teams next to their names in the scoreboard (from the server); missing: none. */
  logos?: TeamLogoPair;
}
