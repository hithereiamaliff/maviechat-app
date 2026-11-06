import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

/*
 * The system chosen for chats (Open WebUI's terminal servers, see `activeTerminal`), kept on this
 * iPhone for each Open WebUI account, as the web keeps it in each browser. It goes with every
 * message until you change it, and a model that comes with a system picks that one.
 */

const KEY = 'maviechat.owui.terminals';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let chosen: Record<string, string> = {};
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

function parse(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

// Read once at start-up; a choice made before then wins.
void SecureStore.getItemAsync(KEY, options)
  .then((raw) => {
    chosen = { ...parse(raw), ...chosen };
    emit();
  })
  .catch(() => undefined);

/** One Open WebUI account: its server and user. */
export const terminalAccount = (baseUrl: string, userId: string) => `${baseUrl}#${userId}`;

export function chosenTerminal(account: string): string | null {
  return chosen[account] ?? null;
}

/** Null goes back to no system. */
export function chooseTerminal(account: string, id: string | null): void {
  if ((chosen[account] ?? null) === id) return;
  const next = { ...chosen };
  if (id) next[account] = id;
  else delete next[account];
  chosen = next;
  emit();
  void SecureStore.setItemAsync(KEY, JSON.stringify(chosen), options).catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChosenTerminal(account: string): string | null {
  return useSyncExternalStore(subscribe, () => chosen[account] ?? null);
}
