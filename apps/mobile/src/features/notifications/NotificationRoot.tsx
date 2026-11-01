import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { shouldPresent } from './presence';

// While the app is open: a banner for everything except the chat on screen.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = shouldPresent(notification.request.content.data as { chatId?: unknown; sessionId?: unknown; kind?: unknown } | null);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

/** Opens the chat a tapped notification is about (Open WebUI's or DeepTutor's), from a cold start too. */
export function NotificationRoot() {
  const response = Notifications.useLastNotificationResponse();
  const ready = Boolean(useRootNavigationState()?.key);
  const owui = useSession().state.status;
  const deeptutor = useDeepTutor().state.status;
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = response.notification.request.content.data as { kind?: unknown; chatId?: unknown; sessionId?: unknown } | null;
    const forDeepTutor = typeof data?.kind === 'string' && data.kind.startsWith('deeptutor');
    // Wait for the space's own sign-in to load before going there.
    if ((forDeepTutor ? deeptutor : owui) !== 'signed-in') return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse();
    if (forDeepTutor) {
      void saveSpace('deeptutor');
      if (typeof data?.sessionId === 'string' && data.sessionId) router.replace({ pathname: '/learn/[id]', params: { id: data.sessionId } });
      else router.replace('/learn');
      return;
    }
    void saveSpace('owui');
    if (typeof data?.chatId === 'string' && data.chatId) router.replace({ pathname: '/c/[id]', params: { id: data.chatId } });
    else router.replace('/');
  }, [ready, owui, deeptutor, response]);

  return null;
}
