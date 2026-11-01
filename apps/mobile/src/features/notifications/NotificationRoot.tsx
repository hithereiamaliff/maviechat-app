import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { shouldPresent } from './presence';

// While the app is open: a banner only when the app won't announce the reply itself.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = shouldPresent((notification.request.content.data as { chatId?: unknown } | null)?.chatId);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

/** Opens the chat a tapped notification is about, from a cold start too. */
export function NotificationRoot() {
  const response = Notifications.useLastNotificationResponse();
  const ready = Boolean(useRootNavigationState()?.key);
  const signedIn = useSession().state.status === 'signed-in';
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !signedIn || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse();
    const chatId = (response.notification.request.content.data as { chatId?: unknown } | null)?.chatId;
    void saveSpace('owui');
    if (typeof chatId === 'string' && chatId) router.replace({ pathname: '/c/[id]', params: { id: chatId } });
    else router.replace('/');
  }, [ready, signedIn, response]);

  return null;
}
