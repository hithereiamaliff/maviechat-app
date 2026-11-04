import * as SecureStore from 'expo-secure-store';
import { emptyIndex, parseAccountIndex, type AccountIndex } from './accounts';
import { parseStoredDtSession, type StoredDtSession } from './deeptutor-session';
import { parseStoredSession, type StoredSession } from './stored-session';

const ACCOUNTS_KEY = 'maviechat.accounts';
const accountKey = (id: string) => `maviechat.account.${id}`;

const SESSION_KEY = 'maviechat.session';
const LAST_SERVER_KEY = 'maviechat.lastServerUrl';
const DT_SESSION_KEY = 'maviechat.deeptutor.session';
const DT_LAST_SERVER_KEY = 'maviechat.deeptutor.lastServerUrl';
const SPACE_KEY = 'maviechat.space';

// Keychain items stay on this device (no iCloud Keychain sync) and are readable after the first unlock.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The accounts list (no tokens in it), or an empty one. */
export async function loadAccountIndex(): Promise<AccountIndex> {
  return parseAccountIndex(await SecureStore.getItemAsync(ACCOUNTS_KEY, options)) ?? emptyIndex();
}

let indexQueue: Promise<unknown> = Promise.resolve();

/**
 * Changes the accounts list one change at a time, each from a fresh read: both spaces load at
 * launch together, and neither may lose the other's change.
 */
export function updateAccountIndex<T>(change: (index: AccountIndex) => Promise<[AccountIndex, T]> | [AccountIndex, T]): Promise<[AccountIndex, T]> {
  const run = indexQueue.then(async (): Promise<[AccountIndex, T]> => {
    const [next, result] = await change(await loadAccountIndex());
    await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(next), options);
    return [next, result];
  });
  indexQueue = run.catch(() => undefined);
  return run;
}

/** One account's sign-in (its token included), kept apart from the list. */
export function loadAccountSecret(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(accountKey(id), options);
}

export async function saveAccountSecret(id: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(accountKey(id), value, options);
}

export async function deleteAccountSecret(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(accountKey(id), options);
}

/*
 * The single sign-ins from before accounts. They're read once to move them in, and the account in
 * use is still written here, so an update rolled back to an older version stays signed in.
 */
export async function loadSession(): Promise<StoredSession | null> {
  return parseStoredSession(await SecureStore.getItemAsync(SESSION_KEY, options));
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), options);
  await SecureStore.setItemAsync(LAST_SERVER_KEY, session.baseUrl, options);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, options);
}

export function loadLastServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_SERVER_KEY, options);
}

export async function loadDtSession(): Promise<StoredDtSession | null> {
  return parseStoredDtSession(await SecureStore.getItemAsync(DT_SESSION_KEY, options));
}

export async function saveDtSession(session: StoredDtSession): Promise<void> {
  await SecureStore.setItemAsync(DT_SESSION_KEY, JSON.stringify(session), options);
  await SecureStore.setItemAsync(DT_LAST_SERVER_KEY, session.baseUrl, options);
}

export async function clearDtSession(): Promise<void> {
  await SecureStore.deleteItemAsync(DT_SESSION_KEY, options);
}

export function loadLastDtServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(DT_LAST_SERVER_KEY, options);
}

/** Which app was open last, so a launch returns there. */
export type Space = 'owui' | 'deeptutor';

export async function loadSpace(): Promise<Space> {
  return (await SecureStore.getItemAsync(SPACE_KEY, options)) === 'deeptutor' ? 'deeptutor' : 'owui';
}

export async function saveSpace(space: Space): Promise<void> {
  await SecureStore.setItemAsync(SPACE_KEY, space, options);
}
