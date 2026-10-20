import { useAuth } from '../pages/admin/auth.tsx';

/** Note of the pages when the client has no links of single matches. */
export const MATCH_LINKS_OFF_TEXT = 'Link per singola partita non attivi: usa il canale del club.';

/**
 * Whether the client of the session has «Link e QR per singola partita» (given by the superadmin): the links and QR of
 * the matches of the calendar and «Una partita fissa». Off: only the channel of the club with its QR.
 */
export function useMatchLinks(): boolean {
  return useAuth().user.tenant?.matchLinksEnabled ?? false;
}
