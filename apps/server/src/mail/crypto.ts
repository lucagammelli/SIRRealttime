import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Version tag of the stored format: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Pure: the 32-byte key of SETTINGS_ENCRYPTION_KEY (base64 or base64url); null when it is not exactly 32 bytes. */
export function decodeEncryptionKey(text: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text.trim())) return null;
  const key = Buffer.from(text.trim(), 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/** AES-256-GCM: a fresh random IV for every encryption, the authentication tag is stored with the text. */
export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

/** Decrypts `encryptSecret`; null when the text is damaged or the key is not the one that encrypted it. */
export function decryptSecret(key: Buffer, stored: string): string | null {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
