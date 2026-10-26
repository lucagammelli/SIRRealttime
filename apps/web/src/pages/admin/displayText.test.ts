import type { ClubFixture, DisplaySummary, MatchSummary } from '@arenalive/shared';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_TEXT,
  DISPLAY_ONLINE_MS,
  displayOnline,
  displayStateText,
  NONE_TEXT,
  targetChoices,
  targetKey,
  targetText,
  wifiOf,
} from './displayText.ts';

const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const display = (over: Partial<DisplaySummary> = {}): DisplaySummary => ({
  id: ID,
  name: 'Tribuna',
  target: { kind: 'none' },
  configured: true,
  revoked: false,
  lastSeenAt: new Date(NOW - 10_000).toISOString(),
  lastIp: null,
  version: '1.0.0',
  resolution: '1920x1080',
  command: null,
  commandSeq: 0,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const match = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  id: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11',
  matchKey: 'gara-1',
  live: false,
  lineCount: 10,
  version: 1,
  homeName: 'Perugia',
  awayName: 'Trento',
  setsWon: { home: 3, away: 1 },
  status: 'finished',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
  ...over,
});

describe('state of a player', () => {
  it('is «In linea» within a minute of the last heartbeat', () => {
    expect(displayOnline(display(), NOW)).toBe(true);
    expect(displayOnline(display({ lastSeenAt: new Date(NOW - DISPLAY_ONLINE_MS).toISOString() }), NOW)).toBe(false);
    expect(displayOnline(display({ revoked: true }), NOW)).toBe(false);
    expect(displayStateText(display(), NOW).text).toBe('In linea');
    expect(displayStateText(display({ lastSeenAt: '2026-10-25T09:00:00.000Z' }), NOW).text).toMatch(
      /^Non in linea · visto /,
    );
    expect(displayStateText(display({ lastSeenAt: null }), NOW).text).toBe('Mai collegato');
    expect(displayStateText(display({ lastSeenAt: null, configured: false }), NOW).text).toBe('Da configurare');
    expect(displayStateText(display({ revoked: true }), NOW).text).toBe('Revocato');
  });
});

describe('what a player shows', () => {
  it('offers nothing, the channel and the matches, keeping the current target', () => {
    const live = match({ id: '0b8e8a8e-3c55-4b8a-8c2e-4b7f1b0d9e22', live: true, status: 'inProgress' });
    const choices = targetChoices({
      fixtures: [] as ClubFixture[],
      matches: [live, match()],
      ourName: null,
      now: NOW,
      current: { kind: 'fixture', clientFixtureId: ID },
    });
    expect(choices.map((c) => c.key)).toEqual(['none', 'channel', `m:${live.id}`, `m:${match().id}`, `f:${ID}`]);
    expect(choices[0]?.text).toBe(NONE_TEXT);
    expect(choices[2]?.text).toBe('Partita: In diretta: Perugia – Trento');
    expect(choices[3]?.text).toMatch(/^Partita: Perugia – Trento · /);
    expect(targetText({ kind: 'channel' })).toBe(CHANNEL_TEXT);
    expect(targetText({ kind: 'match', matchId: live.id }, choices)).toBe('Partita: In diretta: Perugia – Trento');
    expect(targetText({ kind: 'fixture', clientFixtureId: ID })).toBe('Partita del calendario scelta');
    expect(targetKey({ kind: 'none' })).toBe('none');
  });
});

describe('Wi-Fi of the configuration', () => {
  it('is optional, checks password and country', () => {
    expect(wifiOf({ ssid: ' ', password: 'x', country: 'IT' })).toEqual({ wifi: null });
    expect(wifiOf({ ssid: 'Palestra', password: 'segreta-1', country: 'it' })).toEqual({
      wifi: { ssid: 'Palestra', password: 'segreta-1', country: 'IT' },
    });
    expect(wifiOf({ ssid: 'Aperta', password: '', country: 'IT' })).toEqual({
      wifi: { ssid: 'Aperta', country: 'IT' },
    });
    expect(wifiOf({ ssid: 'x', password: 'corta', country: 'IT' })).toHaveProperty('error');
    expect(wifiOf({ ssid: 'x', password: '', country: 'ITA' })).toHaveProperty('error');
  });
});
