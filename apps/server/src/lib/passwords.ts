import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id } as const;
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

/** Verifies a password; without a hash it still runs a verification, so that a missing user takes the same time. */
export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  if (hash === undefined) {
    dummyHash ??= argon2.hash('sir-dummy-password', OPTIONS);
    await argon2.verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
