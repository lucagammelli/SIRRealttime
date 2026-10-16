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
      rateLimits: {
        login: 10,
        ingest: 600,
        public: 6000,
        publicWs: 6000,
        publicInvalid: 120,
        admin: 300,
        register: 10,
        shortCodeInvalidTotal: 1000,
        agentDownload: 10,
        leagueSync: 6,
      },
      socketLimits: { perIp: 2000, total: 6000 },
      leagueSync: true,
      leagueContact: 'http://localhost:5173',
    });
  });

  it('reads the switch and the contact of the championship updates', () => {
    const c = loadConfig({ DATABASE_URL: 'x', LEAGUE_SYNC: 'off', LEAGUE_CONTACT: 'info@club.example.org' });
    expect(c).toMatchObject({ leagueSync: false, leagueContact: 'info@club.example.org' });
    expect(() => loadConfig({ DATABASE_URL: 'x', LEAGUE_SYNC: 'no' })).toThrow(/LEAGUE_SYNC/);
    expect(() => loadConfig({ DATABASE_URL: 'x', LEAGUE_CONTACT: 'a\nb' })).toThrow(/LEAGUE_CONTACT/);
  });

  it('reads the folder and the quota of the images', () => {
    const c = loadConfig({ DATABASE_URL: 'x' });
    expect(c.assetsDir).toMatch(/[\\/]data[\\/]assets$/);
    expect(c.assetsQuotaBytes).toBe(50 * 1024 * 1024);
    const d = loadConfig({ DATABASE_URL: 'x', ASSETS_DIR: '/srv/sir/assets', ASSETS_QUOTA_MB: '10' });
    expect(d).toMatchObject({ assetsDir: '/srv/sir/assets', assetsQuotaBytes: 10 * 1024 * 1024 });
    expect(() => loadConfig({ DATABASE_URL: 'x', ASSETS_QUOTA_MB: '0' })).toThrow(/ASSETS_QUOTA_MB/);
  });

  it('reads DEFAULT_TENANT_SLUG: default «predefinito», empty disables the fallback client', () => {
    expect(loadConfig({ DATABASE_URL: 'x' }).defaultTenantSlug).toBe('predefinito');
    expect(loadConfig({ DATABASE_URL: 'x', DEFAULT_TENANT_SLUG: 'club-a' }).defaultTenantSlug).toBe('club-a');
    expect(loadConfig({ DATABASE_URL: 'x', DEFAULT_TENANT_SLUG: '' }).defaultTenantSlug).toBeNull();
    expect(() => loadConfig({ DATABASE_URL: 'x', DEFAULT_TENANT_SLUG: 'Club A' })).toThrow(/DEFAULT_TENANT_SLUG/);
  });

  it('reads the rate limits and rejects invalid values', () => {
    const c = loadConfig({
      DATABASE_URL: 'x',
      RATE_LIMIT_LOGIN: '5',
      RATE_LIMIT_INGEST: '1200',
      RATE_LIMIT_PUBLIC: '60',
      RATE_LIMIT_ADMIN: '100',
      RATE_LIMIT_REGISTER: '20',
      RATE_LIMIT_PUBLIC_WS: '3000',
      RATE_LIMIT_PUBLIC_INVALID: '30',
      RATE_LIMIT_SHORT_CODE_INVALID: '500',
      RATE_LIMIT_AGENT_DOWNLOAD: '3',
      RATE_LIMIT_LEAGUE_SYNC: '2',
    });
    expect(c.rateLimits).toEqual({
      login: 5,
      ingest: 1200,
      public: 60,
      publicWs: 3000,
      publicInvalid: 30,
      admin: 100,
      register: 20,
      shortCodeInvalidTotal: 500,
      agentDownload: 3,
      leagueSync: 2,
    });
    for (const value of ['0', '-1', '1.5', 'abc', '100001']) {
      expect(() => loadConfig({ DATABASE_URL: 'x', RATE_LIMIT_LOGIN: value })).toThrow(/RATE_LIMIT_LOGIN/);
      expect(() => loadConfig({ DATABASE_URL: 'x', RATE_LIMIT_PUBLIC_INVALID: value })).toThrow(
        /RATE_LIMIT_PUBLIC_INVALID/,
      );
    }
  });

  it('reads SHARE_CODE_SECRET: required in production, at least 32 characters', () => {
    const secret = 's'.repeat(32);
    const dev = loadConfig({ DATABASE_URL: 'x' });
    expect(dev.shareCodeSecretIsDefault).toBe(true);
    expect(dev.shareCodeSecret.length).toBeGreaterThanOrEqual(32);
    expect(loadConfig({ DATABASE_URL: 'x', SHARE_CODE_SECRET: secret })).toMatchObject({
      shareCodeSecret: secret,
      shareCodeSecretIsDefault: false,
    });
    expect(() => loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'production' })).toThrow(/SHARE_CODE_SECRET/);
    expect(() => loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'production', SHARE_CODE_SECRET: '' })).toThrow(
      /SHARE_CODE_SECRET/,
    );
    for (const env of [{}, { NODE_ENV: 'production' }])
      expect(() => loadConfig({ DATABASE_URL: 'x', ...env, SHARE_CODE_SECRET: 's'.repeat(31) })).toThrow(
        /SHARE_CODE_SECRET/,
      );
    const prod = loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'production', SHARE_CODE_SECRET: secret });
    expect(prod.shareCodeSecretIsDefault).toBe(false);
    // The error names the variable, never its value.
    expect(() => loadConfig({ DATABASE_URL: 'x', SHARE_CODE_SECRET: 'corto-segreto' })).toThrow(
      /^(?!.*corto-segreto)/s,
    );
  });

  it('reads the WebSocket limits and rejects invalid values', () => {
    const c = loadConfig({ DATABASE_URL: 'x', WS_MAX_PER_IP: '500', WS_MAX_TOTAL: '10000' });
    expect(c.socketLimits).toEqual({ perIp: 500, total: 10_000 });
    for (const value of ['0', '-3', '2.5', 'tanti', '1000001']) {
      expect(() => loadConfig({ DATABASE_URL: 'x', WS_MAX_TOTAL: value })).toThrow(/WS_MAX_TOTAL/);
      expect(() => loadConfig({ DATABASE_URL: 'x', WS_MAX_PER_IP: value })).toThrow(/WS_MAX_PER_IP/);
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

  it('keeps the graphics routes of the client readable', () => {
    expect(redactUrl('/api/public/tenant')).toBe('/api/public/tenant');
    expect(redactUrl('/api/public/team-logos/00000000-0000-4000-8000-000000000000')).toBe(
      '/api/public/team-logos/00000000-0000-4000-8000-000000000000',
    );
    expect(redactUrl('/api/public/assets/00000000-0000-4000-8000-000000000000')).toBe(
      '/api/public/assets/00000000-0000-4000-8000-000000000000',
    );
    expect(redactUrl('/api/public/tenantXYZ12345678901234567/state')).toBe('/api/public/[token]/state');
  });
});
