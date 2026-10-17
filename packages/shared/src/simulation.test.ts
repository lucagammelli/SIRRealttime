import { describe, expect, it } from 'vitest';
import {
  SIMULATION_UPLOAD_MAX_BASE64_LENGTH,
  SimulationCommandParamSchema,
  SimulationResponseSchema,
  StartSimulationRequestSchema,
} from './index.js';

describe('simulation contracts', () => {
  it('accepts the two sources with a duration or a speed', () => {
    const duration = { kind: 'duration', setSeconds: 20, breakSeconds: 10 } as const;
    expect(
      StartSimulationRequestSchema.parse({ source: { kind: 'generated', sets: 5 }, pace: duration }).source,
    ).toEqual({ kind: 'generated', sets: 5, clubTeams: false });
    expect(
      StartSimulationRequestSchema.safeParse({
        source: { kind: 'generated', sets: 4, seed: 7, clubTeams: true },
        pace: { kind: 'speed', speed: 10 },
      }).success,
    ).toBe(true);
    expect(
      StartSimulationRequestSchema.safeParse({
        source: { kind: 'upload', fileName: 'partita.dvw', data: 'WzNTQ09VVF0=' },
        pace: duration,
      }).success,
    ).toBe(true);
  });

  it('refuses sets, speeds and durations out of the limits, and bad uploads', () => {
    const ok = { kind: 'duration', setSeconds: 20, breakSeconds: 10 };
    const bad = (body: unknown) => StartSimulationRequestSchema.safeParse(body).success;
    expect(bad({ source: { kind: 'generated', sets: 2 }, pace: ok })).toBe(false);
    expect(bad({ source: { kind: 'generated', sets: 3 }, pace: { kind: 'speed', speed: 3 } })).toBe(false);
    expect(bad({ source: { kind: 'generated', sets: 3 }, pace: { ...ok, setSeconds: 5 } })).toBe(false);
    expect(bad({ source: { kind: 'generated', sets: 3 }, pace: { ...ok, breakSeconds: -1 } })).toBe(false);
    expect(bad({ source: { kind: 'example', exampleId: 'tre-set' }, pace: ok })).toBe(false);
    expect(bad({ source: { kind: 'upload', fileName: 'a.dvw', data: 'non base64!' }, pace: ok })).toBe(false);
    expect(bad({ source: { kind: 'upload', fileName: 'a\u0001.dvw', data: 'QUJD' }, pace: ok })).toBe(false);
    const huge = 'A'.repeat(SIMULATION_UPLOAD_MAX_BASE64_LENGTH + 4);
    expect(bad({ source: { kind: 'upload', fileName: 'a.dvw', data: huge }, pace: ok })).toBe(false);
  });

  it('knows only the commands of the page', () => {
    expect(SimulationCommandParamSchema.safeParse({ command: 'pause' }).success).toBe(true);
    expect(SimulationCommandParamSchema.safeParse({ command: 'delete' }).success).toBe(false);
  });

  it('reads an answer without a simulation', () => {
    expect(SimulationResponseSchema.parse({ simulation: null, clubTeams: null }).simulation).toBeNull();
  });
});
