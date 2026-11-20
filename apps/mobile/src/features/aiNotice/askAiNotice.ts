import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { AI_NOTICE_TITLE, parseAccepted, type AiNotice } from './notice';

// The servers (and OpenCode logins) whose notice was accepted on this phone. Not a secret, but kept
// with the app's other settings on this device, and never moved to another one.
const KEY = 'maviechat.ai-notice';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let accepted: Promise<Set<string>> | null = null;
// Two sends at once (a message and its upload) share one question.
const asking = new Map<string, Promise<boolean>>();

function acceptedKeys(): Promise<Set<string>> {
  accepted ??= SecureStore.getItemAsync(KEY, options).then(parseAccepted, () => new Set<string>());
  return accepted;
}

/**
 * Before the first message or file goes to a server: says where it goes (see notice.ts) and
 * asks. True once accepted, now or before; false for Not Now (or a tap outside on Android),
 * and then nothing should be sent.
 */
export async function askAiNotice(notice: AiNotice): Promise<boolean> {
  const keys = await acceptedKeys();
  if (keys.has(notice.key)) return true;
  const open = asking.get(notice.key);
  if (open) return open;
  const answer = new Promise<boolean>((resolve) => {
    Alert.alert(
      AI_NOTICE_TITLE,
      notice.message,
      [
        { text: 'Not Now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  })
    .then((yes) => {
      if (yes) {
        keys.add(notice.key);
        void SecureStore.setItemAsync(KEY, JSON.stringify([...keys]), options).catch(() => undefined);
      }
      return yes;
    })
    .finally(() => asking.delete(notice.key));
  asking.set(notice.key, answer);
  return answer;
}
