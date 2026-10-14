import { decodeDvw } from './decode.js';
import { parseMatch, parsePlayers, parseSets, parseTeams, scoutLinesOf, splitSections } from './sections.js';
import { parseScoutLine } from './scout.js';
import type { ParsedMatch } from './types.js';

export * from './types.js';
export { decodeDvw } from './decode.js';
export { parseScoutLine } from './scout.js';

/** Righe grezze (non vuote) della sezione [3SCOUT]. */
export function extractScoutLines(text: string): string[] {
  return scoutLinesOf(splitSections(text));
}

/** Parser puro di un file DVW (byte o testo già decodificato). Non lancia mai per righe malformate. */
export function parseDvw(input: Uint8Array | string): ParsedMatch {
  const text = typeof input === 'string' ? input : decodeDvw(input);
  const sections = splitSections(text);
  const warnings: string[] = [];
  for (const name of ['MATCH', 'TEAMS', 'SCOUT']) {
    if (!sections.has(name)) warnings.push(`Sezione [3${name}] mancante`);
  }
  const rawSections: Record<string, string> = {};
  for (const [name, lines] of sections) rawSections[name] = lines.join('\n');
  const teams = parseTeams(sections.get('TEAMS') ?? []);
  return {
    match: parseMatch(sections.get('MATCH') ?? []),
    home: teams[0],
    away: teams[1],
    homePlayers: parsePlayers(sections.get('PLAYERS-H') ?? []),
    awayPlayers: parsePlayers(sections.get('PLAYERS-V') ?? []),
    sets: parseSets(sections.get('SET') ?? []),
    scout: scoutLinesOf(sections).map((l, i) => parseScoutLine(l, i, warnings)),
    rawSections,
    warnings,
  };
}
