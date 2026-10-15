import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/app.js';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies the defaults', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost/sir' });
    expect(c).toMatchObject({
      port: 8090,
      host: '127.0.0.1',
      cookieSecure: true,
      sessionTtlHours: 12,
      admin: null,
      logLevel: 'info',
      trustProxy: false,
      matchMaxLines: 20_000,
      rateLimits: { login: 10, ingest: 600, public: 120, admin: 300, register: 10 },
    });
  });

  it('reads the rate limits and rejects invalid values', () => {
    const c = loadConfig({
      DATABASE_URL: 'x',
      RATE_LIMIT_LOGIN: '5',
      RATE_LIMIT_INGEST: '1200',
      RATE_LIMIT_PUBLIC: '60',
      RATE_LIMIT_ADMIN: '100',
      RATE_LIMIT_REGISTER: '20',
    });
    expect(c.rateLimits).toEqual({ login: 5, ingest: 1200, public: 60, admin: 100, register: 20 });
    for (const value of ['0', '-1', '1.5', 'abc', '100001']) {
      expect(() => loadConfig({ DATABASE_URL: 'x', RATE_LIMIT_LOGIN: value })).toThrow(/RATE_LIMIT_LOGIN/);
    }
  });

  it('normalizes origins and URLs', () => {
    const c = loadConfig({
      DATABASE_URL: 'x',
      CORS_ORIGIN: 'https://live.example.it/',
      PUBLIC_BASE_URL: 'https://live.example.it/',
      COOKIE_SECURE: 'false',
      ADMIN_EMAIL: 'Luca@Example.it',
      ADMIN_PASSWORD: 'una-password-lunga',
    });
    expect(c.corsOrigin).toBe('https://live.example.it');
    expect(c.publicBaseUrl).toBe('https://live.example.it');
    expect(c.cookieSecure).toBe(false);
    expect(c.admin).toEqual({ email: 'luca@example.it', password: 'una-password-lunga' });
  });

  it('names the invalid variables without their values', () => {
    const run = () => loadConfig({ PORT: 'abc', ADMIN_EMAIL: 'a@b.it', ADMIN_PASSWORD: 'segreto' });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).toContain('ADMIN_PASSWORD');
      expect(message).not.toContain('segreto');
    }
  });
});

describe('redactUrl', () => {
  it('masks the share token in public paths', () => {
    expect(redactUrl('/api/public/abcDEF_123-xyz/state')).toBe('/api/public/[token]/state');
    expect(redactUrl('/ws/public/abcDEF_123-xyz')).toBe('/ws/public/[token]');
    expect(redactUrl('/api/admin/matches')).toBe('/api/admin/matches');
  });
});
