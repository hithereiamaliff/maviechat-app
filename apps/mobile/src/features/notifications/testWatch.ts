import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

/** 'left': you switched away first, and iOS shows the notification on its own. */
export type TestOutcome = 'arrived' | 'left' | 'missing';

export interface TestWatch {
  outcome: Promise<TestOutcome>;
  stop(): void;
}

/**
 * Waits for the test notification to reach the app. Start it before sending: the notification
 * can land before the relay has answered.
 */
export function watchForTest(timeoutMs = 20_000): TestWatch {
  const cleanups: (() => void)[] = [];
  let settle: (outcome: TestOutcome) => void = () => undefined;
  const outcome = new Promise<TestOutcome>((resolve) => {
    settle = resolve;
  });
  const finish = (result: TestOutcome) => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    settle(result);
  };

  const received = Notifications.addNotificationReceivedListener((notification) => {
    if ((notification.request.content.data as { kind?: unknown } | null)?.kind === 'test') finish('arrived');
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'background') finish('left');
  });
  const timer = setTimeout(() => finish('missing'), timeoutMs);
  cleanups.push(
    () => received.remove(),
    () => appState.remove(),
    () => clearTimeout(timer),
  );
  return { outcome, stop: () => finish('left') };
}
