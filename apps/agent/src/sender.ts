import { gzipSync } from 'node:zlib';
import type { IngestRequest, IngestResponse } from '@sir/shared';
import { IngestResponseSchema } from '@sir/shared';
import { errorMessage } from './util.js';

/** Bodies larger than this are sent with `Content-Encoding: gzip`. */
export const GZIP_THRESHOLD_BYTES = 4 * 1024;

export type SendResult =
  | { type: 'ok'; response: IngestResponse }
  /** Answer with an HTTP error status (`retryAfterMs` from `Retry-After`, if any). */
  | { type: 'http'; status: number; retryAfterMs?: number }
  /** Network error, timeout or an answer that is not a valid ingest response. */
  | { type: 'network'; message: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SenderOptions {
  serverUrl: string;
  agentToken: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

/** URL of `path` (relative, e.g. `api/ingest`) on the server, keeping a path prefix of `serverUrl`. */
export function apiUrl(serverUrl: string, path: string): string {
  const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
  return new URL(path, base).toString();
}

/** URL of `POST /api/ingest`, keeping a path prefix of `serverUrl`. */
export function ingestUrl(serverUrl: string): string {
  return apiUrl(serverUrl, 'api/ingest');
}

/** Sends ingest requests; the token only ever goes into the `Authorization` header. */
export class Sender {
  private readonly url: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: SenderOptions) {
    this.url = ingestUrl(options.serverUrl);
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async send(request: IngestRequest): Promise<SendResult> {
    const json = Buffer.from(JSON.stringify(request), 'utf8');
    const gzip = json.length > GZIP_THRESHOLD_BYTES;
    const body = gzip ? gzipSync(json) : json;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.agentToken}`,
          'content-type': 'application/json',
          ...(gzip ? { 'content-encoding': 'gzip' } : {}),
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      return { type: 'network', message: errorMessage(err) };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const retryAfter = Number(res.headers.get('retry-after'));
      return {
        type: 'http',
        status: res.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
      };
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (err) {
      return { type: 'network', message: `risposta non JSON: ${errorMessage(err)}` };
    }
    const parsed = IngestResponseSchema.safeParse(raw);
    if (!parsed.success) return { type: 'network', message: 'risposta del server non valida' };
    return { type: 'ok', response: parsed.data };
  }
}
