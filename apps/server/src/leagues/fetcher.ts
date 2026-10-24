import { rejectedUrlReason } from './legavolley.js';

/**
 * Downloads from the official league site, with the limits of a polite client: only the URLs allowed by the
 * connector (host, paths, robots.txt), one request at a time and at most one per second, timeout, size cap read
 * while streaming, a User-Agent that names us, conditional requests with the saved ETag / Last-Modified, redirects
 * only to allowed URLs of the same host.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Page HTML (2 MB), team logo or photo of a player (300 KB). */
export type DownloadKind = 'page' | 'logo' | 'photo';

export const DOWNLOAD_LIMITS: Record<DownloadKind, number> = {
  page: 2 * 1024 * 1024,
  logo: 300 * 1024,
  photo: 300 * 1024,
};
export const DOWNLOAD_TIMEOUT_MS = 15_000;
export const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_REDIRECTS = 3;

export interface Validators {
  etag: string | null;
  lastModified: string | null;
}

export type DownloadResult =
  { status: 'ok'; body: Buffer; contentType: string | null; validators: Validators } | { status: 'not-modified' };

export type LeagueFetchErrorCode =
  'URL_REJECTED' | 'TIMEOUT' | 'TOO_LARGE' | 'HTTP_STATUS' | 'NETWORK' | 'REDIRECT' | 'CLOSED';

/** A download failed: the message (Italian, no internal details) is stored as the error of the update. */
export class LeagueFetchError extends Error {
  constructor(
    readonly code: LeagueFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LeagueFetchError';
  }
}

export interface LeagueFetcherOptions {
  userAgent: string;
  fetch?: FetchLike;
  /** Milliseconds clock of the pacing (tests: fake). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  minIntervalMs?: number;
  limits?: Partial<Record<DownloadKind, number>>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pure: User-Agent of the downloads, `ArenaLive/<version> (+<contact>)`, printable ASCII only. */
export function leagueUserAgent(version: string, contact: string): string {
  const clean = (s: string) =>
    s
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[()]/g, '')
      .trim();
  const c = clean(contact);
  return `ArenaLive/${clean(version) || '0'}${c ? ` (+${c})` : ''}`;
}

export class LeagueFetcher {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly limits: Record<DownloadKind, number>;
  /** End of the last request queued: the next one starts after it (one request at a time). */
  private queue: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;
  private closed = false;
  private readonly inFlight = new Set<AbortController>();

  constructor(private readonly options: LeagueFetcherOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
    this.minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
    this.limits = { ...DOWNLOAD_LIMITS, ...options.limits };
  }

  /** Stops every download in progress and refuses the next ones (server shutdown). */
  close(): void {
    this.closed = true;
    for (const c of this.inFlight) c.abort();
  }

  /**
   * Downloads an allowed URL. With `validators` the request is conditional and a 304 is `not-modified`. Throws
   * LeagueFetchError (URL not allowed, timeout, too large, HTTP status, network, redirect elsewhere).
   */
  async get(target: URL, kind: DownloadKind, validators?: Validators | null): Promise<DownloadResult> {
    let current = target;
    for (let hop = 0; ; hop++) {
      const reason = rejectedUrlReason(current);
      if (reason) throw new LeagueFetchError('URL_REJECTED', `Indirizzo non ammesso (${reason})`);
      const response = await this.request(current, kind, validators ?? null);
      if ('redirect' in response) {
        if (hop >= MAX_REDIRECTS) throw new LeagueFetchError('REDIRECT', 'Troppi reindirizzamenti dal sito');
        let next: URL;
        try {
          next = new URL(response.redirect, current);
        } catch {
          throw new LeagueFetchError('REDIRECT', 'Reindirizzamento non valido dal sito');
        }
        if (rejectedUrlReason(next))
          throw new LeagueFetchError('REDIRECT', 'Reindirizzamento del sito verso un indirizzo non ammesso');
        current = next;
        continue;
      }
      return response.result;
    }
  }

  /**
   * Waits for the turn of a request: after the end of the previous one and `minIntervalMs` after its start. Returns
   * the function that lets the next one go.
   */
  private async acquire(): Promise<() => void> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const wait = this.lastStart + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastStart = this.now();
    return release;
  }

  private async request(
    target: URL,
    kind: DownloadKind,
    validators: Validators | null,
  ): Promise<{ redirect: string } | { result: DownloadResult }> {
    if (this.closed) throw new LeagueFetchError('CLOSED', 'Server in arresto');
    const release = await this.acquire();
    if (this.closed) {
      release();
      throw new LeagueFetchError('CLOSED', 'Server in arresto');
    }
    const controller = new AbortController();
    this.inFlight.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const headers: Record<string, string> = {
      'user-agent': this.options.userAgent,
      accept: kind === 'page' ? 'text/html' : 'image/png, image/jpeg, image/webp, image/svg+xml',
      'accept-language': 'it',
    };
    if (validators?.etag) headers['if-none-match'] = validators.etag;
    if (validators?.lastModified) headers['if-modified-since'] = validators.lastModified;
    try {
      const response = await this.fetchImpl(target.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        if (!location) throw new LeagueFetchError('REDIRECT', 'Reindirizzamento senza destinazione dal sito');
        return { redirect: location };
      }
      if (response.status === 304 && validators) {
        await response.body?.cancel().catch(() => undefined);
        return { result: { status: 'not-modified' } };
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new LeagueFetchError('HTTP_STATUS', `Il sito ha risposto ${response.status}`);
      }
      const body = await readCapped(response, this.limits[kind]);
      return {
        result: {
          status: 'ok',
          body,
          contentType: response.headers.get('content-type'),
          validators: {
            etag: headerValue(response.headers.get('etag')),
            lastModified: headerValue(response.headers.get('last-modified')),
          },
        },
      };
    } catch (err) {
      if (err instanceof LeagueFetchError) throw err;
      if (timedOut) throw new LeagueFetchError('TIMEOUT', `Il sito non ha risposto entro ${this.timeoutMs / 1000} s`);
      if (this.closed) throw new LeagueFetchError('CLOSED', 'Server in arresto');
      throw new LeagueFetchError('NETWORK', 'Sito non raggiungibile');
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
      release();
    }
  }
}

/** A validator kept only when short and printable (it is sent back as a header). */
function headerValue(value: string | null): string | null {
  return value && value.length <= 200 && /^[\x20-\x7e]+$/.test(value) ? value : null;
}

/** Body of the response, stopped (and the download cancelled) past `max` bytes. */
async function readCapped(response: Response, max: number): Promise<Buffer> {
  const tooLarge = () => new LeagueFetchError('TOO_LARGE', `Risposta del sito oltre ${Math.round(max / 1024)} KB`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Leaving the loop early (throw) cancels the stream: the rest of the body is never downloaded.
  // The body of fetch is a byte stream (typed with any chunks by @types/node).
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > max) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Pure: text of a downloaded page (UTF-8 unless the Content-Type says Latin-1 / Windows-1252), without NUL
 * characters (PostgreSQL cannot store them: one in a name would make every update fail).
 */
export function decodePage(body: Buffer, contentType: string | null): string {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  const latin = charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252';
  return new TextDecoder(latin ? 'windows-1252' : 'utf-8').decode(body).replaceAll('\u0000', '');
}
