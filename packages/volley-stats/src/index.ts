import { PACKAGE_NAME as PARSER_PACKAGE_NAME } from '@sir/dvw-parser';

/** Name of this package; placeholder export until the statistics are implemented. */
export const PACKAGE_NAME = '@sir/volley-stats';

/** Workspace packages this one is built on (checks that `@sir/dvw-parser` resolves). */
export const DEPENDS_ON: readonly string[] = [PARSER_PACKAGE_NAME];
