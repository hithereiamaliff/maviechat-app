import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** What a webhook link carries: where to push, and whose Open WebUI account set it up. */
export interface Sealed {
  pushToken: string;
  userId: string;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The relay's key: 32 bytes, base64. Losing it only means phones register again. */
export function loadKey(base64: string | undefined): Buffer {
  const key = Buffer.from(base64 ?? '', 'base64');
  if (key.length !== 32) throw new Error('RELAY_KEY must be 32 random bytes, base64-encoded');
  return key;
}

/** Seals the push address into an opaque, tamper-proof link segment (AES-256-GCM, base64url). */
export function seal(key: Buffer, value: Sealed): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ t: value.pushToken, u: value.userId }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

/** The sealed value, or null for anything this key didn't seal. */
export function unseal(key: Buffer, sealed: string): Sealed | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString('utf8');
    const data = JSON.parse(text) as { t?: unknown; u?: unknown };
    return typeof data.t === 'string' && typeof data.u === 'string' ? { pushToken: data.t, userId: data.u } : null;
  } catch {
    return null;
  }
}
