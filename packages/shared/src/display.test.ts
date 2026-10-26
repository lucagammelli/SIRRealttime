import { describe, expect, it } from 'vitest';
import {
  DisplayAuthMessageSchema,
  DisplayConfigFileSchema,
  DisplayConfigRequestSchema,
  DisplayHeartbeatRequestSchema,
  DisplayHeartbeatResponseSchema,
  DisplaySocketMessageSchema,
  DisplayTargetSchema,
  displayUpdateWanted,
  UpdateDisplayRequestSchema,
} from './index.js';

const TOKEN = 'A'.repeat(43);
const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

describe('target of a player', () => {
  it('accepts the five cases and refuses an id of the wrong kind', () => {
    for (const t of [
      { kind: 'none' },
      { kind: 'channel' },
      { kind: 'match', matchId: ID },
      { kind: 'fixture', clientFixtureId: ID },
      { kind: 'simulation' },
    ])
      expect(DisplayTargetSchema.parse(t)).toEqual(t);
    expect(DisplayTargetSchema.safeParse({ kind: 'match' }).success).toBe(false);
    expect(DisplayTargetSchema.safeParse({ kind: 'none', matchId: ID }).success).toBe(false);
    expect(DisplayTargetSchema.safeParse({ kind: 'live' }).success).toBe(false);
    // The simulation of the moment, never a fixed simulated match.
    expect(DisplayTargetSchema.safeParse({ kind: 'simulation', matchId: ID }).success).toBe(false);
  });

  it('asks at least one field to change', () => {
    expect(UpdateDisplayRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateDisplayRequestSchema.parse({ name: ' Tribuna ' })).toEqual({ name: 'Tribuna' });
    expect(UpdateDisplayRequestSchema.safeParse({ name: 'a\nb' }).success).toBe(false);
  });
});

describe('arenalive-player.json', () => {
  const file = { version: 1, serverUrl: 'https://club.example.it', token: TOKEN, name: 'Maxischermo' };

  it('has server, token and name; the Wi-Fi only when chosen', () => {
    expect(DisplayConfigFileSchema.parse(file)).toEqual(file);
    const wifi = { ssid: 'Palestra', password: 'segreta-123', country: 'IT' };
    expect(DisplayConfigFileSchema.parse({ ...file, wifi })).toEqual({ ...file, wifi });
    expect(DisplayConfigFileSchema.parse({ ...file, wifi: { ssid: 'Aperta', country: 'IT' } }).wifi).toEqual({
      ssid: 'Aperta',
      country: 'IT',
    });
  });

  it('refuses a server with a final slash or not http(s), short WPA passwords and unknown fields', () => {
    expect(DisplayConfigFileSchema.safeParse({ ...file, serverUrl: 'https://club.example.it/' }).success).toBe(false);
    expect(DisplayConfigFileSchema.safeParse({ ...file, serverUrl: 'ftp://club.example.it' }).success).toBe(false);
    expect(DisplayConfigFileSchema.safeParse({ ...file, token: 'corto' }).success).toBe(false);
    expect(DisplayConfigFileSchema.safeParse({ ...file, extra: 1 }).success).toBe(false);
    for (const wifi of [
      { ssid: 'x', password: 'corta', country: 'IT' },
      { ssid: '', country: 'IT' },
      { ssid: 'x', country: 'it' },
      { ssid: 'a\nb', country: 'IT' },
    ])
      expect(DisplayConfigRequestSchema.safeParse({ wifi }).success).toBe(false);
  });
});

describe('heartbeat', () => {
  it('reads version, screen, uptime and the last command executed', () => {
    const body = { version: '1.2.0', resolution: '1920x1080', uptimeS: 3600, ackSeq: 4 };
    expect(DisplayHeartbeatRequestSchema.parse(body)).toEqual(body);
    expect(DisplayHeartbeatRequestSchema.safeParse({ ...body, resolution: 'grande' }).success).toBe(false);
    expect(DisplayHeartbeatRequestSchema.safeParse({ ...body, uptimeS: -1 }).success).toBe(false);
    expect(DisplayHeartbeatRequestSchema.safeParse({ version: '1.0.0' }).success).toBe(false);
  });

  it('answers the pending command and the update on offer', () => {
    const update = { version: '1.3.0', sha256: 'a'.repeat(64), size: 1000 };
    expect(DisplayHeartbeatResponseSchema.parse({ command: 'reboot', commandSeq: 2, update })).toEqual({
      command: 'reboot',
      commandSeq: 2,
      update,
    });
    expect(DisplayHeartbeatResponseSchema.safeParse({ command: 'spegni', commandSeq: 2 }).success).toBe(false);
  });

  it('offers only a newer X.Y.Z, any different version in other formats', () => {
    expect(displayUpdateWanted('1.2.3', '1.2.4')).toBe(true);
    expect(displayUpdateWanted('1.2.3', '1.10.0')).toBe(true);
    expect(displayUpdateWanted('1.2.3', '2.0.0')).toBe(true);
    expect(displayUpdateWanted('1.2.3', '1.2.3')).toBe(false);
    expect(displayUpdateWanted('1.2.3', '1.2.2')).toBe(false);
    expect(displayUpdateWanted('0.0.0-dev', '1.0.0')).toBe(true);
    expect(displayUpdateWanted('1.0.0+abc', '1.0.0+abc')).toBe(false);
  });
});

