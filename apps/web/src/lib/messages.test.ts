import { describe, expect, it } from 'vitest';
import { midMatchState } from '../test/fixtures.ts';
import { looksLikeMatchState, parseServerMessage } from './messages.ts';

const MATCH_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';

describe('parseServerMessage', () => {
  it('accepts the three server messages, as text or as objects', () => {
    const state = midMatchState();
    const msg = parseServerMessage(JSON.stringify({ type: 'state', matchId: MATCH_ID, version: 3, state }));
    expect(msg?.type).toBe('state');
    expect(parseServerMessage({ type: 'noMatch' })).toEqual({ type: 'noMatch' });
    expect(parseServerMessage({ type: 'error', message: 'Errore interno' })).toEqual({
      type: 'error',
      message: 'Errore interno',
    });
  });

  it('rejects malformed frames', () => {
    expect(parseServerMessage('{not json')).toBeNull();
    expect(parseServerMessage({ type: 'state', matchId: 'x', version: 1, state: {} })).toBeNull();
    expect(parseServerMessage({ type: 'state', matchId: MATCH_ID, version: -1, state: {} })).toBeNull();
    expect(parseServerMessage({ type: 'state', matchId: MATCH_ID, version: 1, state: null })).toBeNull();
    expect(parseServerMessage({ type: 'other' })).toBeNull();
    expect(parseServerMessage(42)).toBeNull();
  });
});

describe('looksLikeMatchState', () => {
  it('accepts a computed state and rejects other objects', () => {
    expect(looksLikeMatchState(midMatchState())).toBe(true);
    expect(looksLikeMatchState({ sets: [] })).toBe(false);
    expect(looksLikeMatchState(null)).toBe(false);
  });
});
