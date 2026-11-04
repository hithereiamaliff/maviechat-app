import { deleteNotificationTarget, uuidv4, type OwuiClient } from '@maviechat/owui-protocol';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import type { StoredSession } from '@/session/stored-session';
import { isRelayServer, legacyTargetId, registerWithRelay, testThroughRelay, unregisterFromRelay, type RelayAnswer } from './relay';

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
 * True when finished replies reach this iPhone as push notifications: switched on here, the
 * phone has a place in the relay under the Open WebUI account, and Open WebUI's server-wide
 * webhook has reported to the relay.
 */
export function pushAnnouncesReplies(): boolean {
  return Boolean(state?.enabled && state.userId && state.lastEventAt != null);
}

/** The Open WebUI account, when the relay serves its server (other servers' sign-ins never go to the relay). */
const relayAccount = (owui: OwuiAccount | null): OwuiAccount | null => (owui && isRelayServer('owui', owui.session.baseUrl) ? owui : null);

let freshToken: Promise<string | null> | null = null;

/**
 * This phone's push token while notifications are on, else null. Loads the saved state itself
 * (a launch straight into DeepTutor never opens Open WebUI's side, which loads it otherwise),
 * and asks iOS for the current token once per launch, in case it changed.
 */
export async function pushTokenIfOn(): Promise<string | null> {
  const current = await loadState();
  if (!current.enabled) return null;
  freshToken ??= expoPushToken().catch(() => null);
  return (await freshToken) ?? current.pushToken ?? null;
}

async function expoPushToken(): Promise<string> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})).data;
}

/** A signed-in Open WebUI account, for the parts of notifications that go through it. */
export interface OwuiAccount {
  client: OwuiClient;
  session: StoredSession;
}

/**
 * Switches notifications on for this phone: iOS permission (asked once) and the Expo push token.
 * With an Open WebUI account on a server the relay serves, the phone also takes a place in the
 * relay under it, and Open WebUI's server-wide webhook then reports every finished or failed
 * reply. DeepTutor needs nothing more: each of its replies is handed to the relay as it starts,
 * with this token. Safe to repeat.
 */
export async function enablePush(owuiAccount: OwuiAccount | null, { ask }: { ask: boolean }): Promise<PushStatus> {
  const owui = relayAccount(owuiAccount);
  const current = await loadState();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && ask && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    await saveState({ ...current, enabled: false, asked: current.asked || ask });
    return 'blocked';
  }
  const pushToken = await expoPushToken();
  if (!owui) {
    await saveState({ ...current, enabled: true, asked: true, pushToken, userId: null, lastEventAt: null });
    return 'on';
  }
  const answer: RelayAnswer = await registerWithRelay(relayFetch, owui.session.token, pushToken);
  if (!current.legacyCleaned) {
    // The per-user webhook of earlier versions would now notify twice.
    await deleteNotificationTarget(owui.client, legacyTargetId(current.deviceId)).catch(() => undefined);
  }
  await saveState({
    ...current,
    enabled: true,
    asked: true,
    userId: owui.session.user.id,
    pushToken,
    lastEventAt: answer.lastEventAt,
    legacyCleaned: true,
  });
  return 'on';
}

/** Whether the relay serves this Open WebUI sign-in's server. */
const servedSession = (session: StoredSession | null): session is StoredSession => session !== null && isRelayServer('owui', session.baseUrl);

/** Switches notifications off on this phone, taking it off the relay for the Open WebUI account first. */
export async function disablePush(owuiSession: StoredSession | null): Promise<void> {
  const current = await loadState();
  if (servedSession(owuiSession) && current.enabled && current.pushToken) await unregisterFromRelay(relayFetch, owuiSession.token, current.pushToken);
  await saveState({ ...current, enabled: false, userId: null });
}

/** Before signing out of Open WebUI: that account's replies stop reaching this phone, while DeepTutor's carry on. */
export async function leaveRelay(owuiSession: StoredSession): Promise<void> {
  const current = await loadState();
  if (servedSession(owuiSession) && current.enabled && current.pushToken) await unregisterFromRelay(relayFetch, owuiSession.token, current.pushToken);
  await saveState({ ...current, userId: null });
}

/** A test notification straight from the relay. */
export async function sendTestPush(session: StoredSession): Promise<RelayAnswer> {
  if (!servedSession(session)) throw new Error('notifications work only on servers run by TechMavie Digital');
  const current = await loadState();
  const answer = await testThroughRelay(relayFetch, session.token, current.pushToken ?? (await expoPushToken()));
  await saveState({ ...current, lastEventAt: answer.lastEventAt });
  return answer;
}

/**
 * First launch in either space: ask once and switch on, when a signed-in server is one the relay
 * serves (elsewhere notifications can't work, so the app doesn't ask). Later launches refresh the
 * token and registration quietly.
 */
export async function setUpPushOnLaunch(owui: OwuiAccount | null, deepTutorBaseUrl: string | null): Promise<void> {
  const served = relayAccount(owui);
  let current = await loadState();
  // Signed in to another server now: the phone's place under an earlier account doesn't apply here.
  if (!served && current.userId) {
    current = { ...current, userId: null, lastEventAt: null };
    await saveState(current);
  }
  if (!served && !(deepTutorBaseUrl && isRelayServer('deeptutor', deepTutorBaseUrl))) return;
  if (!current.asked) await enablePush(served, { ask: true });
  else if (current.enabled) await enablePush(served, { ask: false });
}
