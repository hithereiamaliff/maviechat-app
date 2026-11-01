import * as SecureStore from 'expo-secure-store';
import { parseStoredSession, type StoredSession } from './stored-session';

const SESSION_KEY = 'maviechat.session';
const LAST_SERVER_KEY = 'maviechat.lastServerUrl';

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
