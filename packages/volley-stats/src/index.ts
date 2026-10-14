import { parseDvw } from '@sir/dvw-parser';
import type { ParsedMatch } from '@sir/dvw-parser';

/** Name of this package; placeholder export until the statistics are implemented. */
export const PACKAGE_NAME = '@sir/volley-stats';

/** Placeholder built on the real parser API (checks that `@sir/dvw-parser` resolves): parses an empty file. */
export function parseEmptyMatch(): ParsedMatch {
  return parseDvw('');
}