describe('socket of the player', () => {
  it('takes the token in the first message and sends standby and command besides the live messages', () => {
    expect(DisplayAuthMessageSchema.parse({ type: 'auth', token: TOKEN })).toEqual({ type: 'auth', token: TOKEN });
    expect(DisplayAuthMessageSchema.safeParse({ type: 'auth', token: TOKEN, x: 1 }).success).toBe(false);
    for (const m of [
      { type: 'standby', tenantName: 'Club', displayName: 'Tribuna' },
      { type: 'command', command: 'reload', commandSeq: 3 },
      { type: 'noMatch' },
      { type: 'config' },
    ])
      expect(DisplaySocketMessageSchema.parse(m)).toEqual(m);
    expect(DisplaySocketMessageSchema.safeParse({ type: 'command', command: 'reboot', commandSeq: 3 }).success).toBe(
      false,
    );
  });
});

describe('image of the SD card', () => {
  it('describes the file on offer, or its absence', async () => {
    const { PlayerImageInfoSchema, playerImageFileName } = await import('./index.js');
    expect(playerImageFileName('0.1.0', 'xz')).toBe('arenalive-player-0.1.0.img.xz');
    expect(playerImageFileName('0.2.0', 'gz')).toBe('arenalive-player-0.2.0.img.gz');
    expect(PlayerImageInfoSchema.parse({ available: false })).toEqual({ available: false });
    const info = {
      available: true,
      version: '0.1.0',
      builtAt: '2026-10-26T10:00:00.000Z',
      bytes: 1,
      sha256: 'a'.repeat(64),
      sha256Of: 'file',
      fileName: 'arenalive-player-0.1.0.img.xz',
      ready: false,
    };
    expect(PlayerImageInfoSchema.parse(info)).toEqual(info);
    expect(PlayerImageInfoSchema.safeParse({ ...info, sha256: 'x' }).success).toBe(false);
  });

  const part = (n: number) => ({ file: `arenalive-player-image-${n}.gz`, size: 10, sha256: 'b'.repeat(64) });
  const manifest = {
    format: 2,
    version: '0.2.0',
    builtAt: '2026-10-26T10:00:00.000Z',
    imageSize: 65536,
    imageSha256: 'a'.repeat(64),
    slotOffset: 4096,
    slotSize: 8192,
    parts: [part(1), part(2), part(3)],
  };

  it('reads the manifest of the three parts', async () => {
    const { PlayerImageManifestSchema } = await import('./index.js');
    expect(PlayerImageManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('refuses other names of the parts, a slot out of a sector or of the image, another slot size', async () => {
    const { PlayerImageManifestSchema } = await import('./index.js');
    const bad = (over: Record<string, unknown>) =>
      PlayerImageManifestSchema.safeParse({ ...manifest, ...over }).success;
    expect(bad({ parts: [part(1), { ...part(2), file: '../../etc/passwd' }, part(3)] })).toBe(false);
    expect(bad({ parts: [part(2), part(1), part(3)] })).toBe(false);
    expect(bad({ parts: [part(1), part(2)] })).toBe(false);
    expect(bad({ slotOffset: 4000 })).toBe(false);
    expect(bad({ slotOffset: 65536 - 4096 })).toBe(false);
    expect(bad({ slotSize: 4096 })).toBe(false);
    expect(bad({ format: 1 })).toBe(false);
  });

  it('names the ready image after the player', async () => {
    const { playerReadyImageFileName } = await import('./index.js');
    expect(playerReadyImageFileName('Maxischermo Tribuna Città', '0.2.0')).toBe(
      'arenalive-player-maxischermo-tribuna-citta-0.2.0.img.gz',
    );
    expect(playerReadyImageFileName('«##»', '0.2.0')).toBe('arenalive-player-player-0.2.0.img.gz');
    expect(playerReadyImageFileName('a'.repeat(100), '1.0.0')).toBe(`arenalive-player-${'a'.repeat(40)}-1.0.0.img.gz`);
  });

  it('gives the ticket of the download and its address', async () => {
    const { DisplayImageTicketSchema, DisplayImageTicketParamSchema, displayImagePath } = await import('./index.js');
    const ticket = { ticket: TOKEN, expiresAt: '2026-10-26T10:10:00.000Z', fileName: 'a.img.gz', size: 5 };
    expect(DisplayImageTicketSchema.parse(ticket)).toEqual(ticket);
    expect(displayImagePath(TOKEN)).toBe(`/api/admin/displays/image/${TOKEN}`);
    expect(DisplayImageTicketParamSchema.safeParse({ ticket: 'x/y' }).success).toBe(false);
  });
});
