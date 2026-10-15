import { describe, expect, it } from 'vitest';
import {
  AgentRegistrationSummarySchema,
  CreateRegistrationRequestSchema,
  CreateRegistrationResponseSchema,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PairingCodeSchema,
  RegistrationStatusResponseSchema,
} from './index.js';

const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const SECRET = 'a'.repeat(43);
const AT = '2026-10-15T10:00:00.000Z';

describe('pairing code', () => {
  it('has no ambiguous characters', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    for (const c of ['0', 'O', '1', 'I']) expect(PAIRING_CODE_ALPHABET).not.toContain(c);
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(PAIRING_CODE_ALPHABET.length);
  });

  it('accepts 6 characters of the alphabet only', () => {
    expect(PAIRING_CODE_LENGTH).toBe(6);
    expect(PairingCodeSchema.safeParse('K7M2QX').success).toBe(true);
    for (const bad of ['K7M2Q', 'K7M2QXA', 'k7m2qx', 'K7M2Q0', 'K7M2QI', 'K7M 2Q']) {
      expect(PairingCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('CreateRegistrationRequestSchema', () => {
  it('trims the name and rejects empty, long and control characters', () => {
    expect(CreateRegistrationRequestSchema.parse({ name: '  PC palestra ' })).toEqual({ name: 'PC palestra' });
    for (const name of ['', '   ', 'x'.repeat(101), 'pc\r\nX-Evil: 1', 'pc\u0000', 'pc\u001b']) {
      expect(CreateRegistrationRequestSchema.safeParse({ name }).success).toBe(false);
    }
    expect(CreateRegistrationRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('CreateRegistrationResponseSchema', () => {
  it('validates the answer of the server', () => {
    const ok = { registrationId: ID, secret: SECRET, pairingCode: 'ABC234', expiresAt: AT };
    expect(CreateRegistrationResponseSchema.safeParse(ok).success).toBe(true);
    expect(CreateRegistrationResponseSchema.safeParse({ ...ok, secret: 'corto' }).success).toBe(false);
    expect(CreateRegistrationResponseSchema.safeParse({ ...ok, registrationId: 'x' }).success).toBe(false);
  });
});

describe('RegistrationStatusResponseSchema', () => {
  it('accepts every state', () => {
    for (const s of [
      { status: 'pending', expiresAt: AT },
      { status: 'approved', token: SECRET, agentId: ID },
      { status: 'consumed' },
      { status: 'rejected' },
      { status: 'expired' },
    ]) {
      expect(RegistrationStatusResponseSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an approval without token and unknown states', () => {
    expect(RegistrationStatusResponseSchema.safeParse({ status: 'approved', agentId: ID }).success).toBe(false);
    expect(RegistrationStatusResponseSchema.safeParse({ status: 'other' }).success).toBe(false);
  });
});

describe('AgentRegistrationSummarySchema', () => {
  it('validates a request seen by the admin', () => {
    const row = {
      id: ID,
      name: 'PC palestra',
      pairingCode: 'ABC234',
      ip: '192.168.1.10',
      createdAt: AT,
      expiresAt: AT,
      status: 'pending',
    };
    expect(AgentRegistrationSummarySchema.safeParse(row).success).toBe(true);
    expect(AgentRegistrationSummarySchema.safeParse({ ...row, ip: null }).success).toBe(true);
    expect(AgentRegistrationSummarySchema.safeParse({ ...row, status: 'expired' }).success).toBe(false);
  });
});
