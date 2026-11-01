import { tokenExpiry, type DtAccount } from '@maviechat/deeptutor-protocol';

/** The DeepTutor sign-in the app keeps in the Keychain, apart from the Open WebUI one. */
export interface StoredDtSession {
  version: 1;
  baseUrl: string;
  token: string;
  account: { userId: string; username: string; role: string; isAdmin: boolean };
  /** Unix seconds, from the token; null if it can't be read. */
  expiresAt: number | null;
}

export function toStoredDtSession(baseUrl: string, token: string, account: DtAccount): StoredDtSession {
  return {
    version: 1,
    baseUrl,
    token,
    account: { userId: account.user_id, username: account.username, role: account.role, isAdmin: account.is_admin },
    expiresAt: tokenExpiry(token),
  };
}

export function parseStoredDtSession(raw: string | null): StoredDtSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const value = data as Partial<StoredDtSession>;
  const account = value.account as Partial<StoredDtSession['account']> | undefined;
  if (
    value.version !== 1 ||
    typeof value.baseUrl !== 'string' ||
    typeof value.token !== 'string' ||
    !account ||
    typeof account.username !== 'string' ||
    typeof account.role !== 'string' ||
    !(value.expiresAt === null || typeof value.expiresAt === 'number')
  ) {
    return null;
  }
  return value as StoredDtSession;
}

/** Usable until a minute before the token expires (DeepTutor tokens last 30 days on our server). */
export function isDtUsable(stored: StoredDtSession, nowMs: number): boolean {
  return stored.expiresAt === null || stored.expiresAt * 1000 - 60_000 > nowMs;
}
