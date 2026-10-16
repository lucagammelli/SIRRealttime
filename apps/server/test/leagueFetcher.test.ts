import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, LeagueFetcherOptions } from '../src/leagues/fetcher.js';
import { decodePage, LeagueFetcher, LeagueFetchError, leagueUserAgent } from '../src/leagues/fetcher.js';
import { calendarUrl, logoUrl, teamUrl } from '../src/leagues/legavolley.js';

const UA = 'SIRRealtime/1.2.3 (+https://portale.test)';

function fetcher(fetch: FetchLike, extra: Partial<LeagueFetcherOptions> = {}) {
  return new LeagueFetcher({ userAgent: UA, fetch, minIntervalMs: 0, ...extra });
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8', ...headers } });

async function failure(promise: Promise<unknown>): Promise<LeagueFetchError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof LeagueFetchError) return err;
    throw err;
  }
  throw new Error('no error');
}

/** Body of `total` bytes in chunks of 64 KB, counting how many chunks were pulled. */
function bigBody(total: number) {
  const chunk = new Uint8Array(64 * 1024);
  let sent = 0;
  const pulled = { chunks: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) return controller.close();
      sent += chunk.length;
      pulled.chunks++;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulled };
}

describe('LeagueFetcher', () => {
  it('sends the User-Agent, never follows redirects by itself and returns body and validators', async () => {
    const fetch = vi.fn<FetchLike>(() =>
      Promise.resolve(html('<p>ok</p>', { etag: '"abc"', 'last-modified': 'Fri, 16 Oct 2026 13:03:35 GMT' })),
    );
    const res = await fetcher(fetch).get(calendarUrl(2025, 974), 'page');
    expect(res).toMatchObject({
      status: 'ok',
      validators: { etag: '"abc"', lastModified: 'Fri, 16 Oct 2026 13:03:35 GMT' },
    });
    if (res.status === 'ok') expect(res.body.toString()).toBe('<p>ok</p>');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://www.legavolley.it/calendario/?Anno=2025&IdCampionato=974');
    expect(init?.redirect).toBe('manual');
    expect((init?.headers as Record<string, string>)['user-agent']).toBe(UA);
  });

  it('sends If-None-Match / If-Modified-Since and reads a 304 as not modified', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(new Response(null, { status: 304 })));
    const res = await fetcher(fetch).get(teamUrl(6865), 'page', { etag: '"abc"', lastModified: 'yesterday' });
    expect(res).toEqual({ status: 'not-modified' });
    const headers = fetch.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('"abc"');
    expect(headers['if-modified-since']).toBe('yesterday');
  });

  it('refuses another host and the paths of robots.txt without any request', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(html('x')));
    const f = fetcher(fetch);
    expect((await failure(f.get(new URL('https://example.org/team/1'), 'page'))).code).toBe('URL_REJECTED');
    expect((await failure(f.get(new URL('http://www.legavolley.it/team/1'), 'page'))).code).toBe('URL_REJECTED');
    const robots = await failure(f.get(new URL('https://www.legavolley.it/statistiche/?TipoStat=1.1'), 'page'));
    expect(robots).toMatchObject({ code: 'URL_REJECTED', message: expect.stringContaining('robots.txt') as string });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows a redirect only to an allowed path of the same host', async () => {
    const redirect = (location: string) => new Response(null, { status: 301, headers: { location } });
    const ok = vi.fn<FetchLike>().mockResolvedValueOnce(redirect('/team/6865/')).mockResolvedValueOnce(html('squadra'));
    const res = await fetcher(ok).get(teamUrl(6865), 'page');
    expect(res.status).toBe('ok');
    expect(ok.mock.calls[1]?.[0]).toBe('https://www.legavolley.it/team/6865/');

    for (const location of ['https://evil.test/team/1', 'http://www.legavolley.it/team/1', '/statistiche/'])
      expect((await failure(fetcher(() => Promise.resolve(redirect(location))).get(teamUrl(1), 'page'))).code).toBe(
        'REDIRECT',
      );
    const loop = await failure(fetcher(() => Promise.resolve(redirect('/team/1'))).get(teamUrl(1), 'page'));
    expect(loop.message).toMatch(/Troppi reindirizzamenti/);
  });

  it('stops a page past 2 MB while reading, and a logo past 300 KB', async () => {
    const big = bigBody(3 * 1024 * 1024);
    const err = await failure(
      fetcher(() => Promise.resolve(new Response(big.stream, { status: 200 }))).get(calendarUrl(2025, 974), 'page'),
    );
    expect(err.code).toBe('TOO_LARGE');
    // Stopped at the first chunk past 2 MB (plus the read-ahead of the stream), not after 3 MB.
    expect(big.pulled.chunks).toBeLessThan(40);

    const logo = bigBody(400 * 1024);
    expect(
      (await failure(fetcher(() => Promise.resolve(new Response(logo.stream))).get(logoUrl(1), 'logo'))).code,
    ).toBe('TOO_LARGE');
    const declared = new Response('x', { headers: { 'content-length': String(5 * 1024 * 1024) } });
    expect((await failure(fetcher(() => Promise.resolve(declared)).get(teamUrl(1), 'page'))).code).toBe('TOO_LARGE');
    const small = await fetcher(() => Promise.resolve(new Response(new Uint8Array(1000)))).get(logoUrl(1), 'logo');
    expect(small.status).toBe('ok');
  });

  it('gives up after the timeout', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const err = await failure(fetcher(hanging, { timeoutMs: 20 }).get(teamUrl(1), 'page'));
    expect(err).toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('non ha risposto') as string });
  });

  it('reports HTTP errors and network failures', async () => {
    const status = await failure(
      fetcher(() => Promise.resolve(new Response('no', { status: 503 }))).get(teamUrl(1), 'page'),
    );
    expect(status).toMatchObject({ code: 'HTTP_STATUS', message: 'Il sito ha risposto 503' });
    const network = await failure(fetcher(() => Promise.reject(new TypeError('fetch failed'))).get(teamUrl(1), 'page'));
    expect(network).toMatchObject({ code: 'NETWORK', message: 'Sito non raggiungibile' });
    // A 304 without validators sent is not a valid answer.
    expect(
      (await failure(fetcher(() => Promise.resolve(new Response(null, { status: 304 }))).get(teamUrl(1), 'page'))).code,
    ).toBe('HTTP_STATUS');
  });

  it('makes at most one request per second, one at a time (fake clock)', async () => {
    let clock = 10_000;
    const waits: number[] = [];
    const starts: number[] = [];
    const f = new LeagueFetcher({
      userAgent: UA,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      fetch: () => {
        starts.push(clock);
        clock += 150; // the request itself takes 150 ms
        return Promise.resolve(html('x'));
      },
    });
    await Promise.all([f.get(teamUrl(1), 'page'), f.get(teamUrl(2), 'page'), f.get(teamUrl(3), 'page')]);
    expect(starts).toEqual([10_000, 11_000, 12_000]);
    expect(waits).toEqual([850, 850]);
    clock += 5000;
    await f.get(teamUrl(4), 'page');
    expect(waits).toHaveLength(2);
  });

  it('refuses every request after close', async () => {
    const f = fetcher(() => Promise.resolve(html('x')));
    f.close();
    expect((await failure(f.get(teamUrl(1), 'page'))).code).toBe('CLOSED');
  });
});

describe('helpers', () => {
  it('builds a printable User-Agent', () => {
    expect(leagueUserAgent('0.0.0', 'https://portale.example.org')).toBe(
      'SIRRealtime/0.0.0 (+https://portale.example.org)',
    );
    expect(leagueUserAgent('1', 'àè\r\n(x)')).toBe('SIRRealtime/1 (+x)');
    expect(leagueUserAgent('1', '')).toBe('SIRRealtime/1');
  });

  it('decodes UTF-8 pages and Latin-1 ones', () => {
    expect(decodePage(Buffer.from('Città', 'utf8'), 'text/html; charset=UTF-8')).toBe('Città');
    expect(decodePage(Buffer.from([0x43, 0x69, 0x74, 0x74, 0xe0]), 'text/html; charset=ISO-8859-1')).toBe('Città');
  });

  it('drops NUL characters (PostgreSQL cannot store them)', () => {
    expect(decodePage(Buffer.from('Sir\u0000 Susa\u0000', 'utf8'), 'text/html')).toBe('Sir Susa');
  });
});
