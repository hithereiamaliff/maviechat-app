import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/** The web app's theme choices (General settings). Kept on this device, as the web keeps it per browser. */
export type ThemePreference = 'system' | 'dark' | 'oled' | 'light';

export const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED Dark' },
  { value: 'light', label: 'Light' },
];

const KEY = 'maviechat.theme';
let current: ThemePreference = 'system';
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'oled' || value === 'light';
}

// Overriding the app's appearance also turns alerts, keyboards and switches dark or light.
function apply(preference: ThemePreference) {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference === 'light' ? 'light' : 'dark');
  for (const listener of listeners) listener();
}

/** Applies the saved theme; the root layout waits for it so the first frame is already right. */
export async function loadThemePreference(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (isPreference(stored) && stored !== current) {
      current = stored;
      apply(stored);
    }
  } catch {
    // Unreadable (e.g. before the first unlock): follow the system.
  }
}

export function setThemePreference(next: ThemePreference): void {
  current = next;
  apply(next);
  SecureStore.setItemAsync(KEY, next).catch(() => {});
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
