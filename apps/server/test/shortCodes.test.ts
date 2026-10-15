import type { CreateShareTokenResponse, ShareTokenSummary } from '@sir/shared';
import { formatShortCode, PAIRING_CODE_ALPHABET, SHORT_CODE_PATTERN } from '@sir/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_SHARE_CODE_SECRET } from '../src/config.js';
import { shareTokens } from '../src/db/index.js';
import { deriveShortCode, shortCodeLookupHash } from '../src/lib/shortCode.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import { insertShareToken, isUniqueViolation, syncShortCodes } from '../src/shareCodes.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, ORIGIN, startServer } from './helpers.js';

const SECRET = DEV_SHARE_CODE_SECRET;
const silent = { info: () => undefined, error: () => undefined } as unknown as Parameters<typeof syncShortCodes>[2];

describe('deriveShortCode', () => {
  const id = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

  it('is deterministic and stable: same secret and id, same code', () => {
    const code = deriveShortCode('s'.repeat(32), id);
    expect(code).toMatch(SHORT_CODE_PATTERN);
    expect(deriveShortCode('s'.repeat(32), id)).toBe(code);
    // Fixed value: a change of the derivation would change every printed QR code.
    expect(code).toBe('7GF4NQ7Y');
  });

  it('changes with the id, the salt and the secret', () => {
    const base = deriveShortCode(SECRET, id);
    expect(deriveShortCode(SECRET, id, 1)).not.toBe(base);
    expect(deriveShortCode(`${SECRET}x`, id)).not.toBe(base);
    expect(deriveShortCode(SECRET, '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7d')).not.toBe(base);
  });

  it('uses every letter of the alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) for (const c of deriveShortCode(SECRET, `id-${i}`)) seen.add(c);
    expect([...seen].sort().join('')).toBe([...PAIRING_CODE_ALPHABET].sort().join(''));
  });

  it('recognizes a unique violation, also wrapped', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('x', { cause: { code: '23505' } }))).toBe(true);
    expect(isUniqueViolation(new Error('x', { cause: { code: '23503' } }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('short links', () => {
  const HOST_B = 'b.sir.test';
  const ADMIN_B = { email: 'admin@b.test', password: 'password-admin-b' };
  let server: TestServer;
  let cookie: string;
  let baseUrl: string;

  const create = async (): Promise<CreateShareTokenResponse> => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/admin/share-tokens',
      headers: { cookie },
      payload: { label: 'Tribuna', matchId: null, expiresAt: null },
    });
    expect(res.statusCode).toBe(201);
    return res.json<CreateShareTokenResponse>();
  };
  const list = async (who = cookie, host?: string): Promise<ShareTokenSummary[]> => {
    const res = await server.app.inject({
      url: '/api/admin/share-tokens',
      headers: { cookie: who, ...(host ? { host } : {}) },
    });
    expect(res.statusCode).toBe(200);
    return res.json<ShareTokenSummary[]>();
  };
  const stateOf = (token: string, host?: string) =>
    server.app.inject({ url: `/api/public/${token}/state`, ...(host ? { headers: { host } } : {}) });
  const rowOf = async (id: string) => {
    const [row] = await server.database.db.select().from(shareTokens).where(eq(shareTokens.id, id));
    if (!row) throw new Error('row missing');
    return row;
  };

  beforeAll(async () => {
    server = await startServer();
    cookie = await login(server.app, ADMIN);
    baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(() => server.close());

  it('creates a short code, stores only its hash and lists it again', async () => {
    const created = await create();
    expect(created.shortCode).toMatch(SHORT_CODE_PATTERN);
    const code = created.shortCode ?? '';
    expect(created.shortUrl).toBe(`${ORIGIN}/l/${code}`);
    expect(code).toBe(deriveShortCode(SECRET, created.id, 0));
    const row = await rowOf(created.id);
    expect(row.shortCodeHash).toBe(shortCodeLookupHash(SECRET, code));
    expect(row.shortCodeHash).not.toBe(hashToken(code));
    expect(JSON.stringify(row)).not.toContain(code);
    const listed = (await list()).find((s) => s.id === created.id);
    expect(listed).toMatchObject({ shortCode: code, shortUrl: created.shortUrl });
    expect(JSON.stringify(await list())).not.toContain(created.token);
  });

  it('serves the state with the short code in any accepted form, and still with the long token', async () => {
    const created = await create();
    const code = created.shortCode ?? '';
    for (const form of [code, code.toLowerCase(), formatShortCode(code), formatShortCode(code).toLowerCase()])
      expect((await stateOf(form)).statusCode).toBe(200);
    expect((await stateOf(created.token)).statusCode).toBe(200);
    expect((await stateOf(`${code.slice(0, 3)}-${code.slice(3)}`)).statusCode).toBe(404);
    expect((await stateOf(deriveShortCode(SECRET, created.id, 1))).statusCode).toBe(404);
  });

  it('gives a short code to an old link at the next list, moving to the next salt on a collision', async () => {
    const tokenHash = hashToken(generateToken());
    const [old] = await server.database.db
      .insert(shareTokens)
      .values({ tenantId: server.tenantId, tokenHash, matchId: null, label: 'Vecchio' })
      .returning();
    if (!old) throw new Error('not inserted');
    // Another (revoked, so never assigned again) link already holds the code of salt 0 of the old one.
    await server.database.db.insert(shareTokens).values({
      tenantId: server.tenantId,
      tokenHash: hashToken(generateToken()),
      matchId: null,
      label: 'Occupante',
      revoked: true,
      shortCodeHash: shortCodeLookupHash(SECRET, deriveShortCode(SECRET, old.id, 0)),
    });
    const listed = (await list()).find((s) => s.id === old.id);
    const expected = deriveShortCode(SECRET, old.id, 1);
    expect(listed?.shortCode).toBe(expected);
    expect(await rowOf(old.id)).toMatchObject({
      shortCodeSalt: 1,
      shortCodeHash: shortCodeLookupHash(SECRET, expected),
    });
    expect((await stateOf(expected)).statusCode).toBe(200);
    expect((await list()).find((s) => s.id === old.id)?.shortCode).toBe(expected);
  });

  it('assigns the codes again at the start after a change of the secret', async () => {
    const created = await create();
    const newSecret = 'n'.repeat(40);
    expect(await syncShortCodes(server.database.db, newSecret, silent)).toBeGreaterThan(0);
    const row = await rowOf(created.id);
    expect(row.shortCodeHash).toBe(
      shortCodeLookupHash(newSecret, deriveShortCode(newSecret, created.id, row.shortCodeSalt)),
    );
    expect(await syncShortCodes(server.database.db, newSecret, silent)).toBe(0);
    // Back to the secret of this server: the codes of the list work again.
    await syncShortCodes(server.database.db, SECRET, silent);
    expect((await stateOf(created.shortCode ?? '')).statusCode).toBe(200);
  });

  it('answers 404 to the code of another client and builds the short URL on the client hostname', async () => {
    const tenantB = await createTenant(server, 'club-b', [HOST_B]);
    await createUser(server, ADMIN_B, 'admin', tenantB);
    const { code } = await insertShareToken(server.database.db, SECRET, {
      tenantId: tenantB,
      tokenHash: hashToken(generateToken()),
      matchId: null,
      label: 'B',
    });
    expect((await stateOf(code, HOST_B)).statusCode).toBe(200);
    expect((await stateOf(code)).statusCode).toBe(404);
    const mine = (await create()).shortCode ?? '';
    expect((await stateOf(mine, HOST_B)).statusCode).toBe(404);
    const cookieB = await login(server.app, ADMIN_B, HOST_B);
    const listB = await list(cookieB, HOST_B);
    expect(listB).toHaveLength(1);
    expect(listB[0]?.shortUrl).toBe(`http://${HOST_B}/l/${code}`);
  });

  it('makes the short code invalid on revocation and closes its WebSockets', async () => {
    const created = await create();
    const code = formatShortCode(created.shortCode ?? '').toLowerCase();
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/public/${code}`);
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('message', () => resolve());
      ws.addEventListener('error', () => reject(new Error('connection refused')));
    });
    const del = await server.app.inject({
      method: 'DELETE',
      url: `/api/admin/share-tokens/${created.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    expect(await closed).toBe(4404);
    expect((await stateOf(code)).statusCode).toBe(404);
    expect((await list()).find((s) => s.id === created.id)).toMatchObject({
      revoked: true,
      shortCode: null,
      shortUrl: null,
    });
  });
});

describe('short code limits', () => {
  let server: TestServer;
  let cookie: string;
  const at = (ip: string, token: string) => server.app.inject({ url: `/api/public/${token}/state`, remoteAddress: ip });
  const create = async (): Promise<CreateShareTokenResponse> => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/admin/share-tokens',
      headers: { cookie },
      payload: { label: 'Tribuna', matchId: null, expiresAt: null },
    });
    return res.json<CreateShareTokenResponse>();
  };
  /** A valid-looking short code that belongs to no link. */
  const wrong = (i: number) => deriveShortCode('altro-segreto', `tentativo-${i}`);

  beforeAll(async () => {
    server = await startServer({ publicInvalid: 3, shortCodeInvalidTotal: 5 });
    cookie = await login(server.app, ADMIN);
  });
  afterAll(() => server.close());

  it('blocks one IP after RATE_LIMIT_PUBLIC_INVALID wrong short codes', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await at('10.0.0.1', wrong(i))).statusCode);
    expect(codes).toEqual([404, 404, 404, 429]);
  });

  it('past the global limit answers 429 only to IPs with recent failures, without counting them again', async () => {
    const watched = await create();
    const unwatched = await create();
    const watchedCode = watched.shortCode ?? '';
    const unwatchedCode = unwatched.shortCode ?? '';
    // A spectator already watching: the code is in the cache of valid links.
    expect((await at('10.1.0.1', watchedCode)).statusCode).toBe(200);
    // 3 failures already counted by the previous test, 2 more from new IPs reach the limit of 5.
    expect((await at('10.2.0.1', wrong(10))).statusCode).toBe(404);
    expect((await at('10.2.0.2', wrong(11))).statusCode).toBe(404);
    // 10.2.0.1 has one failure: every uncached short code gets 429 from it, valid ones too.
    for (let i = 0; i < 5; i++) {
      const blocked = await at('10.2.0.1', wrong(20 + i));
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    }
    expect((await at('10.2.0.1', unwatchedCode)).statusCode).toBe(429);
    // The global 429 did not count for the IP (limit 3): its long link and the cached code still work.
    expect((await at('10.2.0.1', unwatched.token)).statusCode).toBe(200);
    expect((await at('10.2.0.1', watchedCode)).statusCode).toBe(200);
    // IPs without failures read the database as usual during the block.
    expect((await at('10.3.0.1', unwatchedCode)).statusCode).toBe(200);
    expect((await at('10.3.0.2', wrong(30))).statusCode).toBe(404);
    expect((await at('10.3.0.2', wrong(31))).statusCode).toBe(429);
  });

  it('lets a clean IP in with a valid code after the cache expired, while the block lasts', async () => {
    const fresh = await create();
    const code = fresh.shortCode ?? '';
    // Still inside the minute of the global block, past the 30 s of the cache.
    server.setNow(new Date(Date.now() + 31_000));
    try {
      expect((await at('10.2.0.1', code)).statusCode).toBe(429);
      expect((await at('10.4.0.1', code)).statusCode).toBe(200);
    } finally {
      server.setNow(null);
    }
    server.setNow(new Date(Date.now() + 61_000));
    try {
      expect((await at('10.2.0.1', code)).statusCode).toBe(200);
      expect((await at('10.2.0.6', wrong(40))).statusCode).toBe(404);
    } finally {
      server.setNow(null);
    }
  });
});
