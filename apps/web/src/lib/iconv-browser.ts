/**
 * Browser replacement of `iconv-lite` (alias in vite.config.ts). The portal never decodes DVW files, but
 * `@arenalive/shared` reaches the parser through its ingest schemas, and the real iconv-lite needs Node's Buffer:
 * loading it in the browser fails. Any call here is a bug.
 */
function unavailable(): never {
  throw new Error('iconv-lite non disponibile nel browser');
}

export default { decode: unavailable, encode: unavailable, encodingExists: (): boolean => false };
