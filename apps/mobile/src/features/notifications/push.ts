import { deleteNotificationTarget, uuidv4, type OwuiClient } from '@maviechat/owui-protocol';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import type { StoredSession } from '@/session/stored-session';
import { legacyTargetId, registerWithRelay, testThroughRelay, unregisterFromRelay, type RelayAnswer } from './relay';

/** What this phone did about notifications, kept on the device. */
export interface PushState {
  version: 1;
  /** Random, per install. */
  deviceId: string;
  enabled: boolean;
  /** iOS's permission prompt was shown once already (it can't be shown again). */
  asked: boolean;
  /** The Open WebUI account the phone is registered under, and the token it registered. */
  userId: string | null;
  pushToken?: string | null;
  /** From the relay: when Open WebUI last sent it an event (null: the server-wide webhook isn't set up). */
  lastEventAt?: number | null;
  /** Earlier versions saved a per-user Open WebUI target; it's removed once. */
  legacyCleaned?: boolean;
}

export type PushStatus = 'on' | 'off' | 'blocked';

const KEY = 'maviechat.push';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const relayFetch = (input: string, init?: RequestInit) => fetch(input, init);

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
 * True when finished replies reach this iPhone as push notifications: switched on here, and
 * Open WebUI's server-wide webhook has reported to the relay.
 */
export function pushAnnouncesReplies(): boolean {
  return Boolean(state?.enabled && state.lastEventAt != null);
}

async function expoPushToken(): Promise<string> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})).data;
}

/**
 * Switches notifications on for this phone: iOS permission (asked once), the Expo push token,
 * and a place in MavieChat's relay under your Open WebUI account. Open WebUI's server-wide
 * webhook then reports every finished or failed reply, so any account works. Safe to repeat.
 */
export async function enablePush(client: OwuiClient, session: StoredSession, { ask }: { ask: boolean }): Promise<PushStatus> {
  const current = await loadState();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && ask && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    await saveState({ ...current, enabled: false, asked: current.asked || ask });
    return 'blocked';
  }
  const pushToken = await expoPushToken();
  const answer: RelayAnswer = await registerWithRelay(relayFetch, session.token, pushToken);
  if (!current.legacyCleaned) {
    // The per-user webhook of earlier versions would now notify twice.
    await deleteNotificationTarget(client, legacyTargetId(current.deviceId)).catch(() => undefined);
  }
  await saveState({ ...current, enabled: true, asked: true, userId: session.user.id, pushToken, lastEventAt: answer.lastEventAt, legacyCleaned: true });
  return 'on';
}

/** Takes this phone off the relay for this account. Also called before signing out. */
export async function disablePush(session: StoredSession): Promise<void> {
  const current = await loadState();
  if (current.enabled && current.pushToken) await unregisterFromRelay(relayFetch, session.token, current.pushToken);
  await saveState({ ...current, enabled: false, userId: null });
}

/** A test notification straight from the relay. */
export async function sendTestPush(session: StoredSession): Promise<RelayAnswer> {
  const current = await loadState();
  const answer = await testThroughRelay(relayFetch, session.token, current.pushToken ?? (await expoPushToken()));
  await saveState({ ...current, lastEventAt: answer.lastEventAt });
  return answer;
}

/** First launch with an account: ask once and switch on. Later launches refresh the registration quietly. */
export async function setUpPushOnLaunch(client: OwuiClient, session: StoredSession): Promise<void> {
  const current = await loadState();
  if (!current.asked) await enablePush(client, session, { ask: true });
  else if (current.enabled) await enablePush(client, session, { ask: false });
}
