import { isExpiring, type Session } from '@maviechat/owui-protocol';

/** What the app keeps in the Keychain. Permissions are fetched fresh after launch, not stored. */
export interface StoredSession {
  version: 1;
  baseUrl: string;
  token: string;
  user: { id: string; name: string; email: string; role: string };
  /** Unix seconds; null when the server's tokens never expire. */
  expiresAt: number | null;
}

export function toStoredSession(baseUrl: string, session: Session): StoredSession {
  return {
    version: 1,
    baseUrl,
    token: session.token,
    user: { id: session.id, name: session.name, email: session.email, role: session.role },
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at : null,
  };
}

export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const value = data as Partial<StoredSession>;
  const user = value.user as Partial<StoredSession['user']> | undefined;
  if (
    value.version !== 1 ||
    typeof value.baseUrl !== 'string' ||
    typeof value.token !== 'string' ||
    !user ||
    typeof user.id !== 'string' ||
    typeof user.name !== 'string' ||
    typeof user.email !== 'string' ||
    typeof user.role !== 'string' ||
    !(value.expiresAt === null || typeof value.expiresAt === 'number')
  ) {
    return null;
  }
  return value as StoredSession;
}

/** A stored session is usable until a minute before its token expires. */
export function isUsable(stored: StoredSession, nowMs: number): boolean {
  return !isExpiring(stored.expiresAt, nowMs, 60);
}
