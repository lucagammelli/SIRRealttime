import type {
  ClubFixture,
  DisplayCommand,
  DisplaySummary,
  DisplayTarget,
  DisplayWifi,
  MatchSummary,
} from '@arenalive/shared';
import { DisplayWifiSchema } from '@arenalive/shared';
import { formatDateTime } from '../../lib/format.ts';
import { matchTitle } from './matchText.ts';
import { fixedChoices } from './ShareLinksPage.tsx';

/** A player is «In linea» when its last heartbeat (every 15 s) is younger than this. */
export const DISPLAY_ONLINE_MS = 60_000;

/** Pure: whether a player is connected now. */
export function displayOnline(d: Pick<DisplaySummary, 'lastSeenAt' | 'revoked'>, now: number): boolean {
  if (d.revoked || d.lastSeenAt === null) return false;
  const seen = Date.parse(d.lastSeenAt);
  return Number.isFinite(seen) && now - seen < DISPLAY_ONLINE_MS;
}

/** Pure: the state of a player in the list. */
export function displayStateText(
  d: Pick<DisplaySummary, 'lastSeenAt' | 'revoked' | 'configured'>,
  now: number,
): { text: string; className: string } {
  if (d.revoked) return { text: 'Revocato', className: 'text-danger' };
  if (displayOnline(d, now)) return { text: 'In linea', className: 'text-live' };
  if (d.lastSeenAt === null) return { text: d.configured ? 'Mai collegato' : 'Da configurare', className: 'text-warn' };
  return { text: `Non in linea · visto ${formatDateTime(d.lastSeenAt)}`, className: 'text-warn' };
}

/** Labels of the commands (buttons and the pending command). */
export const COMMAND_LABEL: Record<DisplayCommand, string> = {
  reload: 'Ricarica',
  reboot: 'Riavvia',
  screenOff: 'Spegni schermo',
  screenOn: 'Accendi schermo',
};

/** One option of «Cosa mostra». */
export interface TargetChoice {
  key: string;
  text: string;
  target: DisplayTarget;
}

/** Pure: key of a target in the menu (`none`, `channel`, `m:<id>`, `f:<id>`). */
export function targetKey(t: DisplayTarget): string {
  if (t.kind === 'match') return `m:${t.matchId}`;
  if (t.kind === 'fixture') return `f:${t.clientFixtureId}`;
  return t.kind;
}

export const NONE_TEXT = 'Nessuno (schermata di attesa con il logo)';
export const CHANNEL_TEXT = 'Canale live del club';

/**
 * Pure: what a player can show: nothing, the channel of the club, the matches of «Una partita fissa» of the public
 * links (live now, then the coming ones of the calendar), then the other matches received (most recent first). The
 * current target of the player stays in the list even when it is no longer among them.
 */
export function targetChoices(input: {
  fixtures: readonly ClubFixture[];
  matches: readonly MatchSummary[];
  ourName: string | null;
  now: number;
  current?: DisplayTarget;
}): TargetChoice[] {
  const out: TargetChoice[] = [
    { key: 'none', text: NONE_TEXT, target: { kind: 'none' } },
    { key: 'channel', text: CHANNEL_TEXT, target: { kind: 'channel' } },
  ];
  for (const c of fixedChoices(input))
    out.push({
      key: c.key,
      text: c.kind === 'fixture' ? `Calendario: ${c.text}` : `Partita: ${c.text}`,
      target:
        c.kind === 'fixture'
          ? { kind: 'fixture', clientFixtureId: c.fixture.id }
          : { kind: 'match', matchId: c.matchId },
    });
  for (const m of input.matches) {
    if (out.some((c) => c.key === `m:${m.id}`)) continue;
    out.push({
      key: `m:${m.id}`,
      text: `Partita: ${matchTitle(m)} · ${formatDateTime(m.updatedAt)}`,
      target: { kind: 'match', matchId: m.id },
    });
  }
  const current = input.current;
  if (current && !out.some((c) => c.key === targetKey(current)))
    out.push({ key: targetKey(current), text: targetText(current), target: current });
  return out;
}

/** Pure: what a player shows, as written in the list (`choices`: the names of the matches, when known). */
export function targetText(t: DisplayTarget, choices: readonly TargetChoice[] = []): string {
  if (t.kind === 'none') return 'Nessuno (attesa)';
  if (t.kind === 'channel') return CHANNEL_TEXT;
  const known = choices.find((c) => c.key === targetKey(t));
  if (known) return known.text;
  return t.kind === 'match' ? 'Partita scelta' : 'Partita del calendario scelta';
}

/** Pure: the Wi-Fi of the configuration from the form; null with no SSID (no Wi-Fi: cable), an error text if invalid. */
export function wifiOf(form: {
  ssid: string;
  password: string;
  country: string;
}): { wifi: DisplayWifi | null } | { error: string } {
  const ssid = form.ssid.trim();
  if (ssid === '') return { wifi: null };
  const parsed = DisplayWifiSchema.safeParse({
    ssid,
    country: form.country.trim().toUpperCase(),
    ...(form.password === '' ? {} : { password: form.password }),
  });
  if (parsed.success) return { wifi: parsed.data };
  const field = parsed.error.issues[0]?.path[0];
  if (field === 'password')
    return { error: 'La password del Wi-Fi deve avere da 8 a 63 caratteri (vuota: rete aperta).' };
  if (field === 'country') return { error: 'Il paese è di due lettere, es. IT.' };
  return { error: 'Il nome della rete Wi-Fi ha al massimo 32 caratteri, senza caratteri speciali.' };
}
