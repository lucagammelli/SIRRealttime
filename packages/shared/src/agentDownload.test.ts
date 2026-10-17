import { describe, expect, it } from 'vitest';
import {
  agentBranding,
  AgentBrandingSchema,
  agentDownloadConfig,
  agentDownloadFileName,
  AgentReleaseSchema,
  DEFAULT_BRAND_COLORS,
  isPrivateIPv4,
  TEMPLATES,
} from './index.js';

describe('private IPv4', () => {
  it('recognizes only the three private ranges, never host names', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.10']) expect(isPrivateIPv4(ip)).toBe(true);
    for (const host of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '127.0.0.1', 'example.it', '10.example.it']) {
      expect(isPrivateIPv4(host)).toBe(false);
    }
  });
});

describe('config.json of the downloaded agent', () => {
  it('has the server of the client and the default folders, never a token', () => {
    const config = agentDownloadConfig('https://club-a.sir.it');
    expect(config).toEqual({
      watchPath: 'E:\\',
      serverUrl: 'https://club-a.sir.it',
      dataDir: 'C:\\SIRAgent\\data',
      logDir: 'C:\\SIRAgent\\logs',
    });
    expect(Object.keys(config)).not.toContain('agentToken');
  });

  it('allows plain http only towards a private IPv4', () => {
    expect(agentDownloadConfig('http://192.168.1.20:8080')['allowHttpPrivateNetwork']).toBe(true);
    expect(agentDownloadConfig('http://localhost:8080')).not.toHaveProperty('allowHttpPrivateNetwork');
    expect(agentDownloadConfig('http://sir.example.it')).not.toHaveProperty('allowHttpPrivateNetwork');
    expect(agentDownloadConfig('https://192.168.1.20')).not.toHaveProperty('allowHttpPrivateNetwork');
  });
});

describe('branding.json', () => {
  it('resolves the missing colours and the text on each one', () => {
    const branding = agentBranding('Club A', { primary: '#ffeb3b' });
    expect(branding).toEqual({
      version: 1,
      name: 'Club A',
      colors: {
        primary: '#ffeb3b',
        onPrimary: '#000000',
        accent: DEFAULT_BRAND_COLORS.accent,
        onAccent: '#ffffff',
        background: DEFAULT_BRAND_COLORS.background,
        onBackground: '#000000',
      },
    });
  });

  it('takes the missing colours from the template of the client (SIR VOLLEY: dark and red window)', () => {
    const sir = agentBranding('SIR', {}, 'sir-volley');
    expect(sir.colors).toMatchObject({
      primary: TEMPLATES['sir-volley'].colors.primary,
      background: TEMPLATES['sir-volley'].colors.background,
      onBackground: '#ffffff',
    });
    expect(agentBranding('SIR', { primary: '#003399' }, 'sir-volley').colors.primary).toBe('#003399');
    expect(agentBranding('Club A', {}).colors.background).toBe(DEFAULT_BRAND_COLORS.background);
  });

  it('accepts only #rrggbb colours and no other field', () => {
    const good = agentBranding('Club A', {});
    expect(AgentBrandingSchema.safeParse(good).success).toBe(true);
    const bad = (colors: Record<string, string>) =>
      AgentBrandingSchema.safeParse({ ...good, colors: { ...good.colors, ...colors } }).success;
    expect(bad({ primary: 'red' })).toBe(false);
    expect(bad({ primary: '#fff' })).toBe(false);
    expect(bad({ primary: "#ffffff'; calc" })).toBe(false);
    expect(AgentBrandingSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(AgentBrandingSchema.safeParse({ ...good, name: 'a\nb' }).success).toBe(false);
  });
});

describe('release of the executable', () => {
  it('validates sir-agent.json and builds a safe file name', () => {
    const release = { version: '0.0.0-2aa1465', builtAt: '2026-10-16T10:00:00.000Z', sha256: 'a'.repeat(64) };
    expect(AgentReleaseSchema.safeParse(release).success).toBe(true);
    expect(AgentReleaseSchema.safeParse({ ...release, version: '../x' }).success).toBe(false);
    expect(AgentReleaseSchema.safeParse({ ...release, version: 'a b' }).success).toBe(false);
    expect(agentDownloadFileName('club-a', release.version)).toBe('SIRRealtime-agente-club-a-0.0.0-2aa1465.zip');
  });
});
