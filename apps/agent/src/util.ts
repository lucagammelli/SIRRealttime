/** `code` of a Node system error (`ENOENT`, `EBUSY`…), if any. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = err.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Short description of an error for the logs (never the request: it carries the token). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
    return `${err.message}${cause}`;
  }
  return String(err);
}

/** Waits `ms`, or less if `signal` is aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
