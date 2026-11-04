import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';

/*
 * Settings kept on this iPhone rather than with an account: the Read Aloud voice (voices differ
 * from device to device, so one picked here means nothing to a browser), and DeepTutor's Read Aloud
 * speed and auto-playback (DeepTutor keeps no such settings of its own). Open WebUI's speed and
 * auto-playback are saved with your Open WebUI account, as on the web.
 */

export interface ChosenVoice {
  identifier: string;
  name: string;
  /** BCP 47, like `en-GB`. */
  language: string;
}

export interface DevicePrefs {
  /** Null: the phone's own voice for each reply's language. */
  voice: ChosenVoice | null;
  deepTutorRate: number;
  deepTutorAutoPlay: boolean;
}

const KEY = 'maviechat.device-prefs';
const DEFAULTS: DevicePrefs = { voice: null, deepTutorRate: 1, deepTutorAutoPlay: false };
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let prefs: DevicePrefs = DEFAULTS;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

function parse(raw: string | null): DevicePrefs {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<DevicePrefs>;
    const voice = value.voice && typeof value.voice.identifier === 'string' && typeof value.voice.language === 'string' ? { identifier: value.voice.identifier, name: String(value.voice.name ?? ''), language: value.voice.language } : null;
    const rate = Number(value.deepTutorRate);
    return { voice, deepTutorRate: Number.isFinite(rate) && rate > 0 ? rate : 1, deepTutorAutoPlay: value.deepTutorAutoPlay === true };
  } catch {
    return DEFAULTS;
  }
}

// Read once at start-up. A voice that's gone from the phone (deleted in iOS Settings) is
// forgotten: speaking with it would fail without a word.
void SecureStore.getItemAsync(KEY, options)
  .then(async (raw) => {
    const stored = parse(raw);
    if (stored.voice) {
      const voices = await Speech.getAvailableVoicesAsync().catch(() => null);
      if (voices && !voices.some((voice) => voice.identifier === stored.voice?.identifier)) stored.voice = null;
    }
    prefs = stored;
    emit();
  })
  .catch(() => undefined);

export function devicePrefs(): DevicePrefs {
  return prefs;
}

export function setDevicePrefs(change: Partial<DevicePrefs>): void {
  prefs = { ...prefs, ...change };
  emit();
  void SecureStore.setItemAsync(KEY, JSON.stringify(prefs), options).catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDevicePrefs(): DevicePrefs {
  return useSyncExternalStore(subscribe, devicePrefs);
}
