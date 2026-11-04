/*
 * The accounts each space keeps (M7): several Open WebUI and DeepTutor sign-ins, one of them in
 * use per space. This is the list the app shows; each account's sign-in (with its token) sits in
 * its own Keychain item, apart from it. Pure functions here; storage.ts reads and writes them.
 */

/** Which space an account belongs to. */
export type AccountSpace = 'owui' | 'deeptutor';

export interface AccountEntry {
  id: string;
  space: AccountSpace;
  baseUrl: string;
  /** The server's id for the user. */
  userId: string;
  /** Shown first: the person's name in Open WebUI, the username in DeepTutor. */
  name: string;
  /** What you sign in with (Open WebUI's email, DeepTutor's username), to fill in the sign-in form again. */
  login: string;
  /** Unix seconds when the sign-in stops working; null when it doesn't expire or can't be read. */
  expiresAt: number | null;
  /** False once the sign-in expired or was refused: the account needs its password again. */
  signedIn: boolean;
  /** Unix milliseconds. */
  addedAt: number;
}

export interface AccountIndex {
  version: 1;
  accounts: AccountEntry[];
  /** The account in use in each space. */
  active: Partial<Record<AccountSpace, string>>;
  /** Spaces whose single sign-in from before accounts has been moved in. */
  migrated: AccountSpace[];
}

/** More than enough for one person; keeps the Keychain tidy. */
export const MAX_ACCOUNTS_PER_SPACE = 20;

export const emptyIndex = (): AccountIndex => ({ version: 1, accounts: [], active: {}, migrated: [] });

const SPACES: AccountSpace[] = ['owui', 'deeptutor'];
const isSpace = (value: unknown): value is AccountSpace => SPACES.includes(value as AccountSpace);

function parseEntry(value: unknown): AccountEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Partial<AccountEntry>;
  if (
    typeof entry.id !== 'string' ||
    !isSpace(entry.space) ||
    typeof entry.baseUrl !== 'string' ||
    typeof entry.userId !== 'string' ||
    typeof entry.name !== 'string' ||
    typeof entry.login !== 'string' ||
    !(entry.expiresAt === null || typeof entry.expiresAt === 'number') ||
    typeof entry.signedIn !== 'boolean' ||
    typeof entry.addedAt !== 'number'
  ) {
    return null;
  }
  return entry as AccountEntry;
}

/** The saved list, or null when there is none yet (or it can't be read). */
export function parseAccountIndex(raw: string | null): AccountIndex | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== 1) return null;
  const value = data as { accounts?: unknown; active?: unknown; migrated?: unknown };
  const accounts = Array.isArray(value.accounts) ? value.accounts.map(parseEntry).filter((entry): entry is AccountEntry => entry !== null) : [];
  const active: AccountIndex['active'] = {};
  if (typeof value.active === 'object' && value.active !== null) {
    for (const [space, id] of Object.entries(value.active)) {
      if (isSpace(space) && typeof id === 'string' && accounts.some((entry) => entry.id === id && entry.space === space)) active[space] = id;
    }
  }
  const migrated = Array.isArray(value.migrated) ? value.migrated.filter(isSpace) : [];
  return { version: 1, accounts, active, migrated };
}

/** A space's accounts, in the order they were added. */
export function accountsIn(index: AccountIndex, space: AccountSpace): AccountEntry[] {
  return index.accounts.filter((entry) => entry.space === space).sort((a, b) => a.addedAt - b.addedAt);
}

export function activeAccount(index: AccountIndex, space: AccountSpace): AccountEntry | null {
  const id = index.active[space];
  return (id && index.accounts.find((entry) => entry.id === id && entry.space === space)) || null;
}

/** Addresses written differently (case, a trailing slash) still name the same server. */
const sameServer = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

export type AccountFields = Omit<AccountEntry, 'id' | 'addedAt'>;

/**
 * Adds an account, or updates the one for the same person on the same server (keeping its id and
 * place in the list), and makes it the one in use. Past the limit, the oldest signed-out account goes.
 */
export function putAccount(index: AccountIndex, fields: AccountFields, newId: () => string, nowMs: number): { index: AccountIndex; id: string } {
  const existing = index.accounts.find((entry) => entry.space === fields.space && entry.userId === fields.userId && sameServer(entry.baseUrl, fields.baseUrl));
  const id = existing?.id ?? newId();
  const entry: AccountEntry = { ...fields, id, addedAt: existing?.addedAt ?? nowMs };
  let accounts = existing ? index.accounts.map((item) => (item.id === id ? entry : item)) : [...index.accounts, entry];
  const inSpace = accounts.filter((item) => item.space === fields.space);
  if (inSpace.length > MAX_ACCOUNTS_PER_SPACE) {
    const spare = inSpace.filter((item) => item.id !== id && !item.signedIn).sort((a, b) => a.addedAt - b.addedAt)[0];
    if (spare) accounts = accounts.filter((item) => item.id !== spare.id);
  }
  return { index: { ...index, accounts, active: { ...index.active, [fields.space]: id } }, id };
}

export function setActive(index: AccountIndex, space: AccountSpace, id: string | null): AccountIndex {
  const active = { ...index.active };
  if (id && index.accounts.some((entry) => entry.id === id && entry.space === space)) active[space] = id;
  else delete active[space];
  return { ...index, active };
}

/** The account needs its password again (expired, refused, or signed out elsewhere). */
export function markSignedOut(index: AccountIndex, id: string): AccountIndex {
  return { ...index, accounts: index.accounts.map((entry) => (entry.id === id ? { ...entry, signedIn: false } : entry)) };
}

/**
 * Forgets an account. When it was the one in use, the most recently added account still signed
 * in takes over (or none).
 */
export function dropAccount(index: AccountIndex, id: string): { index: AccountIndex; wasActive: boolean; next: AccountEntry | null } {
  const entry = index.accounts.find((item) => item.id === id);
  if (!entry) return { index, wasActive: false, next: null };
  const accounts = index.accounts.filter((item) => item.id !== id);
  const wasActive = index.active[entry.space] === id;
  if (!wasActive) return { index: { ...index, accounts }, wasActive, next: null };
  const next = accounts.filter((item) => item.space === entry.space && item.signedIn).sort((a, b) => b.addedAt - a.addedAt)[0] ?? null;
  return { index: setActive({ ...index, accounts }, entry.space, next?.id ?? null), wasActive, next };
}

/** The server's host, for telling accounts apart ("chat.example.com"). */
export function serverHost(baseUrl: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(baseUrl.trim());
  return (match?.[1] ?? baseUrl).replace(/^[^@]*@/, '');
}
