import { readFileSync } from 'node:fs';
import { parseDvw } from '@sir/dvw-parser';
import type { ParsedMatch } from '@sir/dvw-parser';
import { describe, expect, it } from 'vitest';
import { generateMatch, renderDvw, scoutLineText } from './index.js';
import type { GeneratedMatch } from './index.js';

const ROLE_NAMES = { L: 'libero', H: 'outside', O: 'opposite', M: 'middle', S: 'setter' } as const;

function lastPointsPerSet(parsed: ParsedMatch): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  for (const e of parsed.scout) {
    if (e.kind === 'point' && e.set !== undefined) out.set(e.set, [e.homeScore, e.awayScore]);
  }
  return out;
}

function checkCommon(parsed: ParsedMatch): void {
  expect(parsed.warnings).toEqual([]);
  expect(parsed.scout.filter((e) => e.kind === 'unknown')).toEqual([]);
  const last = lastPointsPerSet(parsed);
  const ends = parsed.scout.filter((e) => e.kind === 'setEnd');
  expect(ends.map((e) => e.setNumber)).toEqual([...last.keys()]);
  for (const [i, s] of parsed.sets.entries()) {
    const score = last.get(i + 1);
    if (s.finalScore && score) expect([s.homeScore, s.awayScore]).toEqual(score);
  }
}

describe.each([3, 4, 5] as const)('andata e ritorno con %i set', (sets) => {
  it.each([1, 2, 3, 4, 5])('seed %i', (seed) => {
    const match: GeneratedMatch = generateMatch({ seed, sets });
    const parsed = parseDvw(renderDvw(match, match.lines.length));
    checkCommon(parsed);

    expect(parsed.scout.map((e) => e.rawLine)).toEqual(match.lines.map((l) => scoutLineText(match, l)));
    expect(parsed.scout.map((e) => e.code)).toEqual(match.lines.map((l) => l.code));

    const generatedLast = new Map<number, [number, number]>();
    for (const l of match.lines) if (l.kind === 'point' && l.score) generatedLast.set(l.set, l.score);
    expect(lastPointsPerSet(parsed)).toEqual(generatedLast);
    expect(parsed.scout.filter((e) => e.kind === 'setEnd')).toHaveLength(match.sets.length);
    expect(match.sets.map((s) => [s.home, s.away])).toEqual([...generatedLast.values()]);

    expect(parsed.home).toMatchObject({ code: match.home.code, name: match.home.name, coach: match.home.coach });
    expect(parsed.away).toMatchObject({ code: match.away.code, name: match.away.name, coach: match.away.coach });
    expect(parsed.home?.name).toBe('Pallavolo Città');
    for (const [parsedPlayers, team] of [
      [parsed.homePlayers, match.home],
      [parsed.awayPlayers, match.away],
    ] as const) {
      expect(parsedPlayers.map((p) => [p.number, p.id, p.lastName, p.firstName, p.role])).toEqual(
        team.players.map((p) => [p.number, String(p.id), p.lastName, p.firstName, ROLE_NAMES[p.role]]),
      );
    }
    const first = parsed.scout.find((e) => e.kind === 'action');
    expect(first?.pointPhase).toMatch(/^[sr]$/);
    expect(parsed.scout.every((e) => e.time !== undefined && e.homeLineup.every((n) => n !== undefined))).toBe(true);
    expect(parsed.sets.filter((s) => s.finished)).toHaveLength(match.sets.length);
  });
});

describe('samples/partita-sintetica.dvw', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../../samples/partita-sintetica.dvw', import.meta.url)));
  const parsed = parseDvw(bytes);

  it('si legge senza avvisi né unknown', () => {
    checkCommon(parsed);
    expect(parsed.scout.length).toBeGreaterThan(100);
  });

  it('squadre e giocatori con gli accenti corretti', () => {
    expect(parsed.home?.name).toBe('Pallavolo Città');
    expect(parsed.rawSections['MORE']).toContain('Città Alta');
    expect(parsed.homePlayers.length).toBeGreaterThanOrEqual(12);
    expect(parsed.homePlayers.every((p) => p.lastName && p.firstName && p.number !== undefined)).toBe(true);
    expect(parsed.sets.filter((s) => s.finished).length).toBe(
      Number(parsed.home?.setsWon) + Number(parsed.away?.setsWon),
    );
  });
});
