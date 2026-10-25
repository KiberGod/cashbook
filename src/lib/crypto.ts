/**
 * Client-side encryption of spreadsheet rows (WebCrypto only, nothing leaves the browser).
 *
 *   key      = PBKDF2-SHA256(password, random 16-byte salt, ITERATIONS) -> AES-256-GCM
 *   cell     = "c1." + base64(iv[12] || ciphertext+tag)
 *   AAD      = sheet name, so a row cannot be moved to another sheet unnoticed
 *
 * The password itself is never stored. To recognise a wrong password, Meta keeps a
 * "check" value - a known text encrypted with the key; GCM authentication fails
 * on any other key.
 */

export const KDF_NAME = 'pbkdf2-sha256';
export const CIPHER_NAME = 'aes-256-gcm';
export const ITERATIONS = 600_000;
const PREFIX = 'c1.';
const CHECK_TEXT = 'cashbook-key-check';
const CHECK_AAD = 'Meta';

export const KEY_RULE = /^[A-Za-z0-9]{4,20}$/;
export const KEY_MIN = 4;
export const KEY_MAX = 20;

export type KeyProblem = 'short' | 'long' | 'chars';

export function checkKeyFormat(key: string): KeyProblem | null {
  if (/[^A-Za-z0-9]/.test(key)) return 'chars';
  if (key.length < KEY_MIN) return 'short';
  if (key.length > KEY_MAX) return 'long';
  return null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export interface KeyParams {
  salt: string;
  iterations: number;
}

export async function deriveKey(password: string, { salt, iterations }: KeyParams): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // never extractable
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(key: CryptoKey, text: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(text)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return PREFIX + toBase64(out);
}

/** Throws on a wrong key, a tampered value or a value that is not ours. */
export async function decryptText(key: CryptoKey, cell: string, aad: string): Promise<string> {
  if (!cell.startsWith(PREFIX)) throw new Error('not encrypted');
  const bytes = fromBase64(cell.slice(PREFIX.length));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: enc.encode(aad) },
    key,
    bytes.subarray(12),
  );
  return dec.decode(pt);
}

export const isEncryptedCell = (v: unknown) => typeof v === 'string' && v.startsWith(PREFIX);

export interface NewKey extends KeyParams {
  key: CryptoKey;
  check: string;
}

/** Fresh salt + derived key + check value for a newly protected spreadsheet. */
export async function createKey(password: string): Promise<NewKey> {
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const params = { salt, iterations: ITERATIONS };
  const key = await deriveKey(password, params);
  return { ...params, key, check: await encryptText(key, CHECK_TEXT, CHECK_AAD) };
}

export async function keyMatches(key: CryptoKey, check: string): Promise<boolean> {
  try {
    return (await decryptText(key, check, CHECK_AAD)) === CHECK_TEXT;
  } catch {
    return false;
  }
}

/** Returns the key when the password matches the spreadsheet, otherwise null. */
export async function unlockKey(password: string, params: KeyParams, check: string): Promise<CryptoKey | null> {
  const key = await deriveKey(password, params);
  return (await keyMatches(key, check)) ? key : null;
}
