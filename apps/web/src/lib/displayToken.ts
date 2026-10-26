import { DisplayTokenSchema } from '@arenalive/shared';

/** Key of `sessionStorage` where the page of a player keeps its token across reloads. */
export const DISPLAY_TOKEN_KEY = 'arenalive-player-token';

/** Pure: the token of a player in the fragment of the address (`#<token>`), or null. */
export function displayTokenOfHash(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  return DisplayTokenSchema.safeParse(value).success ? value : null;
}

/** Storage as far as the page uses it (`sessionStorage`, or a fake in the tests). */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Token of the page `/schermo`: the one of the fragment (kept in `storage`, which may be missing or refuse: private
 * mode, quota), otherwise the one kept by an earlier load of the same tab (the fragment is removed from the address
 * after the first load), otherwise null.
 */
export function readDisplayToken(hash: string, storage: TokenStorage | null): string | null {
  const fromHash = displayTokenOfHash(hash);
  if (fromHash) {
    try {
      storage?.setItem(DISPLAY_TOKEN_KEY, fromHash);
    } catch {
      // Not kept: a reload of the page without the fragment shows «Player non valido».
    }
    return fromHash;
  }
  let kept: string | null;
  try {
    kept = storage?.getItem(DISPLAY_TOKEN_KEY) ?? null;
  } catch {
    kept = null;
  }
  return kept !== null && DisplayTokenSchema.safeParse(kept).success ? kept : null;
}

/** `sessionStorage` when the browser lets the page use it, otherwise null. */
export function sessionStorageOrNull(): TokenStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Message `auth` sent as the first message of `/ws/display`. */
export const displayAuthMessage = (token: string): string => JSON.stringify({ type: 'auth', token });
