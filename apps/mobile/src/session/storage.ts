import * as SecureStore from 'expo-secure-store';
import { parseStoredDtSession, type StoredDtSession } from './deeptutor-session';
import { parseStoredSession, type StoredSession } from './stored-session';

const SESSION_KEY = 'maviechat.session';
const LAST_SERVER_KEY = 'maviechat.lastServerUrl';
const DT_SESSION_KEY = 'maviechat.deeptutor.session';
const DT_LAST_SERVER_KEY = 'maviechat.deeptutor.lastServerUrl';
const SPACE_KEY = 'maviechat.space';

// Keychain items stay on this device (no iCloud Keychain sync) and are readable after the first unlock.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

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
