import {
  deleteNotificationTarget,
  OwuiHttpError,
  saveWebhookTarget,
  testNotificationTarget,
  uuidv4,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import type { StoredSession } from '@/session/stored-session';
import { registerWithRelay, targetIdFor } from './relay';

/** What this phone did about notifications, kept on the device. */
export interface PushState {
  version: 1;
  /** Random, per install: names this phone's notification target in Open WebUI. */
  deviceId: string;
  enabled: boolean;
  /** iOS's permission prompt was shown once already (it can't be shown again). */
  asked: boolean;
  /** The Open WebUI account the target was saved in. */
  userId: string | null;
}

export type PushStatus = 'on' | 'off' | 'blocked';

const KEY = 'maviechat.push';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let state: PushState | null = null;
const listeners = new Set<() => void>();

async function loadState(): Promise<PushState> {
  if (state) return state;
  try {
    const stored = JSON.parse((await SecureStore.getItemAsync(KEY, options)) ?? 'null') as PushState | null;
    if (stored?.version === 1 && typeof stored.deviceId === 'string') state = stored;
  } catch {
    // a damaged entry starts over
  }
  state ??= { version: 1, deviceId: uuidv4(), enabled: false, asked: false, userId: null };
  return state;
}

async function saveState(next: PushState): Promise<void> {
  state = next;
  await SecureStore.setItemAsync(KEY, JSON.stringify(next), options);
  for (const listener of listeners) listener();
}

/** The saved state for screens (null until it has loaded). */
export function usePushState(): PushState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (!state) void loadState().then(() => listener());
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/**
 * Switches notifications on for this phone: iOS permission (asked once), the Expo push
 * token, a webhook link from MavieChat's relay, and a target in your Open WebUI settings
 * for finished and failed replies. Safe to repeat; a repeat refreshes the link.
 */
export async function enablePush(client: OwuiClient, session: StoredSession, { ask }: { ask: boolean }): Promise<PushStatus> {
  const current = await loadState();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && ask && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    await saveState({ ...current, enabled: false, asked: current.asked || ask });
    return 'blocked';
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const { data: pushToken } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {});
  const webhookUrl = await registerWithRelay((input, init) => fetch(input, init), session.token, pushToken);
  await saveWebhookTarget(client, { id: targetIdFor(current.deviceId), url: webhookUrl });
  await saveState({ ...current, enabled: true, asked: true, userId: session.user.id });
  return 'on';
}

/** Removes this phone's target from Open WebUI. Also called before signing out. */
export async function disablePush(client: OwuiClient): Promise<void> {
  const current = await loadState();
  if (current.enabled) {
    try {
      await deleteNotificationTarget(client, targetIdFor(current.deviceId));
    } catch (error) {
      // Already gone is fine; anything else is reported.
      if (!(error instanceof OwuiHttpError && error.status === 404)) throw error;
    }
  }
  await saveState({ ...current, enabled: false, userId: null });
}

/** Has Open WebUI send this phone a test notification through the whole chain. */
export async function sendTestPush(client: OwuiClient): Promise<void> {
  await testNotificationTarget(client, targetIdFor((await loadState()).deviceId));
}

/** First launch with an account: ask once and switch on. Later launches refresh the link quietly. */
export async function setUpPushOnLaunch(client: OwuiClient, session: StoredSession): Promise<void> {
  const current = await loadState();
  if (current.enabled && current.userId && current.userId !== session.user.id) {
    // Another account signed in on this phone: it gets its own target.
    await saveState({ ...current, enabled: false, userId: null });
    await enablePush(client, session, { ask: false });
    return;
  }
  if (!current.asked) await enablePush(client, session, { ask: true });
  else if (current.enabled) await enablePush(client, session, { ask: false });
}
