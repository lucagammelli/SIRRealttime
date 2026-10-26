import { describe, expect, it } from 'vitest';
import { DISPLAY_TOKEN_KEY, displayAuthMessage, displayTokenOfHash, readDisplayToken } from './displayToken.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('token of the page /schermo', () => {
  it('reads only a token-shaped fragment', () => {
    expect(displayTokenOfHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(displayTokenOfHash('')).toBeNull();
    expect(displayTokenOfHash('#corto')).toBeNull();
    expect(displayTokenOfHash(`#${TOKEN}&x=1`)).toBeNull();
  });

  it('keeps the token of the fragment and reads it again after a reload without fragment', () => {
    const storage = memoryStorage();
    expect(readDisplayToken(`#${TOKEN}`, storage)).toBe(TOKEN);
    expect(storage.data.get(DISPLAY_TOKEN_KEY)).toBe(TOKEN);
    expect(readDisplayToken('', storage)).toBe(TOKEN);
  });

  it('prefers a new fragment, refuses a broken kept value and survives a storage that throws', () => {
    const storage = memoryStorage({ [DISPLAY_TOKEN_KEY]: 'x'.repeat(30) });
    const other = `${TOKEN.slice(0, -1)}Z`;
    expect(readDisplayToken(`#${other}`, storage)).toBe(other);
    expect(readDisplayToken('', memoryStorage({ [DISPLAY_TOKEN_KEY]: 'no!' }))).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readDisplayToken(`#${TOKEN}`, broken)).toBe(TOKEN);
    expect(readDisplayToken('', broken)).toBeNull();
    expect(readDisplayToken('', null)).toBeNull();
  });

  it('sends the token in the auth message', () => {
    expect(JSON.parse(displayAuthMessage(TOKEN))).toEqual({ type: 'auth', token: TOKEN });
  });
});
